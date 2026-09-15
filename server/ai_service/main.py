import asyncio
import base64
import io
import os
from typing import Any, Literal, Optional
from pydantic import BaseModel
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from transformers import pipeline
# Depth Anything V2 — Base (vits yerine vitb): nesne hacimleri ve sahne
# uzaklığı için belirgin daha iyi geometri; CUDA/CPU otomatik seçilir.
MODEL_ID = os.getenv("DEPTH_MODEL_ID", "depth-anything/Depth-Anything-V2-Base-hf")

# Girdi ölçekleme: uzun kenar bu değeri aşarsa enfereans öncesi büyütülür.
# AI_MAX_INPUT_PX ortam değişkeni ile yapılandırılabilir (varsayılan 1024).
MAX_INPUT_PX = int(os.getenv("AI_MAX_INPUT_PX", "1024"))

depth_pipe = None
bg_session = None

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    from scipy.ndimage import median_filter, gaussian_filter
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

try:
    # rembg (U²-Net) — arka plan maskesi üretimi için opsiyonel
    from rembg import new_session, remove as rembg_remove
    HAS_REMBG = True
except Exception:
    HAS_REMBG = False

app = FastAPI(
    title="Empire CNC — AI Depth Map Service",
    description="CNC Bas-Relief optimized Depth Anything V2 monocular depth estimation service",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CadProcessRequest(BaseModel):
    document: dict[str, Any]
    compensation: Literal["center", "inside", "outside", "scan"] = "center"

def get_device_info():
    if torch.cuda.is_available():
        device_name = torch.cuda.get_device_name(0)
        return {"device": 0, "type": "cuda", "name": device_name, "dtype": torch.float16}
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return {"device": "mps", "type": "mps", "name": "Apple Silicon MPS", "dtype": torch.float32}
    else:
        return {"device": -1, "type": "cpu", "name": "CPU", "dtype": torch.float32}

def preprocess_image(img: Image.Image) -> Image.Image:
    """Girdiyi en fazla MAX_INPUT_PX uzun kenarına ölçekleyerek VRAM/RAM yükünü
    sınırlandır. En-boy oranı korunur, 1024x1024 altında kalanlar aynen kalır."""
    w, h = img.size
    longest = max(w, h)
    if longest <= MAX_INPUT_PX:
        return img
    scale = MAX_INPUT_PX / float(longest)
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return img.resize(new_size, Image.Resampling.LANCZOS)

def _get_bg_session():
    """
    rembg için tek sefer oluşturulan U²-Net oturumunu önbelleğe alır.
    """
    global bg_session
    if not HAS_REMBG:
        return None
    if bg_session is None:
        bg_session = new_session("u2net")
    return bg_session

def gen_foreground_mask(img: Image.Image) -> Optional[np.ndarray]:
    """
    rembg (U²-Net) ile RGB girdiden ön plan maskesi üretir.
    Dönen değer 0..1 float32 (1 = nesne, 0 = arka plan). Başarısız olursa None.
    """
    session = _get_bg_session()
    if session is None:
        return None
    cutout = rembg_remove(img, session=session)  # RGBA
    if cutout is None:
        return None
    alpha = np.asarray(cutout)[:, :, 3].astype(np.float32) / 255.0
    return alpha

def load_pipeline():
    global depth_pipe
    if depth_pipe is not None:
        return depth_pipe

    dev_info = get_device_info()
    print(f"[Empire CNC AI] Model yükleniyor: {MODEL_ID} ({dev_info['name']})")

    depth_pipe = pipeline(
        task="depth-estimation",
        model=MODEL_ID,
        device=dev_info["device"],
        torch_dtype=dev_info["dtype"]
    )
    print(f"[Empire CNC AI] Model hazırlandı! (Cihaz: {dev_info['type']})")
    return depth_pipe

@app.on_event("startup")
async def on_startup():
    try:
        load_pipeline()
    except Exception as e:
        print(f"[Empire CNC AI] Başlangıçta model yükleme uyarısı: {e}")

def process_depth_for_cnc(
    depth_np: np.ndarray,
    rgb_np: np.ndarray = None,
    smooth_radius: int = 1,
    remove_spikes: bool = True,
    contrast_boost: float = 1.0,
    sharpen: float = 0.0,
    as_16bit: bool = True,
    foreground_gain: float = 0.0,
    background_mask: Optional[np.ndarray] = None,
    background_mask_floor: float = 0.35,
    low_mask_coverage_threshold: float = 0.40,
    low_mask_floor: float = 0.70,
    mask_diagnostics: Optional[dict[str, Any]] = None,
) -> np.ndarray:
    """
    SculptOK Seviyesinde Çok Katmanlı 3D Bas-Rölyef Derinlik İşleme Hattı:
    1. Katmanlı Derinlik Ayrıştırması: Arka plan dağları/çölü (0.15-0.30), karavan (0.35-0.55),
       ana figürler/yüzler (0.55-0.85), ön plan yazılar/maske/çerçeve (0.85-1.00).
    2. Kabartmalı Kenar & Pah (Embossed Bevels): Yazıların, kimyasal formüllerin, gözlük ve
       yüz detaylarının keskin ve heykelsi olarak öne çıkmasını sağlar.
    3. Tam Z-Eksen Kullanımı: En çukur noktadan en tepeye kadar tüm dinamik aralık (0-255 / 0-65535)
       kademeli ve soluksuz kullanılır.
    """
    h, w = depth_np.shape[:2]

    # 2. Makro depth'i tüm kadraj üzerinden normalize et; nesne seçimi yok.
    p_low, p_high = np.percentile(depth_np, (0.1, 99.9))
    norm_macro = np.clip((depth_np - p_low) / max(float(p_high - p_low), 1e-6), 0.0, 1.0).astype(np.float32)

    # 1b. rembg (U²-Net) arka plan maskesi: nesne dışı bölgeler (gökyüzü, zemin,
    # duvar vb.) 0’a çekilirken nesne hacmi tam aralıkta korunur. Maske kenarı
    # Gaussian feather ile yumuşatılır; keskin duvar yerine CNC küre uçlu takımın
    # izleyebileceği ramp elde edilir.
    if background_mask is not None and background_mask.shape == depth_np.shape:
        m = np.clip(background_mask.astype(np.float32), 0.0, 1.0)
        coverage = float(np.mean(m >= 0.5))
        if HAS_CV2 and smooth_radius > 0:
            feather = max(1, smooth_radius * 3)
            if feather % 2 == 0:
                feather += 1
            m = cv2.GaussianBlur(m, (feather, feather), feather / 3.0)
        elif HAS_SCIPY and smooth_radius > 0:
            m = gaussian_filter(m, sigma=1.5)
        normal_floor = float(np.clip(background_mask_floor, 0.0, 1.0))
        fallback_floor = float(np.clip(low_mask_floor, normal_floor, 1.0))
        low_coverage = coverage < float(np.clip(low_mask_coverage_threshold, 0.0, 1.0))
        effective_floor = fallback_floor if low_coverage else normal_floor
        norm_macro = norm_macro * (effective_floor + (1.0 - effective_floor) * m)
        if mask_diagnostics is not None:
            mask_diagnostics.update({
                "coverage": round(coverage, 4),
                "floor": round(effective_floor, 3),
                "lowCoverage": low_coverage,
            })

    # 3. AI depth'i temiz tut: RGB parlaklığını geometriye eklemek, özellikle
    # gökyüzü/duvar gibi aydınlık arka planları sahte tepeye dönüştürebilir.
    # İnce yüzey detayları, CNC ayarlarıyla frontend'de kontrollü biçimde eklenir.
    norm_3d = norm_macro
    # 4. Kontrast burada uygulanabilir; ancak mevcut frontend de aynı ayarı
    # uyguladığı için endpoint çağrısı AI modunda contrast=1 gönderir.
    norm_3d = np.clip((norm_3d - 0.5) * float(max(0.1, contrast_boost)) + 0.5, 0.0, 1.0)
    gain = float(np.clip(foreground_gain, 0.0, 0.8))
    if gain > 0:
        norm_3d = np.clip(norm_3d + gain * (norm_3d ** 2) * (3.0 - 2.0 * norm_3d) * (1.0 - norm_3d), 0.0, 1.0)

    # 5. Tekil Piksel Sıçramalarını Temizle (Despeckle)
    if remove_spikes:
        if HAS_CV2:
            u16 = (norm_3d * 65535.0).astype(np.uint16)
            u16 = cv2.medianBlur(u16, 3)
            norm_3d = u16.astype(np.float32) / 65535.0
        elif HAS_SCIPY:
            norm_3d = median_filter(norm_3d, size=3)

    # 6. Hafif kenar koruyucu yumuşatma; parlaklık/kenar yayma uygulanmaz.
    if smooth_radius > 0:
        if HAS_CV2:
            d_kernel = max(3, smooth_radius * 2 + 1)
            norm_3d = cv2.bilateralFilter(norm_3d, d=d_kernel, sigmaColor=0.04, sigmaSpace=d_kernel)
        elif HAS_SCIPY:
            norm_3d = gaussian_filter(norm_3d, sigma=0.5)

    # Relief-aware edge pass: sharpen the depth surface itself, not the RGB
    # albedo. This keeps soft forms continuous while restoring meaningful
    # silhouette and fold transitions for CNC relief output.
    if HAS_CV2 and (contrast_boost > 1.0 or sharpen > 0):
        blurred = cv2.GaussianBlur(norm_3d, (0, 0), 1.0)
        amount = min(0.35, max(0.0, float(contrast_boost) - 1.0) * 0.45 + max(0.0, float(sharpen)) * 0.12)
        norm_3d = np.clip(norm_3d + (norm_3d - blurred) * amount, 0.0, 1.0)

    # 7. Arka plan sıfırlama: background_mask verildiyse gökyüzü/zemin yukarıdaki
    # 1b adımında 0'a çekilmiş olur; verilmediyse tüm kadraj kendi depth değerini korur.

    if as_16bit:
        out_u16 = np.clip(norm_3d * 65535.0, 0.0, 65535.0).astype(np.uint16)
        return out_u16
    else:
        out_u8 = np.clip(norm_3d * 255.0, 0.0, 255.0).astype(np.uint8)
        return out_u8

def analyze_and_verify_depth(f: np.ndarray, stage: int) -> tuple[np.ndarray, dict[str, Any]]:
    """
    Kalite Kontrol (QC) Pasosu - üretilen her depth haritası 1-2 kez doğrulanır:
      1. NaN/Inf geçersiz piksel kontrolü -> ortanca değerle onarım.
      2. Tekil piksel sıçramaları (spike) oranı -> eşik aşılırsa despeckle.
      3. Histogram uç kliplenmesi -> %99.6 daraltılmış aralıkla yeniden ölçekle.
    İlk kontrolde her şey temizse ikinci kontrol atlanır (hız kazancı).
    """
    was_clean = True
    notes: list[str] = []

    # 1. Geçersiz piksel (NaN/Inf) kontrolü ve onarımı
    bad_mask = ~np.isfinite(f)
    bad_count = int(bad_mask.sum())
    if bad_count:
        was_clean = False
        notes.append(f"{bad_count} geçersiz piksel (NaN/Inf) ortanca ile onarıldı")
        valid = f[np.isfinite(f)]
        med = float(np.median(valid)) if valid.size else 0.0
        f = np.where(bad_mask, med, f)

    # 2. Tekil piksel sıçramaları (spike) tespiti ve temizliği
    if HAS_CV2:
        med_surface = cv2.medianBlur((f * 65535.0).astype(np.uint16), 3).astype(np.float32) / 65535.0
    elif HAS_SCIPY:
        med_surface = median_filter(f, size=3)
    else:
        med_surface = f
    dev = np.abs(f - med_surface)
    spike_ratio = float(np.mean(dev > 0.045))
    if spike_ratio > 0.0015:
        was_clean = False
        notes.append(f"sıçrama oranı %{spike_ratio:.2f} eşiği aştı; spike temizliği uygulandı")
        f = np.where(dev > 0.045, med_surface, f)

    # 3. Dinamik aralık / uç kliplenme kontrolü
    p_lo, p_hi = np.percentile(f, (0.4, 99.6))
    if p_hi > p_lo:
        lo_c = float(np.mean(f < 0.005))
        hi_c = float(np.mean(f > 0.995))
        if hi_c > 0.004 or (lo_c > 0.004 and (p_hi - p_lo) < 0.35):
            was_clean = False
            notes.append(
                f"uç kliplenme (tabanda %{lo_c * 100:.2f}, tepe %{hi_c * 100:.2f}); aralık genişletildi"
            )
            f = np.clip((f - p_lo) / (p_hi - p_lo), 0.0, 1.0)

    return np.clip(f, 0.0, 1.0), {
        "pass": stage,
        "clean": was_clean,
        "notes": notes,
        "metrics": {
            "p01": round(float(np.percentile(f, 1.0)), 4),
            "p99": round(float(np.percentile(f, 99.0)), 4),
            "spikeRatio": round(spike_ratio, 5),
        },
    }

@app.get("/health")
def health():
    dev_info = get_device_info()
    return {
        "status": "ready" if depth_pipe is not None else "initializing",
        "model": MODEL_ID,
        "device": dev_info["name"],
        "device_type": dev_info["type"],
        "has_cv2": HAS_CV2,
        "has_scipy": HAS_SCIPY,
        "has_rembg": HAS_REMBG,
        "max_input_px": MAX_INPUT_PX,
    }

@app.post("/generate-depth")
@app.post("/predict-depth")
async def generate_depth(
    file: UploadFile = File(...),
    smooth: int = 2,
    contrast: float = 1.15,
    sharpen: float = 0.35,
    bit_depth: int = 16,
    use_background_mask: bool = True,
):
    """
    Kullanıcının yüklediği RGB görselden Depth Anything V2 modeliyle
    CAD/CAM kalitesinde 16-bit (0=Z dip / taban, 65535=Z tepe / yüzey) veya 8-bit
    yüksek hassasiyetli monoküler derinlik haritası üretir.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Geçersiz dosya formatı. Lütfen bir görsel (PNG, JPG, WEBP) yükleyin.")

    try:
        pipe = load_pipeline()
        image_bytes = await file.read()
        raw_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Girdi ön-işleme: uzun kenarı en fazla MAX_INPUT_PX olacak şekilde ölçekle.
        # VRAM/RAM sınırını korur, küçük görseller aynen işlenir.
        infer_image = preprocess_image(raw_image)
        infer_w, infer_h = infer_image.size
        orig_w, orig_h = raw_image.size
        # rembg (U²-Net) arka plan maskesi — CPU-bound olduğundan thread pool'da çalışır.
        background_mask = None
        if use_background_mask:
            background_mask = await asyncio.to_thread(gen_foreground_mask, infer_image)
        if background_mask is not None:
            print(f"[Empire CNC AI] Arka plan maskesi hazır: {background_mask.shape}")

        # Model tahmini (ölçeklenmiş görsel üzerinde)
        result = pipe(infer_image)
        depth_pil = result["depth"]  # Grayscale PIL Image (veya float tensor)

        # Yüksek kaliteli Lanczos4 / Bicubic yeniden boyutlandırma
        if HAS_CV2:
            raw_depth_np = np.array(depth_pil, dtype=np.float32)
            if (raw_depth_np.shape[1], raw_depth_np.shape[0]) != (orig_w, orig_h):
                raw_depth_np = cv2.resize(raw_depth_np, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
        else:
            if depth_pil.size != (orig_w, orig_h):
                depth_pil = depth_pil.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
            raw_depth_np = np.array(depth_pil, dtype=np.float32)

        # Maske de orijinal boyuta geri ölçeklenip depth ile aynı hizaya getirilir.
        if background_mask is not None:
            if HAS_CV2:
                background_mask = cv2.resize(background_mask, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
            else:
                from PIL import Image as _Img
                m_pil = _Img.fromarray((background_mask * 255.0).astype(np.uint8), "L").resize(
                    (orig_w, orig_h), _Img.Resampling.LANCZOS)
                background_mask = np.asarray(m_pil, dtype=np.float32) / 255.0
        # 16-bit / 8-bit CNC & CAD Optimizasyon Filtresi
        is_16 = (bit_depth == 16)
        mask_diagnostics: dict[str, Any] = {}
        optimized_depth = process_depth_for_cnc(
            raw_depth_np,
            smooth_radius=smooth,
            remove_spikes=True,
            # Kontrast ve görsel detay füzyonu frontend'de tek kez uygulanır.
            contrast_boost=max(1.0, float(contrast)),
            sharpen=float(sharpen),
            as_16bit=is_16,
            foreground_gain=0.0,
            background_mask=background_mask,
            background_mask_floor=0.35,
            low_mask_coverage_threshold=0.40,
            low_mask_floor=0.70,
            mask_diagnostics=mask_diagnostics,
        )

        depth_float = optimized_depth.astype(np.float32) / (65535.0 if is_16 else 255.0)
        qc_report = []
        depth_float, first_qc = analyze_and_verify_depth(depth_float, 1)
        qc_report.append(first_qc)
        if not first_qc["clean"]:
            depth_float, second_qc = analyze_and_verify_depth(depth_float, 2)
            qc_report.append(second_qc)
        if mask_diagnostics.get("lowCoverage"):
            qc_report.append({
                "pass": "background-mask",
                "clean": False,
                "notes": ["arka plan maskesi düşük kapsama nedeniyle zayıflatıldı"],
                "metrics": mask_diagnostics,
            })

        # PNG yalnızca önizleme için uygundur: browser canvas 16-bit PNG'yi
        # tekrar 8-bit RGBA'ya indirir. STL hattı için hassasiyeti kayıpsız
        # olarak little-endian ham uint16 verisi şeklinde taşı.
        if is_16:
            depth_bytes = np.clip(depth_float * 65535.0, 0.0, 65535.0).astype("<u2").tobytes()
        else:
            depth_bytes = np.clip(depth_float * 255.0, 0.0, 255.0).astype("u1").tobytes()
        return JSONResponse({
            "ok": True,
            "width": orig_w,
            "height": orig_h,
            "bitDepth": 16 if is_16 else 8,
            "depthDataBase64": base64.b64encode(depth_bytes).decode("ascii"),
            "qcReport": qc_report,
        })

    except Exception as e:
        print(f"[Empire CNC AI] Derinlik üretim hatası: {e}")
        raise HTTPException(status_code=500, detail=f"AI model çıkarım hatası: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
