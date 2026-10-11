// The room around the sample kitchen: closed walls (seen from outside they
// vanish, like a doll's house), a window, warm lights, a dining table with
// chairs, a sofa corner. Units: mm; the kitchen stands on the back wall (z = 0).
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export const ROOM = { x0: -800, x1: 4400, z0: 0, z1: 5600, h: 2700 };

/**
 * @param {{scene, add, box, wood:(hex:string)=>THREE.Texture, M:object}} k  helpers from scene.js
 * @returns {{dispose:()=>void}}
 */
export function buildRoom({ scene, add, box, wood, M }) {
  const { x0, x1, z0, z1, h } = ROOM;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2;
  const mats = [];
  const mat = (o, Kind = THREE.MeshStandardMaterial) => { const m = new Kind(o); mats.push(m); return m; };
  const wall = mat({ color: 0xece4d8, roughness: 0.95 });           // warm off-white plaster
  const accent = mat({ color: 0xb98f6e, roughness: 0.95 });         // terracotta-beige wall behind the sofa
  const ceiling = mat({ color: 0xf6f1ea, roughness: 1 });
  const walnut = mat({ color: 0xffffff, roughness: 0.55, map: wood('#6b4a33') });
  const oak = mat({ color: 0xffffff, roughness: 0.6, map: wood('#b58a5c') });
  const fabric = mat({ color: 0xb27a4f, roughness: 1 });            // camel sofa
  const cushion = mat({ color: 0xe9dcc6, roughness: 1 });
  const chairFab = mat({ color: 0x6f7a5f, roughness: 1 });          // olive chairs
  const rug = mat({ color: 0xcdb99a, roughness: 1 });
  const black = mat({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.4 });
  const brass = mat({ color: 0xc8a050, roughness: 0.3, metalness: 1 });
  const glow = mat({ color: 0xffd9a0, emissive: 0xffc27a, emissiveIntensity: 2.2 });
  const sky = mat({ color: 0xffffff, emissive: 0xdfeefb, emissiveIntensity: 1.1 });
  const leaf = mat({ color: 0x3f6a3a, roughness: 0.8 });
  const pot = mat({ color: 0xd9cfc0, roughness: 0.9 });

  // ---- shell: planes facing into the room (invisible from outside) ----
  const plane = (w, hh, m, x, y, z, ry = 0, rx = 0) => {
    const p = add(new THREE.PlaneGeometry(w, hh), m, x, y, z, { cast: false });
    p.rotation.set(rx, ry, 0); return p;
  };
  // the old floor/back wall of scene.js stay; resize them to the room
  plane(W, h, wall, cx, h / 2, z0 + 0.5);                                 // back (kitchen) wall
  plane(W, h, accent, cx, h / 2, z1, Math.PI);                            // front wall, behind the sofa
  plane(D, h, wall, x0, h / 2, (z0 + z1) / 2, Math.PI / 2);               // left wall (window)
  plane(D, h, wall, x1, h / 2, (z0 + z1) / 2, -Math.PI / 2);              // right wall
  plane(W, D, ceiling, cx, h, (z0 + z1) / 2, 0, Math.PI / 2);             // ceiling
  // skirting boards
  for (const [w, x, z, ry] of [[W, cx, z1 - 8, 0], [D, x0 + 8, (z0 + z1) / 2, Math.PI / 2], [D, x1 - 8, (z0 + z1) / 2, Math.PI / 2]]) {
    box(w, 80, 14, oak, x, 40, z).rotation.y = ry;
  }

  // ---- window on the left wall, daylight through it ----
  const wz = 2600, ww = 1800, wh = 1500, wy = 1450;
  plane(ww, wh, sky, x0 + 2, wy, wz, Math.PI / 2);
  for (const [sw, sh, dy, dz] of [[60, wh + 60, 0, -ww / 2], [60, wh + 60, 0, ww / 2], [60, wh, 0, 0], [ww, 60, wh / 2, 0], [ww, 60, -wh / 2, 0]]) {
    box(50, sh, sw, mat({ color: 0xf4f1ec, roughness: 0.6 }), x0 + 25, wy + dy, wz + dz);
  }
  box(160, 30, ww + 120, oak, x0 + 80, wy - wh / 2 - 15, wz);              // sill
  const day = new THREE.DirectionalLight(0xdfeaff, 0.9);
  day.position.set(x0 - 2500, 3200, wz); day.target.position.set(1800, 0, 2400);
  scene.add(day, day.target);

  // ---- ceiling lights: recessed spots over the kitchen ----
  const lights = [day];
  for (const x of [400, 1200, 2000, 2800]) {
    add(new THREE.CylinderGeometry(55, 55, 6, 24), glow, x, h - 3, 900, { cast: false });
    const p = new THREE.PointLight(0xffc98f, 0.35, 4200, 0);
    p.position.set(x, h - 60, 900); scene.add(p); lights.push(p);
  }
  // under-cabinet LED strip onto the worktop
  RectAreaLightUniformsLib.init();
  const led = new THREE.RectAreaLight(0xffcf96, 2.2, 2300, 40);
  led.position.set(1800, 1494, 250); led.lookAt(1800, 0, 250); scene.add(led); lights.push(led);
  box(2300, 6, 30, glow, 1800, 1497, 250, { cast: false });

  // ---- dining table, chairs, pendants ----
  // by the window, out of the line of sight to the kitchen
  const tz = 3100, tx = 480;
  box(1700, 40, 900, walnut, tx, 750, tz);
  for (const [dx, dz] of [[-760, -360], [760, -360], [-760, 360], [760, 360]]) box(60, 730, 60, walnut, tx + dx, 365, tz + dz);
  const chair = (x, z, face) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; scene.add(g);
    const o = { parent: g };
    box(450, 60, 440, chairFab, 0, 455, 0, o);
    box(450, 420, 50, chairFab, 0, 700, -200, o);
    for (const [dx, dz] of [[-195, -190], [195, -190], [-195, 190], [195, 190]]) box(30, 430, 30, oak, dx, 215, dz, o);
  };
  for (const dx of [-420, 420]) { chair(tx + dx, tz - 600, 0); chair(tx + dx, tz + 600, Math.PI); }
  chair(tx + 1100, tz, -Math.PI / 2);
  for (const dx of [-450, 0, 450]) {
    add(new THREE.CylinderGeometry(2, 2, h - 1700, 6), black, tx + dx, (h + 1700) / 2, tz, { cast: false });
    const shade = add(new THREE.ConeGeometry(120, 150, 32, 1, true), brass, tx + dx, 1640, tz, { cast: false });
    shade.material.side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(35, 20, 12), glow, tx + dx, 1595, tz, { cast: false });
  }
  const over = new THREE.PointLight(0xffb978, 0.9, 3500, 0);
  over.position.set(tx, 1540, tz); over.castShadow = true; over.shadow.mapSize.set(1024, 1024); over.shadow.bias = -0.002;
  over.shadow.camera.near = 50; over.shadow.camera.far = 4000;
  scene.add(over); lights.push(over);

  // ---- sofa corner against the front wall ----
  const sz = z1 - 480, sx = 1800;
  box(3000, 30, 2000, rug, sx, 5, sz - 700, { cast: false });
  box(2300, 220, 900, fabric, sx, 300, sz);                                  // base
  box(2300, 520, 220, fabric, sx, 560, sz + 340);                            // back
  for (const dx of [-1060, 1060]) box(180, 430, 900, fabric, sx + dx, 400, sz);  // arms
  for (const dx of [-500, 0, 500]) box(480, 130, 640, fabric, sx + dx, 475, sz - 60);
  for (const [dx, rz] of [[-750, 0.15], [-400, -0.1], [600, 0.1]]) {
    const c = box(380, 380, 120, cushion, sx + dx, 640, sz + 190); c.rotation.z = rz; c.rotation.x = -0.2;
  }
  for (const [dx, dz] of [[-1080, -380], [1080, -380], [-1080, 380], [1080, 380]]) box(40, 110, 40, black, sx + dx, 55, sz + dz);
  // round coffee table
  add(new THREE.CylinderGeometry(420, 420, 40, 48), oak, sx, 400, sz - 1000);
  add(new THREE.CylinderGeometry(40, 60, 380, 16), black, sx, 190, sz - 1000);
  add(new THREE.CylinderGeometry(70, 60, 140, 24), pot, sx + 150, 490, sz - 980);
  // floor lamp in the corner
  const lx = sx + 1450, lz = sz + 150;
  add(new THREE.CylinderGeometry(160, 180, 20, 32), black, lx, 10, lz);
  add(new THREE.CylinderGeometry(12, 12, 1550, 8), black, lx, 785, lz);
  const ls = add(new THREE.CylinderGeometry(160, 230, 320, 32, 1, true), mat({ color: 0xf2e6d0, roughness: 1, side: THREE.DoubleSide, emissive: 0xffc27a, emissiveIntensity: 0.45 }), lx, 1640, lz, { cast: false });
  ls.castShadow = false;
  const lamp = new THREE.PointLight(0xffb36b, 0.55, 3200, 0);
  lamp.position.set(lx, 1600, lz); scene.add(lamp); lights.push(lamp);

  // ---- plant by the window, pictures on the right wall ----
  add(new THREE.CylinderGeometry(200, 160, 420, 32), pot, x0 + 400, 210, z1 - 500);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 22; k++) {
    const a = rnd() * Math.PI * 2, r = 80 + rnd() * 260;
    add(new THREE.SphereGeometry(90 + rnd() * 80, 12, 8), leaf, x0 + 400 + Math.cos(a) * r, 650 + rnd() * 750, z1 - 500 + Math.sin(a) * r);
  }
  const art = [['#c46f4b', '#e9d6b8'], ['#33525c', '#d8c7a6'], ['#8a8f6a', '#efe3cd']];
  art.forEach(([c1, c2], i) => {
    const z = 2300 + i * 700, y = 1550 + (i % 2 ? 120 : 0);
    box(30, 640, 520, black, x1 - 15, y, z);
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160;
    const g = cv.getContext('2d'); g.fillStyle = c2; g.fillRect(0, 0, 128, 160);
    g.fillStyle = c1; g.beginPath(); g.arc(40 + i * 25, 70 + i * 10, 38 + i * 6, 0, Math.PI * 2); g.fill();
    g.fillRect(0, 120 - i * 10, 128, 6);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    plane(480, 600, mat({ map: t, roughness: 0.9 }), x1 - 32, y, z, -Math.PI / 2);
  });

  return {
    lights,
    dispose() { mats.forEach((m) => { m.map?.dispose(); m.dispose(); }); },
  };
}
