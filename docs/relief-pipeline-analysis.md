 # Empire CNC — Rölyef / Depth Pipeline Analizi ve Yeni Mimari Önerisi
 > **GÜNCEL DURUM (not):** Otomatik/AI rölyef sentez hattı (Depth Anything V2 AI
 > mikroservisi, `artReliefEngine.js`, `upsampleDepthGuided`, `/api/relief/ai-depth`
 > ve `/ai-status`) **kaldırıldı**. Kalan tek hat:
 > `HARİCİ DEPTH MAP → buildDepthGridFromExternalMap → buildReliefGcodeFromDepthGrid → CNC`.
 > Aşağıdaki analiz tarihsel referans olarak durmaktadır.

 > Bu belge **kod değişikliği içermez**. Amaç: mevcut `PHOTO → DEPTH → G-CODE`
> hattını satır satır inceleyip, "fotoğrafın derinlik haritası" yerine
> "heykelsi relief yüzeyi" üreten yeni bir mimari önermek.
>
> Referans (bozulmaması gereken) pipeline:
> `GOOD DEPTH MAP → buildDepthGridFromExternalMap → buildReliefGcodeFromDepthGrid → CNC`
> bu hattı **ground truth** kabul ediyoruz.

---

## 0. İncelenen dosyalar

| Dosya | Rol |
|---|---|
| `server/ai_service/main.py` | Depth Anything V2 çıkarımı + CNC için depth temizleme + rembg maskesi + QC |
| `server/routes/reliefRoutes.js` | Frontend ↔ AI servisi köprüsü (`/ai-depth`, `/ai-status`, `/generate`) |
| `client/src/components/ReliefGenerator.jsx` | Orkestrasyon: görsel yükleme, motor seçimi, AI çağrısı, pipeline tetikleme, G-code, STL, önizlemeler |
| `client/src/lib/relief/basReliefEngine.js` | **Ana işleme motoru** (1120 satır) — depth üretimi burada |
| `client/src/lib/relief/stlExporter.js` | Mesh/STL dışa aktarma |
| `client/src/lib/gcode/relief.js` | **G-code motoru** (bozulmayacak) — depth grid → G-code |
| `server/services/reliefGcode.js` | Sunucu tarafı G-code sarmalayıcı |
| `karsilastirma-ham-veri.txt` | G-code motoru ↔ gerçek ArtCAM dosyaları karşılaştırması |

---

## A) Mevcut Relief Pipeline'ının Adım Adım Açıklaması

### A.1 — AI tarafı (Python, `main.py`)

**Girdi:** kullanıcı fotoğrafı.

1. `preprocess_image()` — Uzun kenarı en fazla `MAX_INPUT_PX = 1024` px'e indir (VRAM/RAM).
2. `load_pipeline()` — Depth Anything V2 **Base** modeli (`depth-anything/Depth-Anything-V2-Base-hf`) yüklenir.
3. `gen_foreground_mask()` — **rembg U²-Net** ile ön plan/arka plan maskesi (0..1 float).
4. Model tahmini → `result["depth"]` (grayscale PIL).
5. **Lanczos4** ile depth, orijinal çözünürlüğe geri büyütülür; maske de aynı şekilde.
6. `process_depth_for_cnc()`:
   - `p_low, p_high = percentile(depth, 0.1, 99.9)` → `norm_macro` (**tüm kadraj üzerinden** normalize).
   - **rembg maskesi** uygulanır: `norm_macro *= (floor + (1-floor)*m)`, `floor=0.35` (düşük kapsamada 0.70). → **Arka plan şiddetle bastırılır.**
   - `norm_3d = norm_macro` (luminance **eklenmez** — burada bilinçli bir düzeltme var).
   - Kontrast (`contrast_boost`) + opsiyonel `foreground_gain`.
   - `remove_spikes` → `cv2.medianBlur(3)` / `median_filter`.
   - `smooth_radius > 0` → `cv2.bilateralFilter(sigmaColor=0.04)` (**hafif** yumuşatma).
   - "Relief-aware edge pass" — `sharpen`/`contrast` verilirse depth üzerinde unsharp mask (`amount ≤ 0.35`).
