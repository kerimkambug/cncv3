// Runs the material-removal simulation off the UI thread, and builds the 3D
// surface of the result there too (marching cubes around hollows takes a moment).
import { simulate } from './millSim.js';
import { partSurface } from './dexelMesh.js';

/** Column stride of the 3D view: at most ~1600 points along the long side (fine relief stays visible). */
export const viewStride = (grid) => Math.max(1, Math.ceil(Math.max(grid.w, grid.h) / 1600));

self.onmessage = (e) => {
  try {
    const { text, top, cell, tools, box } = e.data;
    const { grid, stats } = simulate(text, { top, cell, tools, box: box || null });
    const surface = partSurface(grid, viewStride(grid));
    self.postMessage({ type: 'done', grid, stats, surface }, [
      grid.z.buffer, surface.vertices.buffer, surface.index.buffer, surface.sides.buffer,
      surface.mc.positions.buffer, surface.mc.normals.buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
