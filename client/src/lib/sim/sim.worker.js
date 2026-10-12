// Runs the material-removal simulation off the UI thread, and builds the 3D
// surface of the result there too (marching cubes around hollows takes a moment).
import { simulate } from './millSim.js';
import { partSurface } from './dexelMesh.js';

/** Column stride of the 3D view: at most ~800 points along the long side. */
export const viewStride = (grid) => Math.max(1, Math.ceil(Math.max(grid.w, grid.h) / 800));

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
