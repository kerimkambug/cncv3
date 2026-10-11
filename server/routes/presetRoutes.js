import { Router } from 'express';
import {
  listPresets,
  getPreset,
  createPreset,
  updatePreset,
  deletePreset,
  renderPresetImages,
} from '../controllers/presetController.js';

const router = Router();

router.get('/', listPresets);
router.get('/:id', getPreset);
router.post('/', createPreset);
// admin: remake every model's picture from its own rows (works on MongoDB too)
router.post('/render-images', renderPresetImages);
router.put('/:id', updatePreset);
router.delete('/:id', deletePreset);

export default router;
