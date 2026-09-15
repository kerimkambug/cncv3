import express from 'express';
import multer from 'multer';
import { generateReliefGcodeFromGrid } from '../services/reliefGcode.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // Max 30MB
});

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

/**
 * AI Servisi Sağlık & Durum Kontrolü
 * GET /api/relief/ai-status
 */
router.get('/ai-status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(`${AI_SERVICE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const data = await resp.json();
      return res.json({ ok: true, available: true, ...data });
    }
    res.json({ ok: false, available: false, error: 'AI Servisi yanıt vermiyor.' });
  } catch (err) {
    res.json({
      ok: false,
      available: false,
      error: 'AI Mikroservisi çalışmıyor (Port 8000).',
      detail: err.message,
    });
  }
});

/**
 * AI Derinlik Haritası Üretimi (Depth Anything V2)
 * POST /api/relief/ai-depth
 * Form-data: file / image
 */
router.post('/ai-depth', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Lütfen işlenecek bir görsel yükleyin.' });
    }

    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'image/png' });
    formData.append('file', blob, req.file.originalname || 'input.png');

    const smooth = req.query.smooth || req.body?.smooth || '2';
    const contrast = req.query.contrast || req.body?.contrast || '1.15';
    const sharpen = req.query.sharpen || req.body?.sharpen || '0.35';
    const bitDepth = req.query.bit_depth || req.body?.bit_depth || '16';
    const useBackgroundMask = req.query.use_background_mask || req.body?.use_background_mask || 'true';

    const queryParams = new URLSearchParams({
      smooth: String(smooth),
      contrast: String(contrast),
      sharpen: String(sharpen),
      bit_depth: String(bitDepth),
      use_background_mask: String(useBackgroundMask),
    });

    const aiResponse = await fetch(`${AI_SERVICE_URL}/generate-depth?${queryParams}`, {
      method: 'POST',
      body: formData,
    });

    if (!aiResponse.ok) {
      const errDetail = await aiResponse.text();
      return res.status(502).json({
        error: `AI Servisi hata döndürdü (${aiResponse.status}): ${errDetail}`,
      });
    }

    const depthResult = await aiResponse.json();
    if (!depthResult.ok || !depthResult.depthDataBase64) {
      return res.status(502).json({ error: 'AI servisi geçerli bir depth verisi döndürmedi.' });
    }

    res.json({
      ok: true,
      width: depthResult.width,
      height: depthResult.height,
      bitDepth: depthResult.bitDepth,
      depthDataBase64: depthResult.depthDataBase64,
      fileName: req.file.originalname,
      size: req.file.size,
      qcPasses: depthResult.qcPasses,
      qcReport: depthResult.qcReport,
    });
  } catch (err) {
    console.error('[AI Depth Route Error]:', err);
    res.status(503).json({
      error: 'AI Derinlik servisine bağlanılamadı. Lütfen Python mikroservisinin (server/ai_service) 8000 portunda çalıştığından emin olun.',
      detail: err.message,
    });
  }
});

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

