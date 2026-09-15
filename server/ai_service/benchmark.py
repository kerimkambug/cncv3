"""Run isolated Depth Anything model and input-size benchmarks.

Each matrix cell gets a fresh service process so model selection, memory state,
and failed CUDA allocations cannot leak into the next measurement.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw


SERVICE_DIR = Path(__file__).resolve().parent
DEFAULT_MODELS = {
    "base": "depth-anything/Depth-Anything-V2-Base-hf",
    "large": "depth-anything/Depth-Anything-V2-Large-hf",
}
DEFAULT_SIZES = (1024, 1280, 1536, 2048)


def create_benchmark_image(path: Path, size=(2048, 1536)) -> None:
    width, height = size
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            radial = ((x - width * 0.52) ** 2 + (y - height * 0.48) ** 2) ** 0.5
            pixels[x, y] = (
                int(30 + 180 * x / width),
                int(35 + 150 * y / height),
                int(max(0, 210 - radial * 0.12)),
            )
    draw = ImageDraw.Draw(image)
    draw.ellipse((width * 0.24, height * 0.16, width * 0.72, height * 0.84), fill=(180, 120, 75))
    draw.ellipse((width * 0.38, height * 0.27, width * 0.58, height * 0.53), fill=(220, 175, 130))
    draw.polygon(
        [(width * 0.18, height * 0.86), (width * 0.48, height * 0.52), (width * 0.84, height * 0.86)],
        fill=(80, 110, 145),
    )
    image.save(path, format="PNG", optimize=False)


def request_json(url: str, timeout: float) -> tuple[int, dict]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def post_image(url: str, image_path: Path, timeout: float) -> tuple[int, int]:
    boundary = "----EmpireCncBenchmarkBoundary"
    image_bytes = image_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="benchmark.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
    ).encode() + image_bytes + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status, len(response.read())


def wait_until_ready(base_url: str, process: subprocess.Popen, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    last_error = "service did not become ready"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"service exited with code {process.returncode}")
        try:
            status, payload = request_json(f"{base_url}/health", 3)
            if status == 200 and payload.get("status") == "ready":
                return payload
            last_error = str(payload)
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            last_error = str(exc)
        time.sleep(1)
    raise TimeoutError(last_error)


def run_cell(label: str, model_id: str, max_input_px: int, image_path: Path, args) -> dict:
    port = args.port
    env = os.environ.copy()
    env.update({
        "DEPTH_MODEL_ID": model_id,
        "AI_MAX_INPUT_PX": str(max_input_px),
        "AI_SERVICE_PORT": str(port),
        "PYTHONUNBUFFERED": "1",
    })
    log_path = args.output.with_name(f"{args.output.stem}-{label}.log")
    started = time.perf_counter()
    with log_path.open("w", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            [sys.executable, "main.py"],
            cwd=SERVICE_DIR,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        base_url = f"http://127.0.0.1:{port}"
        result = {
            "label": label,
            "model": model_id,
            "max_input_px": max_input_px,
            "status": "error",
            "startup_seconds": None,
            "warmup_seconds": None,
            "runs": [],
            "service_log": str(log_path),
        }
        try:
            health = wait_until_ready(base_url, process, args.startup_timeout)
            result["startup_seconds"] = round(time.perf_counter() - started, 3)
            result["health"] = health

            warmup_started = time.perf_counter()
            post_image(f"{base_url}/generate-depth?smooth=0&contrast=1&sharpen=0", image_path, args.request_timeout)
            result["warmup_seconds"] = round(time.perf_counter() - warmup_started, 3)

            for index in range(args.repeats):
                run_started = time.perf_counter()
                try:
                    status, response_bytes = post_image(
                        f"{base_url}/generate-depth?smooth=0&contrast=1&sharpen=0",
                        image_path,
                        args.request_timeout,
                    )
                    result["runs"].append({
                        "index": index + 1,
                        "status": status,
                        "seconds": round(time.perf_counter() - run_started, 3),
                        "response_bytes": response_bytes,
                    })
                except Exception as exc:
                    result["runs"].append({
                        "index": index + 1,
                        "status": "error",
                        "seconds": round(time.perf_counter() - run_started, 3),
                        "error": str(exc),
                    })
            result["status"] = "ok" if all(run["status"] == 200 for run in result["runs"]) else "failed"
        except Exception as exc:
            result["error"] = str(exc)
            result["status"] = "timeout" if isinstance(exc, TimeoutError) else "failed"
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, help="Existing image; default is a generated 2048x1536 fixture")
    parser.add_argument("--output", type=Path, default=SERVICE_DIR / "benchmark-results.json")
    parser.add_argument("--models", nargs="+", choices=DEFAULT_MODELS, default=list(DEFAULT_MODELS))
    parser.add_argument("--sizes", nargs="+", type=int, default=DEFAULT_SIZES)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--startup-timeout", type=float, default=900)
    parser.add_argument("--request-timeout", type=float, default=900)
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    image_path = args.image or SERVICE_DIR / "benchmark-fixture.png"
    if args.image is None:
        create_benchmark_image(image_path)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = {
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python": sys.executable,
        "image": str(image_path),
        "models": DEFAULT_MODELS,
        "sizes": args.sizes,
        "repeats": args.repeats,
        "cells": [],
    }
    for model_name in args.models:
        for size in args.sizes:
            label = f"{model_name}-{size}"
            print(f"[benchmark] {label}", flush=True)
            result = run_cell(label, DEFAULT_MODELS[model_name], size, image_path, args)
            results["cells"].append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            args.output.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()