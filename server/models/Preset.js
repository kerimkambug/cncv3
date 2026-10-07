import mongoose from 'mongoose';

const ToolRowSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    toolNo: { type: String, required: true },
    operation: { type: String, enum: ['offset', 'derz', 'carving'], default: 'offset' },
    depth: { type: Number, required: true },
    stepOffset: { type: Number, required: true },
    // Rows pinned to an EXACT contour from the part edge, in mm, independent of
    // stepOffset. kapak.js's calculateAdaptiveOffsets freezes the offset chain at
    // this value and every later row keeps adding its own step on top — that is
    // how a coarse clearing pass listed at 3mm still cuts on the real 16mm
    // contour of the production file.
    //
    // It MUST exist in the schema: the Mongoose schema is strict by default, so
    // without the field a POST/PUT would silently strip absoluteOffset and the
    // saved preset would no longer reproduce the contour it was captured from.
    // fileStore.js and usePresets.js both backfill it from stepOffset for
    // absolute-mode presets saved before this field existed; this keeps that
    // fallback working for data already in Mongo.
    absoluteOffset: { type: Number, default: null },
    // Rounded-corner offset pass: radius in mm (null = plain square corner).
    // When set, the pass is cut as a single closed profile with G2/G3 corner arcs.
    cornerRadius: { type: Number, default: null },
    // Per-row cut feed override (mm/min). null = fall back to the shared cutFeed.
    feed: { type: Number, default: null },
    // Carving-only: the V-bit's INCLUDED angle in degrees — the angle between its two
    // flanks, which is how bits are sold: 60 / 90 / 120. The shop's "kenara 45°"
    // (45° to the edge) is a 90° included bit, so that is stored as 90.
    // It is the ONLY extra carving input: stepOffset says where the flat floor runs,
    // depth says how deep, and the angle derives the corner ramp (depth/tan(angle/2)).
    // null = legacy row: no angle, corner ramp falls back to the 1:1 rule (a 90° bit).
    bitAngle: { type: Number, default: null },
    // --- Row-emission flags read by kapak.js / nesting.js -------------------
    // These three are read by the G-code engine (kapak.js emitOffsetPasses) but
    // were missing from the schema. Because Mongoose is strict by default, an
    // API POST/PUT would silently strip them, so a preset saved through the app
    // no longer reproduced the toolpath it was captured from (1 NUMARA's square
    // roughing passes and 7 NUMARA's chained inner rings were being lost).
    //
    // roughing: cut this offset pass as a plain SQUARE rectangle instead of the
    //   rounded profile — ArtCAM's "2D Area Clearing / Pocket" pass. 1 NUMARA
    //   uses it for the 62/59 mm clearing rectangles.
    roughing: { type: Boolean, default: false },
    // chain: continue at depth from the previous pass without retracting to
    //   safe Z and re-plunging (consecutive rowIdx, same tool, same depth).
    //   1 NUMARA (r6->r3) and 7 NUMARA (four inner rings) use it.
    chain: { type: Boolean, default: false },
    // repeatStartY: on the cut move, repeat the start Y even though it did not
    //   change ("G1 X152.90 Y139.10 F9000.0" instead of "G1 X152.90 F9000.0").
    //   ArtCAM emits this style for 7 NUMARA's chained rings.
    repeatStartY: { type: Boolean, default: false },
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
      // startY: explicit bottom-edge start of a vertical divider (mm from the part
      //   bottom), overriding the first offset row's stepOffset. 1/12 NUMARA's
      //   dividers start at Y70 (the rounded-frame offset), not rows[0]'s 62.
      //   Read by kapak.js emitDerzRows; missing from the schema until now, so an
      //   API POST/PUT silently stripped it (same failure class as absoluteOffset).
      startY: { type: Number, default: null },
      // spindleSpeed: per-derz-block spindle override (2 NUMARA's derz block runs
      //   at S15000 while the rest of the program is S18000). Also read by kapak.js.
      spindleSpeed: { type: Number, default: null },
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
