// The room around the sample kitchen: closed walls, a window and warm lights;
// no furniture, so the kitchen stays the subject. Units: mm; the kitchen
// stands on the back wall (z = 0). The camera is kept inside (scene.js).
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

export const ROOM = { x0: -800, x1: 4400, z0: 0, z1: 5600, h: 2700 };

/**
 * @param {{scene, add, box, wood:(hex:string)=>THREE.Texture}} k  helpers from scene.js
 * @returns {{dispose:()=>void}}
 */
export function buildRoom({ scene, add, box, wood }) {
  const { x0, x1, z0, z1, h } = ROOM;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const mats = [];
  const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };
  const wall = mat({ color: 0xece4d8, roughness: 0.95 });   // warm off-white plaster
  const ceiling = mat({ color: 0xf6f1ea, roughness: 1 });
  const oak = mat({ color: 0xffffff, roughness: 0.6, map: wood('#b58a5c') });
  const frame = mat({ color: 0xf4f1ec, roughness: 0.6 });
  const glow = mat({ color: 0xffd9a0, emissive: 0xffc27a, emissiveIntensity: 2.2 });
  const sky = mat({ color: 0xffffff, emissive: 0xdfeefb, emissiveIntensity: 1.1 });

  // ---- shell: planes facing into the room ----
  const plane = (w, hh, m, x, y, z, ry = 0, rx = 0) => {
    const p = add(new THREE.PlaneGeometry(w, hh), m, x, y, z, { cast: false });
    p.rotation.set(rx, ry, 0); return p;
  };
  plane(W, h, wall, cx, h / 2, z0 + 0.5);                 // back (kitchen) wall
  plane(W, h, wall, cx, h / 2, z1, Math.PI);              // front wall
  plane(D, h, wall, x0, h / 2, cz, Math.PI / 2);          // left wall (window)
  plane(D, h, wall, x1, h / 2, cz, -Math.PI / 2);         // right wall
  plane(W, D, ceiling, cx, h, cz, 0, Math.PI / 2);        // ceiling
  for (const [w, x, z, ry] of [[W, cx, z1 - 8, 0], [D, x0 + 8, cz, Math.PI / 2], [D, x1 - 8, cz, Math.PI / 2]]) {
    box(w, 80, 14, oak, x, 40, z).rotation.y = ry;          // skirting boards
  }

  // ---- window on the left wall, daylight through it ----
  const wz = 2600, ww = 1800, wh = 1500, wy = 1450;
  plane(ww, wh, sky, x0 + 2, wy, wz, Math.PI / 2);
  for (const [sw, sh, dy, dz] of [[60, wh + 60, 0, -ww / 2], [60, wh + 60, 0, ww / 2], [60, wh, 0, 0], [ww, 60, wh / 2, 0], [ww, 60, -wh / 2, 0]]) {
    box(50, sh, sw, frame, x0 + 25, wy + dy, wz + dz);
  }
  box(160, 30, ww + 120, oak, x0 + 80, wy - wh / 2 - 15, wz);
  const day = new THREE.DirectionalLight(0xdfeaff, 0.9);
  day.position.set(x0 - 2500, 3200, wz); day.target.position.set(1800, 0, 2400);
  scene.add(day, day.target);

  // ---- warm recessed spots: a row over the kitchen, two rows over the room ----
  const spots = [[400, 900], [1200, 900], [2000, 900], [2800, 900], [800, 2800], [2800, 2800], [800, 4400], [2800, 4400]];
  for (const [x, z] of spots) {
    add(new THREE.CylinderGeometry(55, 55, 6, 24), glow, x, h - 3, z, { cast: false });
    const p = new THREE.PointLight(0xffc98f, z < 1500 ? 0.35 : 0.3, 4200, 0);
    p.position.set(x, h - 60, z); scene.add(p);
  }
  // under-cabinet LED strip onto the worktop
  RectAreaLightUniformsLib.init();
  const led = new THREE.RectAreaLight(0xffcf96, 2.2, 2300, 40);
  led.position.set(1800, 1494, 250); led.lookAt(1800, 0, 250); scene.add(led);
  box(2300, 6, 30, glow, 1800, 1497, 250, { cast: false });

  return { dispose() { mats.forEach((m) => m.dispose()); } };
}