7. `analyze_and_verify_depth()` — QC: NaN onarımı, spike temizliği, uç kliplenme germe.
8. 16-bit little-endian ham veri → base64 → JSON (`depthDataBase64`).

> **Not:** AI tarafı luminance'ı bilinçli olarak geometriye karıştırmıyor (yorum satırlarında bu açıkça yazılı). Ancak **maske `floor=0.35`** ve **percentile(tüm kadraj)** burada iki büyük bilgi kaybı noktası.

### A.2 — Frontend orkestrasyon (`ReliefGenerator.jsx`)

**Motor modları:** `ai` | `hybrid` | `luma` | `custom`.

- **`ai`:** `/api/relief/ai-depth` çağrısı → base64 → `Uint16Array` → `Float32Array/65535` → `aiDepthData`.
- `useEffect` (satır 333+): kaynak görseli offscreen canvas'a çizer (en fazla 4096 px), luminance şablonu üretir (`guideLuma`), sonra `upsampleDepthGuided(...)` ile AI depth'i **kenar-rehberli (joint bilateral)** olarak tam çözünürlüğe büyütür, ardından `processBasReliefPipeline(imgData, rawAiDepth, {...})` çağır.
- **`custom`:** `buildDepthGridFromExternalMap(imgData, {...})` — **bu, kullanıcı-yüklü hazır depth map yolu** (ground truth, korunacak).
- **`hybrid`/`luma`:** `processBasReliefPipeline(imgData, null, {...})` — saf luminance yolu.

### A.3 — Depth motoru (`basReliefEngine.js`)

`processBasReliefPipeline(imgData, aiDepthMap, options)` 5 aşamaya bölünmüş:

| Aşama | Fonksiyon | Ne yapıyor |
|---|---|---|
| 1 | `detectIllustrationSource` | rawLuma + alpha tamponları; şeffaf/açık-nötr kenardan **flood-fill** ile arka plan maskesi (illüstrasyon tespiti) |
| 2 | `fuseBaseDepth` | AI varsa `removeSceneDepthRamp` + luminance'ın küçük oranı + `extractBasReliefDetails` (band-pass) karışımı |
| 3 | `applyDomeAndGain` | dome karışımı (≤0.35), foregroundGain (varsayılan 0), lokal kontrast |
| 4 | `applySurfaceToneAndSmoothing` | ton eğrisi → despeckle → bilateral → Taubin → `enhanceEdgeAwareDepth` → detay geri ekleme |
| 5 | `finalizeDepth` | percentile normalizasyon (0.35–99.65), invert, alfa rampası |

**Kritik alt-fonksiyonlar:**

- `extractBasReliefDetails` — luma'yı `broadLight` ile düzler (ışık telafisi), sonra 3 bant-pass farkı: `fine(1px)`, `med(4px)`, `structure(12px)` → `tanh` ile sıkıştırıp `*0.45`. **Bu tamamen luminance tabanlı bir "doku detayı" katmanıdır.**
- `removeSceneDepthRamp` — geniş Gaussian tabanı çıkarıp lokal normalize (%72) + orijinal makro depth (%28). **Nesnenin global hacmini + sahne rampasını bastır.**
- `deriveSurfaceSlope` — AI depth'in gradyanı; `fuseBaseDepth`'e `*0.045` katkı verir (çok küçük).
- `enhanceEdgeAwareDepth` — **Sobel(guidance)** ile kenar ağırlığı → depth üzerinde unsharp. Kenarları kabartır.
- `upsampleDepthGuided` — joint bilateral ile depth'i RGB kenarlarına kilitler.
- `buildDepthGridFromExternalMap` — **custom/hazır depth yolu**: luma oku → opsiyonel bilateral → backgroundMode (flat/zero/natural) → invert → alfa. **Basit ve temiz; bu korunmalı.**

