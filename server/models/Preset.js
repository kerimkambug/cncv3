import mongoose from 'mongoose';

const ToolRowSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    toolNo: { type: String, required: true },
    operation: { type: String, enum: ['offset', 'derz'], default: 'offset' },
    depth: { type: Number, required: true },
    stepOffset: { type: Number, required: true },
    derz: {
      yon: { type: String, enum: ['dikey', 'yatay'], default: 'dikey' },
      margin: { type: Number, default: 0 },
      spacing: { type: Number, default: 60 },
      autoFit: { type: Boolean, default: true },
      overshoot: { type: Number, default: 1 },
      overshootX: { type: Number, default: 1 },
      overshootY: { type: Number, default: 1 },
      edgeExtra: { type: Number, default: 0 },
      outerFrame: { type: Boolean, default: false },
      respectPreviousOffset: { type: Boolean, default: true },
    },
  },
  { _id: false }
);

const PresetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    module: { type: String, enum: ['kapak', 'cam'], default: 'kapak' },
    category: { type: String, enum: ['kapak', 'kapi'], default: 'kapak' },
    imageDataUrl: { type: String, default: '' },
    description: { type: String, default: '' },
    previewWidth: { type: Number, default: 600 },
    previewHeight: { type: Number, default: 600 },
    thickness: { type: Number, default: 18 },
    spindleSpeed: { type: Number, default: 18000 },
    safeZ: { type: Number, default: 61 },
    toolChangeZ: { type: Number, default: 96 },
    homeZ: { type: Number, default: 96 },
    plungeFeed: { type: Number, default: 3000 },
    cutFeed: { type: Number, default: 6000 },
    offsetMode: { type: String, enum: ['relative', 'absolute'], default: 'relative' },
    rows: { type: [ToolRowSchema], default: [] },
    // Cam-specific fields (unused for module:'kapak')
    camSettings: {
      gozSayisi: Number,
      kolonSayisi: Number,
      disMargin: Number,
      icerGap: Number,
      oturmaPayi: Number,
      toolDia: Number,
      kesimToolNo: String,
      taramaToolNo: String,
      taramaDepth: Number,
      stepover: Number,
    },
  },
  { timestamps: true }
);

// One preset name per module (mirrors the original's object-keyed preset.json)
PresetSchema.index({ name: 1, module: 1 }, { unique: true });

export default mongoose.model('Preset', PresetSchema);
