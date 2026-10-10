import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gridToStl } from '../lib/sim/millSim.js';

/**
 * "Simüle et": cuts the program into a virtual stock (tool shapes from the
 * workshop's tool table), shows the machined part in 3D and offers it as STL.
 * Usable on any screen that produces a G-code.
 *
 * @param {{gcode?:string, getGcode?:()=>string, top?:number, tools?:object, name?:string, size?:{w:number,h:number,x0?:number,y0?:number}}} props
 *        size: the real stock (door, plate…) in mm — without it the area the tools reach is used
 *        getGcode: for screens that build the program only on demand (nesting plates…)
 */
export default function SimPanel({ gcode = null, getGcode = null, top = 18, tools = undefined, name = 'simulasyon', size = null }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | running | done | error
  const [topVal, setTopVal] = useState(Number(top) || 18);
  useEffect(() => { setTopVal(Number(top) || 18); }, [top]);
  const [stale, setStale] = useState(false);
  const workerRef = useRef(null);
  const lastRun = useRef(null);

  useEffect(() => () => workerRef.current?.terminate(), []);
  // a new program makes the shown result out of date
  useEffect(() => { if (lastRun.current && lastRun.current !== gcode) setStale(true); }, [gcode]);

  function run() {
    let text = gcode;
    try { if (!text && getGcode) text = getGcode(); } catch (err) { setState({ status: 'error', message: err.message }); return; }
    if (!text) return;
    workerRef.current?.terminate();
    // grid size: 0.4 mm on a single part, coarser on a whole plate (≤ ~4 million columns)
    // the real stock when the screen knows it (the whole door, uncut margins included)
    const stock = size && size.w > 0 && size.h > 0
      ? { x0: size.x0 || 0, y0: size.y0 || 0, x1: (size.x0 || 0) + Number(size.w), y1: (size.y0 || 0) + Number(size.h) }
      : null;
    const box = stock ? { w: stock.x1 - stock.x0, h: stock.y1 - stock.y0 } : roughBox(text, topVal);
    const area = Math.max(1, box.w * box.h);
    const cell = Math.max(0.4, +Math.sqrt(area / 4e6).toFixed(2));
    const w = new Worker(new URL('../lib/sim/sim.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const t0 = performance.now();
    setState({ status: 'running', cell });
    w.onmessage = (e) => {
      w.terminate();
      workerRef.current = null;
      if (e.data.type === 'error') { setState({ status: 'error', message: e.data.message }); return; }
      lastRun.current = gcode || text;
      setStale(false);
      setState({ status: 'done', grid: e.data.grid, stats: e.data.stats, cell, seconds: (performance.now() - t0) / 1000 });
    };
    w.onerror = (e) => { setState({ status: 'error', message: e.message || 'Simülasyon çalışmadı.' }); w.terminate(); };
    w.postMessage({ text, top: Number(topVal) || 18, cell, tools, box: stock });
  }

  function downloadStl() {
    const blob = new Blob([gridToStl(state.grid, Math.max(0.8, state.cell))], { type: 'model/stl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.stl`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="sim-panel">
      <div className="sim-head">
        <label className="sim-top">Malzeme kalınlığı <input type="number" step="0.1" value={topVal} onChange={(e) => setTopVal(e.target.value)} /> mm</label>
        <button type="button" className="btn-secondary" onClick={run} disabled={(!gcode && !getGcode) || state.status === 'running'}>
          {state.status === 'running' ? 'Simüle ediliyor…' : state.status === 'done' ? '↻ Yeniden simüle et' : '🔍 Simüle et'}
        </button>
        {state.status === 'done' && <button type="button" className="btn-secondary" onClick={downloadStl}>⬇ İşlenmiş parça (.stl)</button>}
        {state.status === 'done' && (
          <span className="sim-sum">
            {state.stats.belowTable ? <b className="sim-bad">⚠ {state.stats.belowTable} hareket tablanın altında</b> : <span className="sim-ok">✓ tablanın altına inen hareket yok</span>}
            {' · '}{(state.stats.cuttingMm / 1000).toFixed(1)} m kesim · {state.seconds.toFixed(1)} sn
          </span>
        )}
      </div>
      {state.status === 'error' && <div className="err" style={{ display: 'block' }}>{state.message}</div>}
      {stale && state.status === 'done' && <div className="hint hint-warn">Program değişti; güncel hali için yeniden simüle edin.</div>}
      {state.status === 'done' && (
        <>
          <SimView grid={state.grid} top={Number(topVal) || 18} />
          <div className="sim-tools">
            {Object.entries(state.stats.byTool).map(([t, mm]) => <span key={t}>{t}: {(mm / 1000).toFixed(1)} m</span>)}
          </div>
          <div className="hint">Fareyle döndürün, tekerlekle yaklaşın, sağ tuşla kaydırın. Izgara {state.cell} mm.</div>
        </>
      )}
    </div>
  );
}

/** Area the cutting moves cover (quick scan, for choosing the grid size). */
function roughBox(text, top) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z = 99, x = 0, y = 0;
  for (const raw of text.split('\n')) {
    const mx = /X\s*(-?[\d.]+)/i.exec(raw), my = /Y\s*(-?[\d.]+)/i.exec(raw), mz = /Z\s*(-?[\d.]+)/i.exec(raw);
    if (mx) x = +mx[1]; if (my) y = +my[1]; if (mz) z = +mz[1];
    if (z < top) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return Number.isFinite(x0) ? { w: x1 - x0 + 40, h: y1 - y0 + 40 } : { w: 100, h: 100 };
}

/** three.js view of the simulated stock. */
function SimView({ grid, top }) {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const size = () => { const w0 = el.clientWidth || 800; return [w0, Math.round(Math.min(w0 * 0.62, Math.max(320, window.innerHeight * 0.6)))]; };
    const [width, height] = size();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2027);

    // surface mesh, at most ~800 points on the long side
    const S = Math.max(1, Math.ceil(Math.max(grid.w, grid.h) / 800));
    const W = Math.floor((grid.w - 1) / S) + 1, H = Math.floor((grid.h - 1) / S) + 1;
    const pos = new Float32Array(W * H * 3);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3;
      pos[k] = grid.x0 + (i * S + 0.5) * grid.cell;
      pos[k + 1] = grid.y0 + (j * S + 0.5) * grid.cell;
      pos[k + 2] = grid.z[Math.min(grid.h - 1, j * S) * grid.w + Math.min(grid.w - 1, i * S)];
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    let o = 0;
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx[o++] = a; idx[o++] = b; idx[o++] = d; idx[o++] = a; idx[o++] = d; idx[o++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // low, grazing light shows every ridge; a soft fill keeps the shadows readable
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const cx = grid.x0 + (grid.w * grid.cell) / 2, cy = grid.y0 + (grid.h * grid.cell) / 2;
    const span = Math.max(grid.w, grid.h) * grid.cell;
    sun.position.set(cx - span, cy + span * 0.8, top + span * 0.6);
    sun.target.position.set(cx, cy, 0);
    scene.add(sun, sun.target);

    const camera = new THREE.PerspectiveCamera(35, width / height, 1, span * 20);
    camera.up.set(0, 0, 1);
    camera.position.set(cx, cy - span * 1.1, top + span * 1.0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, cy, top / 2);
    controls.update();
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    render();
    const onResize = () => {
      const [w2, h2] = size();
      renderer.setSize(w2, h2); camera.aspect = w2 / h2; camera.updateProjectionMatrix(); render();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      controls.dispose(); geo.dispose(); mat.dispose(); renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [grid, top]);
  return <div ref={host} className="sim-view" />;
}
