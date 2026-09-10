import mongoose from 'mongoose';

/**
 * Tries to connect to MongoDB but NEVER kills the process if it fails.
 * When there's no MongoDB available, presetStore.js automatically falls
 * back to a local JSON file (server/data/presets.json) so the app still
 * works with zero setup. Point MONGODB_URI at a real instance (local or
 * Atlas) whenever you're ready and restart the server — it'll pick Mongo
 * back up automatically, no code changes needed elsewhere.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[db] MONGODB_URI not set — using local file storage (server/data/presets.json).');
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log(`[db] connected: ${uri}`);
  } catch (err) {
    console.warn(`[db] MongoDB connection failed (${err.message}) — falling back to local file storage.`);
  }
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}
