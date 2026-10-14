import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gridToStl } from '../lib/sim/millSim.js';
import { partSurface, partTriangles, trianglesToStl } from '../lib/sim/dexelMesh.js';
import { toSimTools } from '../lib/sim/toolMagazine.js';
import { useToolMagazine } from '../hooks/useToolMagazine.js';

/**
 * "Simüle et": cuts the program into a virtual stock (tool shapes from the
 * magazine set in Atölye → Bıçaklar; a screen's own `tools` win over it), shows the machined part in 3D and offers it as STL.
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
  const [magazine] = useToolMagazine();
  const simTools = useMemo(() => ({ ...toSimTools(magazine), ...(tools || {}) }), [magazine, tools]);
  const lastTools = useRef(null);

  useEffect(() => () => workerRef.current?.terminate(), []);
  // a new program makes the shown result out of date
  useEffect(() => { if (lastRun.current && lastRun.current !== gcode) setStale(true); }, [gcode]);
  // so does a change of the loaded tools
  const toolsKey = JSON.stringify(simTools);
  useEffect(() => { if (lastTools.current && lastTools.current !== toolsKey) setStale(true); }, [toolsKey]);

  function run() {
    let text = gcode;
    try { if (!text && getGcode) text = getGcode(); } catch (err) { setState({ status: 'error', message: err.message }); return; }
    if (!text) return;
    workerRef.current?.terminate();
    // the real stock when the screen knows it (the whole door, uncut margins included)…
    const stock = size && size.w > 0 && size.h > 0
      ? { x0: size.x0 || 0, y0: size.y0 || 0, x1: (size.x0 || 0) + Number(size.w), y1: (size.y0 || 0) + Number(size.h) }
      : null;
    // …but only the part of it the tools reach is simulated: one tray on a whole
    // plate gets a fine grid instead of the plate's coarse one
    const reach = roughBox(text, topVal);
    let box = stock ? {
      x0: Math.max(stock.x0, reach.x0), y0: Math.max(stock.y0, reach.y0),
      x1: Math.min(stock.x1, reach.x1), y1: Math.min(stock.y1, reach.y1),
    } : reach;
    if (!(box.x1 > box.x0 && box.y1 > box.y0)) box = stock || reach;
    // grid: 0.2 mm where it fits, coarser on a big area (≤ ~5 million columns)
    const area = Math.max(1, (box.x1 - box.x0) * (box.y1 - box.y0));
    const cell = Math.max(0.2, +Math.sqrt(area / 5e6).toFixed(2));
    const w = new Worker(new URL('../lib/sim/sim.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const t0 = performance.now();
    setState({ status: 'running', cell });
    w.onmessage = (e) => {
      w.terminate();
      workerRef.current = null;
      if (e.data.type === 'error') { setState({ status: 'error', message: e.data.message }); return; }
      lastRun.current = gcode || text;
      lastTools.current = toolsKey;
      setStale(false);
      setState({ status: 'done', grid: e.data.grid, surface: e.data.surface, stats: e.data.stats, cell, seconds: (performance.now() - t0) / 1000 });
    };
    w.onerror = (e) => { setState({ status: 'error', message: e.message || 'Simülasyon çalışmadı.' }); w.terminate(); };
    w.postMessage({ text, top: Number(topVal) || 18, cell, tools: simTools, box });
  }

  function downloadStl() {
    const g = state.grid, stlCell = Math.max(0.8, state.cell);
    // hollows under the surface: height map + marching-cubes tiles; otherwise the height map alone
    const stl = g.voids && g.voids.size
      ? trianglesToStl(partTriangles(partSurface(g, Math.max(1, Math.ceil(stlCell / g.cell - 1e-9)))))
      : gridToStl(g, stlCell);
    const blob = new Blob([stl], { type: 'model/stl' });
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
      {stale && state.status === 'done' && <div className="hint hint-warn">Program veya takılı bıçaklar değişti; güncel hali için yeniden simüle edin.</div>}
      {state.status === 'done' && state.stats.emptySlots?.length > 0 && (
        <div className="hint hint-warn">⚠ Programın kullandığı yuvada bıçak yok ya da ölçüsü eksik: {state.stats.emptySlots.join(', ')} — Ø6 düz bıçak varsayıldı. Atölye → Bıçaklar'dan takın.</div>
      )}
      {state.status === 'done' && (
        <>
          <SimView grid={state.grid} surface={state.surface} top={Number(topVal) || 18} />
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
  // room for the widest tool around the moves
  const m = 20;
  return Number.isFinite(x0) ? { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m } : { x0: 0, y0: 0, x1: 100, y1: 100 };
}

/**
 * The part: smooth height map, its sides and bottom, and (around hollows under
 * the surface: kulp, T-slot) the marching-cubes tiles — see partSurface().
 */
function addPart(scene, surf) {
  const owned = [];
  const add = (geo, mat) => { scene.add(new THREE.Mesh(geo, mat)); owned.push(geo, mat); };
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.BufferAttribute(surf.vertices, 3));
  top.setIndex(new THREE.BufferAttribute(surf.index, 1));
  top.computeVertexNormals();
  add(top, new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.85, metalness: 0 }));
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.BufferAttribute(surf.sides, 3));
  sides.computeVertexNormals();
  add(sides, new THREE.MeshStandardMaterial({ color: 0xcdbb98, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  if (surf.mc.positions.length) {
    const mc = new THREE.BufferGeometry();
    mc.setAttribute('position', new THREE.BufferAttribute(surf.mc.positions, 3));
    mc.setAttribute('normal', new THREE.BufferAttribute(surf.mc.normals, 3));
    add(mc, new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }));
  }
  return owned;
}

/** three.js view of the simulated stock. */
function SimView({ grid, surface, top }) {
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

    const owned = addPart(scene, surface);

    // low, grazing light shows every ridge; a soft fill keeps the shadows readable
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8274, 0.55));
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
      controls.dispose(); owned.forEach((x) => x.dispose()); renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [grid, surface, top]);
  return <div ref={host} className="sim-view" />;
}
