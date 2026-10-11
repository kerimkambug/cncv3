import { Router } from 'express';
import { toolStore, validateTools } from '../store/toolStore.js';

const router = Router();

// null = nothing saved yet (the browser then offers its own copy)
router.get('/', async (req, res, next) => {
  try { res.json(await toolStore.get()); } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const why = validateTools(req.body);
    if (why) return res.status(400).json({ error: why });
    res.json(await toolStore.set(req.body));
  } catch (err) { next(err); }
});

export default router;