### A.4 — G-code motoru (`relief.js`) — BOZULMAYACAK

`buildReliefGcodeFromDepthGrid(depthGrid, cols, rows, cfg)`:
- `sampleDepthGridUV` → **bilinear** örnekleme + gradyan.
- `calculateCompensatedZ` → **ballnose telafisi** (fiziksel eğim, `cosTheta`, offset ≤ `toolRadius*0.35`).
- Raster (x/y/diag/cross), `smoothZTrack(3)`, `simplifyPathPoints(0.006)`, dış kontur kesimi, park.
- Depth grid'in anlamı: **0 = taban/en derin, 1 = üst yüzey/en yüksek.**

> `karsilastirma-ham-veri.txt` G-code motorun gerçek üretim dosyalarına çok yakın
> çalıştığını gösteriyor. **G-code tarafına dokunmuyoruz.** Girdi sözleşmesi tek:
> `Float32Array` 0..1, satır-major, `width*height`.

---

## B) Her Aşamanın Ne İşe Yaradığı (özet)

- **preprocess 1024:** hız sınırı (ama monoküler depth zaten düşük frekanslı; bu AI'da kalite kaybı değil, tersine doğal bir düşük-geçiren).
- **rembg maskesi:** nesneyi arka plandan ayır → CNC'de "sticker/cutout" hissi buradan gelir.
- **percentile(tüm kadraj):** histogramı 0..1'e gerer → kontrastlı bölgeler (gökyüzü, parlak zemin) tüm aralığı kaplar.
- **band-pass detay (`extractBasReliefDetails`):** yüzey dokusu/mikro-kontrast.
- **removeSceneDepthRamp:** makro eğimleri (yol, zemin) bastır.
- **bilateral + Taubin:** CNC basamaklanmasını azaltır.
- **enhanceEdgeAwareDepth:** konturları kabartır.
- **finalize percentile:** son kontrastı açar.

---

## C) "Fotoğraf → Depth" Sonucunu Bozan Aşamalar (kök nedenler)

1. **AI depth = nihai height map olarak kullanılıyor.**
   `fuseBaseDepth`: `baseDepth = macro * 0.90 + dampened*0.04 + detailLayer*0.06`.
   Yani son yüzeyin **%90'ı** ham monoküler depth. Monoküler depth "kameraya uzaklık"tır — **yüzeyin Z'si değil.** Burun ucu ≠ "yüksek", sadece "öndeki nesne".

2. **rembg maskesi + `floor` değeri "cutout" üretiyor.**
   Arka plan `0.35` tabanına çekiliyor, sonra percentile ile geriliyor → obje "yapıştırılmış madalyon", arka plan "düz levha". Sürekli yüzey kayboluyor. (Senin "sticker sınırı olmamalı" isteğinle doğrudan çelişiyor.)

3. **Global percentile normalizasyon.**
   `applyPercentileNormalization(0.35, 99.65)` + AI tarafındaki `percentile(0.1, 99.9)`. Bir kadrajdaki en parlak gökyüzü/en karanlık zemin tüm ölçeği belirliyor → **nesne içi hacim aralığı eziliyor.** Yüz gibi orta-aralık objeler 0.4–0.6 bandına sıkışıp "flat" görünüyor.

4. **Band-pass detay katmanı luminance tabanlı.**
   `extractBasReliefDetails` ışık/gölge/parlamadan besleniyor → **parlak burun = yüksek çıktı** riski. Bu senin 6. maddedeki "bright pixel = high Z" hatasının kalıntısı. AI modunda `detailRetention=0.08` ile bastırılıyor ama `detailBoost` (0.8) pipeline'a giriyor.

5. **`enhanceEdgeAwareDepth` kenarları kabartıyor.**
   Sobel(guidance) ile kenar ağırlığı → unsharp. Göz çevresi koyu çizgi, saç konturu, kıyafet deseni → **yapay çıkıntı.** Senin 7. maddendeki hatanın ta kendisi.

6. **Tek ölçekli forma indirgeme.**
   Kodda "macro / mezo / mikro" band-pass var ama bunlar **aynı luma görüntüsün frekans bantları**, fiziksel hacim katmanları değil. "Burun kökü → sırt → uç" gibi sürekli makro form yok; sadece "kontrast" var.

7. **Yüzey sürekliliği / gradient-domain regularization yok.**
   `bilateral + Taubin` lokal; global yüzey düzgünlüğü (harmonic/Poisson) yok → komşu formlar arasında tutarsızlık.

8. **Semantic/form bilgisi yok.**
   Ne yüz, ne burun, ne yanak. Sadece "depth" ve "edge". → heykelsi yorum mümkün değil.

**Özet:** Sonuç neden "3D fotoğraf kabartması": çünkü yüzeyin %90'ı monoküler depth (mesafe), kontrastlı bölgeler band-pass ile öne itiliyor, kenarlar Sobel ile kabartılıyor, arka plan maskeyle koparılıyor. "Form" hiçbir aşamada açıkça modellenmiyor.

---

## D) Korunması Gereken İşlemler

- ✅ **G-code motorun tamamı** (`relief.js`, `reliefGcode.js`) — dokunma.
- ✅ **`buildDepthGridFromExternalMap` + `custom` motor modu** — hazır iyi depth map ground truth.
- ✅ **Çıktı sözleşmesi:** `{ depthGrid: Float32Array 0..1, width, height }` — G-code bunu bekliyor.
- ✅ **`upsampleDepthGuided`** — düşük çözünürlüklü depth'i kenar-rehberli büyütme faydalı; yeni hattın girişinde kullanılacak.
- ✅ **`verifyAndCorrectDepth` / `applyPercentileNormalization`** — QC ve son germe, ama **nesne-içi** olacak şekilde ayarlanarak.
- ✅ **`smoothMeshTaubin`, `despeckleSpikesFloat`, `bilateralFilterFloat`** — CNC yüzey kalitesi için araç olarak lazım.
- ✅ **`calculateCompensatedZ`, `sampleDepthGridUV`** — ballnose telafisi kritik.
- ✅ Frontend motor seçimi UI'ı, STL export, 3D/slice önizlemeler, süre tahmini.

---

## E) Değiştirilmesi Gereken İşlemler

- 🔁 **AI depth'in rolü:** "nihai height" → **"macro geometry rehberi"** (`depth_influence`, ör. %35-45). `fuseBaseDepth`'teki `*0.90` çok yüksek.
- 🔁 **rembg maskesi:** "sert cutout" → **soft background prior**. `floor` 0.35 → 0.70+ veya kullanıcı "Background Depth/Relief" kontrolü. Kenar feather genişletilir; pixel **hiç 0'a zorlanmaz** (arka plan da taban formu taşır).
- 🔁 **Global percentile:** → **nesne-içi (maskeli) normalize + kullanıcı Max/Min Relief Depth**. Kadrajın en parlak/karanlık pikseli ölçeği belirlemesin.
- 🔁 **Band-pass detay katmanı:** luminance yerine **AI depth + yumuşatılmış yüzey farkı** (form band-pass), luminance sadece çok düşük `edge_influence` ile.
- 🔁 **`enhanceEdgeAwareDepth`:** kenar kabartma yerine **kenar-koruyucu yumuşatma** (edge-aware smoothing, WLS/guided). Edge bilgisi yalnızca geçişleri korumak için.
- 🔁 **Dome/bevel:** ana geometri üreticisi değil; **border falloff/bevel** yardımcısı.

---

## F) Eklenmesi Gereken Yeni Aşamalar

1. **Semantic / structural understanding** — yüz, göz, burun, ağız, kulak, saç (ve genel obje) bölgeleri. (Segmentation maskesi değil, **form prior** olarak.)
2. **Multi-scale form decomposition** — MACRO / MEDIUM / FINE / MICRO **fiziksel hacim katmanları** (frekans bantları değil).
3. **Form regularizer / surface reconstruction** — gradient-domain (Poisson/harmonic) sürekli yüzey.
4. **Form-aware smoothing** — WLS / guided / anisotropic (basit Gaussian değil).
5. **Detail injection with macro protection** — mikro detay makro formu bozmadan.
6. **Relief shaping** — sürekli, heykelsi Z dağılımı (ör. alın→burun kökü→sırt→uç).
7. **CNC constraint stage** — max slope, tool radius, step-over, micro-detail low-pass, V-bit açısı.

---

## G) Önerilen Yeni Pipeline Mimarisi

```
PHOTO
  │
  ▼
[0] PREPROCESS / NORMALIZE  (renk→oransal luma, exposure/flat-field dengeleme)
  │
  ▼
[1] SEMANTIC & STRUCTURE  (parça bölgeleri: face/eyes/nose/mouth/hair/body/obj; arka plan prior)
  │        └─ çıktı: region labels + confidence + soft background prior (+ maske DEĞİL)
  ▼
[2] AI MACRO DEPTH  (Depth Anything V2 → "önde/geride" rehberi; sadece prior)
  │        └─ nesne-içi normalize; scene-ramp kaldır
  ▼
[3] FORM RECONSTRUCTION  ◄── YENİ ÇEKİRDEK
  │   • macro volumetrics  (depth rehberli, semantic prior ile düzeltilmiş)
  │   • structural surfaces (yüzey sürekliliği: harmonic/Poisson regularization)
  │   • form curvature (alın/yanak/burun kavisleri)
  │        └─ çıktı: tek, sürekli, semantic-tutarlı base Z(x,y)
  ▼
[4] MULTI-SCALE FORM DECOMPOSITION
  │   L1 MACRO  | L2 MEDIUM | L3 FINE | L4 MICRO   (her biri kendi Z katkısı)
  ▼
[5] FORM-AWARE SMOOTHING  (WLS/guided, edge-aware; Gaussian değil)
  │
[6] DETAIL INJECTION  (edge/luminance sadece destek; macro'yu asla bozmaz)
  │
[7] RELIEF SHAPING  (S-curve / compress, sürekli heykelsi aralık, kullanıcı Relief Contrast)
  │
[8] BACKGROUND CONTROL  (Background Depth / Relief: flat | dome | soft-falloff | vignette)
  │
[9] HEIGHT NORMALIZATION  (nesne-içi percentile + Max/Min Relief Depth)
  │
[10] CNC CONSTRAINTS  (max slope, tool radius, step-over, micro low-pass, V-bit)
  │
  ▼
FINAL HEIGHT MAP  { depthGrid: Float32Array 0..1, width, height }
  │
  ▼
[MEVCUT] buildReliefGcodeFromDepthGrid  ← DEĞİŞMEZ
```

### G.1 Yeni çıktı sözleşmesi (geriye dönük uyumlu)

Yeni motor **aynı** sözleşmeyi üretsin, böylece G-code ve STL yolu hiç değişmez:

```js
// Yeni: processSculptedReliefPipeline(imgData, aiDepthMap, options)
//    → { depthGrid: Float32Array, width, height }   // 0 = taban, 1 = tepe
```

`ReliefGenerator.jsx`'te yeni bir `engineMode: 'sculpted'` (veya mevcut `'ai'`
modun içinde `reconstruction: 'form'`) açılır; `custom` modu **aynen** kalır.

