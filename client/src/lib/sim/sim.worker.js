// Runs the material-removal simulation off the UI thread.
import { simulate } from './millSim.js';

self.onmessage = (e) => {
  try {
    const { text, top, cell, tools, box } = e.data;
    const { grid, stats } = simulate(text, { top, cell, tools, box: box || null });
    self.postMessage({ type: 'done', grid, stats }, [grid.z.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
