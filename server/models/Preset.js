import mongoose from 'mongoose';

const ToolRowSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    toolNo: { type: String, required: true },
    operation: { type: String, enum: ['offset', 'derz', 'carving'], default: 'offset' },
    depth: { type: Number, required: true },
    stepOffset: { type: Number, required: true },
    // Rounded-corner offset pass: radius in mm (null = plain square corner).
    // When set, the pass is cut as a single closed profile with G2/G3 corner arcs.
    cornerRadius: { type: Number, default: null },
    // Per-row cut feed override (mm/min). null = fall back to the shared cutFeed.
    feed: { type: Number, default: null },
    // Carving-only: closed single-line profile (V-bit).
    cornerSharpen: { type: Boolean, default: true },
    // null = use the row's depth (1:1 confirmed on 1_NUMARA.cnc; override when asked)
    cornerSharpenDistance: { type: Number, default: null },
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
    // Upper edge style for kapak (door / tabla) parts.
    topStyle: { type: String, enum: ['flat', 'semicircle', 'pointed'], default: 'flat' },
    // Rise ratio for topStyle:'pointed' (rise = innerW * riseRatio). Ignored otherwise.
    riseRatio: { type: Number, default: 0.125 },
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