### G.2 Motor içi parametreler (kullanıcıya çoğu gizli)

| Parametre | Rol (öneri) | UI |
|---|---|---|
| `macroFormStrength` | L1 hacim | gizli (preset türetir) |
| `mediumFormStrength` | L2 hacim | gizli |
| `fineDetailStrength` | L3 | "Detay" slider |
| `microDetailStrength` | L4 | gizli (CNC low-pass sınırlar) |
| `depthInfluence` | AI depth ağırlığı | gizli (≈0.40) |
| `surfaceContinuity` | regularization gücü | gizli |
| `formSmoothness` | form-aware smooth | gizli |
| `edgeInfluence` | edge desteği | gizli (≤0.15) |
| `semanticInfluence` | bölge prior ağırlığı | gizli |
| `backgroundDepth` | arka plan Z tabanı | **slider** |
| `reliefContrast` | shaping | **slider** |
| `maxReliefDepth` | mm | mevcut `maxDepth` |

---

## H) Kritik Tasarım Avantajları (isteğinle eşleşme)

- **"Cutout değil, continuous sculpted surface":** rembg cutout kaldırılıyor, arka plan soft prior + taban formu.
- **"AI depth atılmasın ama nihai olmasın":** `depthInfluence ≈ 0.40`, geri kalanı form reconstruction.
- **"Burun kökünden uca sürekli form":** L1/L2 volumetrics + harmonic reconstruction +
  semantic prior (burun bölgesi tespit edilirse form sürekliliği **zorlanır**).
