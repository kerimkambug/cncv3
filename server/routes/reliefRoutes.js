import express from 'express';
import { generateReliefGcodeFromGrid } from '../services/reliefGcode.js';

const router = express.Router();

/**
 * G-Code Üretimi
 * POST /api/relief/generate
 */
router.post('/generate', (req, res) => {
  try {
    const { depthGrid, config } = req.body;
    if (!depthGrid || !Array.isArray(depthGrid)) {
      return res.status(400).json({ error: 'depthGrid matrisi zorunludur.' });
    }
    const gcode = generateReliefGcodeFromGrid(depthGrid, config || {});
    res.json({ ok: true, gcode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

