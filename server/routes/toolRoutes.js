import { Router } from 'express';
import { machineStore, toolStore, validateTools } from '../store/toolStore.js';

const isAdmin = (req) => req.user?.role === 'admin';
const uid = (req) => (req.user ? String(req.user._id) : null);

/**
 * Tools (Atölye → Bıçaklar): the admin edits the workshop default; anyone else
 * edits their own copy, which starts from the default and can be dropped.
 *   GET    /          what this user works with ({value, updatedAt, scope} or null)
 *   GET    /default   the admin's default
 *   PUT    /          admin → the default, others → their own copy
 *   DELETE /          drop the own copy (back to the default)
 */
export const toolRoutes = Router();

toolRoutes.get('/', async (req, res, next) => {
  try { res.json(await toolStore.get(isAdmin(req) ? null : uid(req))); } catch (err) { next(err); }
});
toolRoutes.get('/default', async (req, res, next) => {
  try { res.json(await toolStore.getDefault()); } catch (err) { next(err); }
});
toolRoutes.put('/', async (req, res, next) => {
  try {
    const why = validateTools(req.body);
    if (why) return res.status(400).json({ error: why });
    res.json(await toolStore.set(req.body, isAdmin(req) ? null : uid(req)));
  } catch (err) { next(err); }
});
toolRoutes.delete('/', async (req, res, next) => {
  try {
    if (!isAdmin(req)) await toolStore.clear(uid(req));
    res.json(await toolStore.get(isAdmin(req) ? null : uid(req)));
  } catch (err) { next(err); }
});

/** Machine and plate defaults (Atölye → Makine): everyone reads, the admin sets. */
export const machineRoutes = Router();

machineRoutes.get('/', async (req, res, next) => {
  try { res.json(await machineStore.getDefault()); } catch (err) { next(err); }
});
machineRoutes.put('/', async (req, res, next) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Varsayılan ayarları yalnızca yönetici değiştirebilir.' });
    const v = req.body;
    if (!v || typeof v !== 'object' || typeof v.machine !== 'object' || typeof v.plate !== 'object') {
      return res.status(400).json({ error: 'Ayar bozuk: machine ve plate gerekli.' });
    }
    res.json(await machineStore.set({ machine: v.machine, plate: v.plate }));
  } catch (err) { next(err); }
});

export default toolRoutes;
