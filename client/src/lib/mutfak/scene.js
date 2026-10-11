// three.js scene of the sample kitchen (units: mm). The page creates it once and
// then only changes looks (colours, glass, worktop, handles) and door surfaces.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  COLORS, COUNTERS, COUNTER, DEPTH, FINISHES, GLASSES, HANDLES, PLINTH, THICK, TOP, UNITS, UPPER_H, UPPER_Y, BASE_H, frontsOf,
} from './kitchen.js';

/** Door surface key: same model group + same size = same texture. */
export const reliefKey = (f) => `${f.group}|${Math.round(f.w)}x${Math.round(f.h)}`;

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
/** Wood: base colour with long, slightly wavy grain lines (vertical). */
function woodTexture(hex) {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 140; k++) {
      const x0 = rnd() * s, dark = rnd() < 0.6;
      g.strokeStyle = dark ? `rgba(40,22,10,${0.05 + rnd() * 0.12})` : `rgba(255,240,215,${0.04 + rnd() * 0.08})`;
      g.lineWidth = 0.6 + rnd() * 2.4;
      g.beginPath();
      for (let y = 0; y <= s; y += 8) { const x = x0 + Math.sin(y / (40 + k % 30) + k) * (2 + rnd() * 2); if (y) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
  });
}
/** Marble: light base with soft grey veins. */
function marbleTexture(hex) {
  return canvasTexture(1024, (g, s) => {
    g.fillStyle = hex; g.fillRect(0, 0, s, s);
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(120,120,125,${0.08 + rnd() * 0.18})`; g.lineWidth = 0.5 + rnd() * 2.5;
      g.beginPath(); let x = rnd() * s, y = rnd() * s; g.moveTo(x, y);
      for (let i = 0; i < 30; i++) { x += (rnd() - 0.3) * 60; y += (rnd() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

export function createKitchen(host) {
  const width = () => host.clientWidth || 900, height = () => Math.max(420, Math.min(760, Math.round(width() * 0.62)));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width(), height());
  // no shadows, no tone curve: colours as chosen, every groove readable
  renderer.toneMapping = THREE.NoToneMapping;
  host.appendChild(renderer.domElement);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe6e4e0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  // plain studio light: even ambient + one key from the upper left front (shows the
  // relief of the doors the way the model images do) + a weak fill from the right
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(-1500, 3200, 5200); key.target.position.set(1800, 1000, 0);
  const fill = new THREE.DirectionalLight(0xffffff, 0.18);
  fill.position.set(5200, 1500, 3000); fill.target.position.set(1800, 1000, 0);
  scene.add(key, key.target, fill, fill.target, new THREE.AmbientLight(0xffffff, 0.28));

  const camera = new THREE.PerspectiveCamera(40, width() / height(), 10, 30000);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  // free orbit: no angle, distance or position limits
  controls.minDistance = 50; controls.maxDistance = 25000;
  controls.screenSpacePanning = true;
  const VIEWS = {
    genel: [[1800, 1650, 4700], [1800, 1050, 300]],
    alt: [[1500, 1000, 1900], [1500, 600, 300]],
    ust: [[1800, 1400, 2000], [1800, 1850, 200]],
    yan: [[4100, 1600, 3200], [1300, 1000, 600]],
  };
  function view(name) {
    const [p, t] = VIEWS[name] || VIEWS.genel;
    camera.position.set(...p); controls.target.set(...t); controls.update(); render();
  }

  // ---- shared materials (the look changes them in place) ----
  const M = {
    front: new THREE.MeshPhysicalMaterial({ color: 0xffffff }),      // carcass sides, door edges, glass frames
    inside: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.8 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 }),
    counter: new THREE.MeshPhysicalMaterial({ color: 0xffffff }),
    glass: new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    handle: new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bcbe, metalness: 1, roughness: 0.28 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.08, clearcoat: 1 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.35 }),
  };

  const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = scene } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o); // x,y,z = centre


  // ---- carcasses: open boxes (sides, top, bottom, back) so an opened door shows the inside ----
  const plates = (u, sy, d) => {
    for (let k = 0; k < 6; k++) add(new THREE.CylinderGeometry(105, 92, 14, 40), M.plate, u.x + 170, sy + 7 + k * 14, d / 2 + 10);
    add(new THREE.CylinderGeometry(38, 32, 110, 28), M.plate, u.x + u.w - 170, sy + 55, d / 2 + 10);
    add(new THREE.CylinderGeometry(38, 32, 110, 28), M.plate, u.x + u.w - 90, sy + 55, d / 2 - 20);
  };
  for (const u of UNITS) {
    const d = DEPTH[u.kind];
    const y0 = u.kind === 'upper' ? UPPER_Y : PLINTH;
    const h = u.kind === 'upper' ? UPPER_H : u.kind === 'tall' ? TOP - PLINTH : BASE_H;
    const cx = u.x + u.w / 2;
    box(u.w, 18, d, M.front, cx, y0 + 9, d / 2);
    box(u.w, 18, d, M.front, cx, y0 + h - 9, d / 2);
    box(18, h, d, M.front, u.x + 9, y0 + h / 2, d / 2);
    box(18, h, d, M.front, u.x + u.w - 9, y0 + h / 2, d / 2);
    box(u.w - 36, h - 36, 8, M.inside, cx, y0 + h / 2, 4);
    if (u.kind !== 'upper') box(u.w, PLINTH, d - 60, M.plinth, cx, PLINTH / 2, (d - 60) / 2);
    // shelves behind doors (not in the drawer unit, not under the sink, not around the oven)
    const shelves = u.sink || u.hob ? [] : u.kind === 'upper' ? [y0 + h / 2] : u.kind === 'base' ? [y0 + h / 2]
      : u.fronts.some((f) => f.type === 'oven') ? [y0 + 1540, y0 + 1800] : [y0 + 500, y0 + 900, y0 + 1500, y0 + 1800];
    for (const sy of shelves) box(u.w - 36, 16, d - 30, M.inside, cx, sy, (d - 30) / 2 + 8);
    if (u.kind === 'upper') { plates(u, y0 + 18, d); plates(u, y0 + h / 2 + 8, d); }
  }

  // ---- worktop, splashback, sink, hob, hood ----
  const cx0 = 600, cx1 = 3000, cDepth = 620, cy = PLINTH + BASE_H + COUNTER / 2;
  box(cx1 - cx0, COUNTER, cDepth, M.counter, (cx0 + cx1) / 2, cy, cDepth / 2);
  box(cx1 - cx0, UPPER_Y - (cy + COUNTER / 2), 12, M.counter, (cx0 + cx1) / 2, (UPPER_Y + cy + COUNTER / 2) / 2, 6);
  const sinkU = UNITS.find((u) => u.sink), hobU = UNITS.find((u) => u.hob);
  const topY = cy + COUNTER / 2;
  box(520, 4, 430, M.steel, sinkU.x + 300, topY + 1, 300);
  box(480, 4, 390, new THREE.MeshStandardMaterial({ color: 0x6d7174, metalness: 1, roughness: 0.4 }), sinkU.x + 300, topY + 2.5, 300, { cast: false });
  add(new THREE.CylinderGeometry(16, 20, 260, 24), M.steel, sinkU.x + 300, topY + 130, 70);
  const spout = add(new THREE.TorusGeometry(90, 13, 16, 40, Math.PI), M.steel, sinkU.x + 300, topY + 260, 160);
  spout.rotation.y = Math.PI / 2;
  box(580, 6, 510, M.black, hobU.x + 300, topY + 3, 300);
  for (const [dx, dz, r] of [[-140, -110, 95], [140, -110, 75], [-140, 120, 75], [140, 120, 95]]) {
    const ring = add(new THREE.RingGeometry(r - 3, r, 48), new THREE.MeshBasicMaterial({ color: 0x55585c }), hobU.x + 300 + dx, topY + 6.5, 300 + dz, { cast: false });
    ring.rotation.x = -Math.PI / 2;
  }
  box(600, 70, 500, M.steel, hobU.x + 300, UPPER_Y + 160, 250);
  box(280, TOP + 300 - (UPPER_Y + 195), 260, M.steel, hobU.x + 300, (TOP + 300 + UPPER_Y + 195) / 2, 130);

  // ---- fronts ----
  const fronts = frontsOf(UNITS);
  const frontMats = new Map(); // relief key -> material (one per door size + group)
  const frontMat = (f) => {
    const k = reliefKey(f);
    if (!frontMats.has(k)) frontMats.set(k, new THREE.MeshPhysicalMaterial({ color: 0xffffff }));
    return frontMats.get(k);
  };
  const handles = [];
  const movers = []; // every front that opens: { pivot, kind:'door'|'drawer', dir, open, t }
  for (const f of fronts) {
    const d = DEPTH[f.unit.kind], z = d + THICK / 2 + 1, cxF = f.x + f.w / 2, cyF = f.y + f.h / 2;
    if (f.type === 'oven') {
      box(f.w, f.h, THICK + 6, M.black, cxF, cyF, z + 3);
      box(f.w - 80, 14, 24, M.steel, cxF, f.y + f.h - 70, z + 30);
      box(f.w - 40, 60, 4, new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.4 }), cxF, f.y + f.h - 25, z + 14);
      continue;
    }
    // everything of this front is built in kitchen coordinates inside `body`; the
    // pivot sits on the hinge line (doors) or at the front's own place (drawers)
    const isDrawer = f.type === 'drawer';
    const hingeX = f.side === 'L' ? f.x + f.w : f.x; // handle on the left -> hinge on the right
    const pivot = new THREE.Group(), body = new THREE.Group();
    pivot.position.set(isDrawer ? 0 : hingeX, 0, isDrawer ? 0 : d);
    body.position.set(isDrawer ? 0 : -hingeX, 0, isDrawer ? 0 : -d);
    pivot.add(body); scene.add(pivot);
    const o = { parent: body };
    if (f.type === 'glass') {
      const fw = 62;
      box(f.w, fw, THICK, M.front, cxF, f.y + fw / 2, z, o);
      box(f.w, fw, THICK, M.front, cxF, f.y + f.h - fw / 2, z, o);
      box(fw, f.h - 2 * fw, THICK, M.front, f.x + fw / 2, cyF, z, o);
      box(fw, f.h - 2 * fw, THICK, M.front, f.x + f.w - fw / 2, cyF, z, o);
      add(new THREE.PlaneGeometry(f.w - 2 * fw + 16, f.h - 2 * fw + 16), M.glass, cxF, cyF, z - 2, { cast: false, parent: body });
    } else {
      // door body: edges in the carcass colour, the front face carries the model's surface
      box(f.w, f.h, THICK, M.front, cxF, cyF, z, o);
      add(new THREE.PlaneGeometry(f.w, f.h), frontMat(f), cxF, cyF, z + THICK / 2 + 0.2, o);
    }
    if (isDrawer) {
      // the drawer box behind the front: sides, back and bottom
      const bw = f.w - 70, bh = Math.max(60, f.h - 70), bd = d - 60, bz = d - bd / 2, by = f.y + 20 + bh / 2;
      box(12, bh, bd, M.inside, cxF - bw / 2 + 6, by, bz, o);
      box(12, bh, bd, M.inside, cxF + bw / 2 - 6, by, bz, o);
      box(bw, bh, 12, M.inside, cxF, by, d - bd + 6, o);
      box(bw, 10, bd, M.inside, cxF, f.y + 25, bz, o);
    }
    // handle: on the opening side; doors low in the kitchen get it high, high doors low
    const hz = z + THICK / 2 + 26;
    const g = new THREE.Group();
    if (isDrawer) {
      const bar = add(new THREE.CylinderGeometry(6, 6, 300, 16), M.handle, cxF, f.y + f.h - 50, hz, { parent: g });
      bar.rotation.z = Math.PI / 2;
    } else {
      const hx = f.side === 'L' ? f.x + 40 : f.x + f.w - 40;
      const hy = cyF < 1300 ? f.y + f.h - 130 : f.y + 130;
      add(new THREE.CylinderGeometry(6, 6, 160, 16), M.handle, hx, hy, hz, { parent: g });
    }
    body.add(g); handles.push(g);
    const m = { pivot, kind: isDrawer ? 'drawer' : 'door', dir: f.side === 'L' ? 1 : -1, open: false, t: 0, reach: isDrawer ? d - 110 : 0 };
    pivot.traverse((c) => { c.userData.mover = m; });
    movers.push(m);
  }

  // ---- opening: click a door / drawer, it swings / slides ----
  const DOOR_OPEN = (100 * Math.PI) / 180;
  let anim = 0;
  const place = (m) => {
    if (m.kind === 'drawer') m.pivot.position.z = m.reach * m.t;
    else m.pivot.rotation.y = m.dir * DOOR_OPEN * m.t;
  };
  function tick() {
    let moving = false;
    for (const m of movers) {
      const goal = m.open ? 1 : 0;
      if (m.t === goal) continue;
      m.t = goal > m.t ? Math.min(goal, m.t + 0.07) : Math.max(goal, m.t - 0.07);
      place(m); moving = true;
    }
    render();
    anim = moving ? requestAnimationFrame(tick) : 0;
  }
  const kick = () => {
    // a hidden tab gets no animation frames: go straight to the end position
    if (document.hidden) { movers.forEach((m) => { m.t = m.open ? 1 : 0; place(m); }); render(); return; }
    if (!anim) anim = requestAnimationFrame(tick);
  };
  function toggle(m) { m.open = !m.open; kick(); }
  function setAllOpen(open) { movers.forEach((m) => { m.open = open; }); kick(); }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const moverAt = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true)[0];
    return hit?.object.userData.mover || null;
  };
  let down = null;
  const onDown = (e) => { down = [e.clientX, e.clientY]; };
  const onUp = (e) => {
    // a click, not the end of a drag that turned the view
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const m = moverAt(e);
    if (m) toggle(m);
  };
  const onMove = (e) => { if (e.buttons) return; renderer.domElement.style.cursor = moverAt(e) ? 'pointer' : 'grab'; };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointermove', onMove);

  // ---- look ----
  const woodCache = new Map();
  const wood = (hex) => { if (!woodCache.has(hex)) woodCache.set(hex, woodTexture(hex)); return woodCache.get(hex); };
  let counterTex = null;
  function setLook({ color, finish, glass, counter, handle }) {
    const c = COLORS.find((x) => x.id === color) || (color?.startsWith?.('#') ? { hex: color } : COLORS[0]);
    const fin = FINISHES.find((x) => x.id === finish) || FINISHES[0];
    for (const m of [M.front, ...frontMats.values()]) {
      m.color.set(c.wood ? '#ffffff' : c.hex);
      m.map = c.wood ? wood(c.hex) : null;
      m.roughness = c.wood ? Math.max(0.45, fin.roughness) : fin.roughness;
      m.clearcoat = fin.clearcoat; m.clearcoatRoughness = 0.12;
      m.needsUpdate = true;
    }
    const gl = GLASSES.find((x) => x.id === glass) || GLASSES[0];
    Object.assign(M.glass, { opacity: gl.opacity, roughness: gl.roughness, metalness: gl.metalness || 0 });
    M.glass.color.set(gl.color); M.glass.needsUpdate = true;
    const ct = COUNTERS.find((x) => x.id === counter) || COUNTERS[0];
    counterTex?.dispose();
    counterTex = ct.veins ? marbleTexture(ct.hex) : ct.wood ? woodTexture(ct.hex) : null;
    if (counterTex) counterTex.repeat.set(2, 1);
    M.counter.map = counterTex; M.counter.color.set(counterTex ? '#ffffff' : ct.hex);
    M.counter.roughness = ct.roughness; M.counter.clearcoat = ct.roughness < 0.4 ? 0.6 : 0; M.counter.needsUpdate = true;
    const hd = HANDLES.find((x) => x.id === handle) || HANDLES[0];
    handles.forEach((g) => { g.visible = hd.id !== 'yok'; });
    if (hd.hex) { M.handle.color.set(hd.hex); M.handle.metalness = hd.metalness; M.handle.roughness = hd.roughness; }
    render();
  }

  /** Door surface for every front with this key (null = flat door). */
  const reliefTex = new Map();
  function setRelief(key, relief) {
    const m = frontMats.get(key);
    if (!m) return;
    reliefTex.get(key)?.forEach((t) => t.dispose());
    if (!relief) { m.normalMap = null; m.aoMap = null; reliefTex.delete(key); m.needsUpdate = true; render(); return; }
    // the smaller levels are built here (normals averaged and re-normalised): seen
    // from afar a dense groove pattern fades evenly instead of breaking into moiré
    const tex = (data, normal) => {
      const t = new THREE.DataTexture(data, relief.w, relief.h, THREE.RGBAFormat);
      t.mipmaps = mipChain(data, relief.w, relief.h, normal);
      t.generateMipmaps = false;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = maxAniso; t.needsUpdate = true;
      return t;
    };
    const n = tex(relief.normal, true), a = tex(relief.shade, false);
    m.normalMap = n; m.normalScale.set(2.6, 2.6);
    m.aoMap = a; m.aoMapIntensity = 1;
    reliefTex.set(key, [n, a]);
    m.needsUpdate = true;
    render();
  }

  function render() { renderer.render(scene, camera); }
  controls.addEventListener('change', render);
  // the drawing buffer always matches the box on screen 1:1 (a canvas the browser
  // has to stretch even by 2% turns fine grooves into moiré); the box can change
  // without a window resize, e.g. when the page's scrollbar appears
  let lastW = 0;
  const onResize = () => {
    const w = width();
    if (w === lastW) return;
    lastW = w;
    renderer.setSize(w, height()); camera.aspect = w / height(); camera.updateProjectionMatrix(); render();
  };
  const sizer = new ResizeObserver(onResize);
  sizer.observe(host);
  view('genel');

  return {
    fronts,
    keys: [...frontMats.keys()],
    setLook, setRelief, view, setAllOpen,
    anyOpen: () => movers.some((m) => m.open),
    snapshot() { render(); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      sizer.disconnect();
      cancelAnimationFrame(anim);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); });
      [...Object.values(M), ...frontMats.values()].forEach((m) => { m.map?.dispose(); m.dispose(); });
      reliefTex.forEach((ts) => ts.forEach((t) => t.dispose()));
      woodCache.forEach((t) => t.dispose()); counterTex?.dispose();
      pmrem.dispose(); renderer.dispose();
      host.removeChild(renderer.domElement);
    },
  };
}

/** Full mipmap chain of an RGBA texture (2×2 averages; normal maps are re-normalised). */
function mipChain(data, w, h, normal) {
  const levels = [{ data, width: w, height: h }];
  let src = data, sw = w, sh = h;
  while (sw > 1 || sh > 1) {
    const nw = Math.max(1, sw >> 1), nh = Math.max(1, sh >> 1), dst = new Uint8Array(nw * nh * 4);
    for (let j = 0; j < nh; j++) {
      for (let i = 0; i < nw; i++) {
        const acc = [0, 0, 0, 0];
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = (Math.min(sh - 1, 2 * j + dj) * sw + Math.min(sw - 1, 2 * i + di)) * 4;
          for (let c = 0; c < 4; c++) acc[c] += src[k + c];
        }
        const o = (j * nw + i) * 4;
        if (normal) {
          const x = acc[0] / 510 - 1, y = acc[1] / 510 - 1, z = acc[2] / 510 - 1, l = Math.hypot(x, y, z) || 1;
          dst[o] = (x / l * 0.5 + 0.5) * 255; dst[o + 1] = (y / l * 0.5 + 0.5) * 255; dst[o + 2] = (z / l * 0.5 + 0.5) * 255; dst[o + 3] = 255;
        } else {
          for (let c = 0; c < 4; c++) dst[o + c] = acc[c] / 4;
        }
      }
    }
    levels.push({ data: soften(dst, nw, nh, normal), width: nw, height: nh });
    src = dst; sw = nw; sh = nh;
  }
  return levels;
}

/** 3×3 tent filter on one mip level: removes the near-Nyquist stripes a 2×2 average leaves. */
function soften(d, w, h, normal) {
  if (w < 3 || h < 3) return d;
  const out = new Uint8Array(d.length), K = [1, 2, 1];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const acc = [0, 0, 0]; let ws = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const k = (Math.min(h - 1, Math.max(0, j + b)) * w + Math.min(w - 1, Math.max(0, i + a))) * 4, wt = K[a + 1] * K[b + 1];
        acc[0] += d[k] * wt; acc[1] += d[k + 1] * wt; acc[2] += d[k + 2] * wt; ws += wt;
      }
      const o = (j * w + i) * 4;
      if (normal) {
        const x = acc[0] / ws / 127.5 - 1, y = acc[1] / ws / 127.5 - 1, z = acc[2] / ws / 127.5 - 1, l = Math.hypot(x, y, z) || 1;
        out[o] = (x / l * 0.5 + 0.5) * 255; out[o + 1] = (y / l * 0.5 + 0.5) * 255; out[o + 2] = (z / l * 0.5 + 0.5) * 255;
      } else { out[o] = acc[0] / ws; out[o + 1] = acc[1] / ws; out[o + 2] = acc[2] / ws; }
      out[o + 3] = 255;
    }
  }
  return out;
}