- **"Micro detail macro'yu bozmasın":** katmanlı ayrıştırma + CNC low-pass.
- **"Kenar ≠ form":** edge katkısı ≤0.15 ve sadece yumuşatma rehberi.
- **"Luminance = depth değil":** luminance sadece FINE/MICRO destek katmanı, `edge_influence` ile kısıtlı.
- **"G-code motoru bozulmasın":** çıktı sözleşmesi birebir korunuyor; `custom` modu referans olarak duruyor.

---

## I) Uygulama Planı (kod aşaması — onaydan sonra)

**Faz 1 — Motor iskeleti (client/lib/relief/):**
1. `formReconstructionEngine.js` — L1/L2 volumetrics + harmonic/Poisson surface regularizer + WLS form-aware smooth.
2. `semanticPrior.js` — opsiyonel; AI stack'ten segmentation yoksa başlangıçta geometri-tabanlı prior (derinlik + süreklilik), sonra FastSAM/CLIP-seg entegrasyonu.
3. `processSculptedReliefPipeline.js` — yukarıdaki [0]–[10] adımlarını saran tek giriş.

**Faz 2 — Entegrasyon:**
4. `ReliefGenerator.jsx`'e `sculpted` motor modu + Background Depth / Relief Contrast slider'ları. `custom` ve `ai` modları **aynen** kalır.
5. Çıktı sözleşmesi korunur → G-code/STL/önizleme dokunulmaz.

**Faz 3 — Doğrulama (madde 16):**
6. `server/ai_service/benchmark-fixture.png` + 12 test türü için ölçüm scripti:
   hacim hissi, yüzey sürekliliği, makro koruma, gölge-gerçek geometri karışması,
   kenar çıkıntısı, arka plan sticker, CNC işlenebilirlik.
7. Görsel karşılaştırma: `custom` (iyi depth) ground truth'a benzerlik vs `ai` (eski).

---

## J) Risk / Dikkat

- **Semantic model entegrasyonu** ağır olabilir (RAM/VRAM). Minimum sürümde
  semantic prior, AI depth + continuity'den **türev** olarak çıkarılabilir; tam
  segmentasyon opsiyonel katman olarak eklenir.
- **Poisson/harmonic solver** büyük görsellerde pahalı → çok ölçekli/multigrid veya
  downsample-solve-upsample yaklaşımı gerekebilir.
- **`custom` modu asla bozulmayacak** — regresyon testi şart.
- Yeni parametreler CNC fiziksel limitlerine (max slope, tool radius, step-over)
  göre otomatik kısıtlanmalı; kullanıcıya teknik yük bindirilmeyecek.
