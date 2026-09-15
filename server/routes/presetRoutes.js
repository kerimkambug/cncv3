import { Router } from 'express';
import {
  listPresets,
  getPreset,
  createPreset,
  updatePreset,
  deletePreset,
} from '../controllers/presetController.js';

const router = Router();

router.get('/', listPresets);
router.get('/:id', getPreset);
router.post('/', createPreset);
router.put('/:id', updatePreset);
router.delete('/:id', deletePreset);

export default router;
