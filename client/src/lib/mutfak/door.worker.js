// Builds door surfaces off the UI thread (one message per door size and model).
import { doorRelief } from './doorRelief.js';

self.onmessage = (e) => {
  const { key, preset, w, h, tools, kulp } = e.data;
  try {
    const r = doorRelief(preset, w, h, tools, kulp);
    if (!r) { self.postMessage({ key, relief: null }); return; }
    self.postMessage({ key, relief: r }, [r.normal.buffer, r.shade.buffer]);
  } catch (err) {
    self.postMessage({ key, relief: null, error: err.message });
  }
};
