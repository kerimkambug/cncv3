import mongoose from 'mongoose';

// One workshop-wide value per key (e.g. 'tools': the tool library + magazine).
const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.models.Setting || mongoose.model('Setting', SettingSchema);
