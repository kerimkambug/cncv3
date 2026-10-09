// Runs the nesting search off the UI thread. Input: the object from nestInput().
import { nest } from './nest.js';

self.onmessage = (e) => {
  try {
    const result = nest({ ...e.data, onProgress: (p) => self.postMessage({ type: 'progress', ...p }) });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
