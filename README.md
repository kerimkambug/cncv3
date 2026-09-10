# Empire CNC — MERN Sürümü

Orijinal 2500+ satırlık tek HTML dosyasının, her özelliği kendi dosyasında
olacak şekilde bölünmüş hali. Amaç: bir özellik üzerinde çalışırken (ör.
sadece Daire Kesimi) sadece o dosyayı okumak yeterli olsun, bütün sistemi
baştan okumaya gerek kalmasın.

## Klasör yapısı

```
empire-cnc-mern/
  server/                      Express backend (preset saklama)
    index.js                   giriş noktası
    config/db.js                mongo bağlantısı (opsiyonel, bulunamazsa dosyaya düşer)
    store/fileStore.js          MongoDB yoksa kullanılan yerel dosya deposu
    data/presets.json           (otomatik oluşur) MongoDB bağlı değilken presetlerin durduğu yer
    models/Preset.js            preset şeması (MongoDB için)
    controllers/presetController.js  hangi depo aktifse onu kullanır, frontend farkı hissetmez
    routes/presetRoutes.js
    .env.example

  client/
    src/
      lib/gcode/                 ⭐ TÜM HESAPLAMA MANTIĞI BURADA — React'tan bağımsız, saf JS
        common.js                 ortak yardımcılar (fmt, computeCumOffsets)
        kapak.js                  Tek Ölçü / Toplu Liste g-code üretimi
        circle.js                 Daire Kesimi (düz daire + çember)
        derz.js                   Derz Bölme (paralel çizgiler)
        cam.js                    Cam Modelleri — Kesim (göz ızgarası)
        camTarama.js              Cam Modelleri — Tarama (Clipper.js offset pocket clearing)
        nesting.js                Nesting (bin-packing) + plaka bazlı g-code export

      components/
        Topnav.jsx, Sidebar.jsx, Footer.jsx
        kapak/
          KapakModule.jsx         5 işlemi bir araya getiren üst bileşen
          MachineSettingsPanel.jsx  genel ayarlar (kalınlık, S, feed'ler)
          ToolRows.jsx             bıçak sırası editörü
          PresetPanel.jsx          preset yükle/kaydet/sil (backend'e bağlı)
          TekOlcu.jsx
          TopluListe.jsx
          NestingPanel.jsx
          NestingPlateCanvas.jsx    plaka üzerinde renkli parça + kesim yolu önizlemesi (PNG export)
          DaireKesimi.jsx
          DerzBolme.jsx
          PanjurBolme.jsx           panjur/jaluzi çıta kesimi (rampalı raster tarama)
        cam/
          CamModule.jsx            ortak ölçü/takım ayarları
          CamKesimPanel.jsx
          CamTaramaPanel.jsx

      hooks/usePresets.js         preset REST API'sini saran hook (localStorage yerine)
      App.jsx                     üst düzey layout + modül/işlem yönlendirmesi
      main.jsx                    React giriş noktası
      index.css                   orijinal dosyadan taşınan tüm stiller
```

## Neden bu şekilde bölündü

- **`lib/gcode/*`** dosyalarının hiçbiri React, DOM ya da başka bir dosyaya
  bağımlı değil (sadece birbirlerine). Bir AI'ya "Daire Kesimi'nde şu hata
  var" dersen, sadece `circle.js`'i (70 satır) okuması yeterli —
  `kapak.js`, `nesting.js`, React bileşenleri falan hiç gerekmiyor.
- Her **işlem** (Tek Ölçü, Nesting, Derz Bölme, Cam Kesim/Tarama vs.) kendi
  React dosyasında. Aralarında ortak state yok, sadece `cfg` prop'u ile
  besleniyorlar.
- **Presetler MongoDB'de VEYA yerel bir dosyada** saklanır — MongoDB
  bağlıysa onu kullanır, bağlı değilse otomatik olarak
  `server/data/presets.json`'a yazar. Hiçbir kurulum yapmadan direkt
  çalıştırabilirsin; MongoDB'yi ne zaman bağlarsan sunucu bir sonraki
  başlatışta ona geçer (kod değişikliği gerekmez).

## Özellik eşleşmesi (orijinal HTML ↔ bu sürüm)

| Orijinal HTML özelliği | Bu sürümde |
|---|---|
| Tek Ölçü / Toplu Liste / Nesting / Daire Kesimi / Derz Bölme | ✅ birebir, `lib/gcode/*` + ilgili component |
| Cam Modelleri (Kesim + Tarama, Clipper.js) | ✅ `cam.js` + `camTarama.js` |
| Panjur/jaluzi çıta kesimi (rampalı raster tarama) | ✅ `panjur.js` — gerçek üretim dosyasından çıkarılıp doğrulandı |
| M6T/M3/M5 aynı-takım atlama optimizasyonu | ✅ `kapak.js`, `nesting.js` |
| Daire merkez ofseti + iç-önce-dış-sonra kesim sırası | ✅ `circle.js` |
| Derz oto-sığdırma + kenar payı azaltma | ✅ `derz.js` |
| Offset Modu (Kümülatif / Mutlak) anahtarı | ✅ `MachineSettingsPanel.jsx` |
| Nesting görsel önizleme (renkli parça + kesim yolu + legend) | ✅ `NestingPlateCanvas.jsx` |
| Nesting PNG dışa aktarma | ✅ aynı bileşende |
| Nesting'e dosyadan parça içe aktarma (CSV/TXT) | ✅ `parseNestImportText` |
| Preset kaydet/yükle/sil | ✅ `PresetPanel.jsx` (backend'e bağlı) |
| preset.json içe/dışa aktarma | ✅ aynı panelde — eski `preset.json` dosyaları doğrudan yüklenebilir |
| Ctrl+Enter kısayolu | ✅ `useCtrlEnter` hook'u, her üretim ekranında |
| Ayarlar/Bıçaklar modalı | Modal değil, hep-açık kart (senin ayrı isteğinle böyle değiştirilmişti) |
| Preset dosyasını File System Access API ile diskte seçme | Yerine MongoDB/dosya tabanlı backend + preset.json import/export — daha esnek, farklı mekanizma |

## Doğrulama

Tüm `lib/gcode/*` modülleri gerçek üretim dosyalarına karşı test edildi —
testler projenin içinde duruyor, istediğin an tekrar çalıştırabilirsin:

```bash
cd client
npm install
node src/lib/gcode/smoke.test.js
```

20 kontrolün hepsi geçmeli (`ALL CHECKS PASSED`). Kapsadığı noktalar: T9→T9
aynı takım ardışıklığında M6T/M3/M5 atlama, daire merkez ofseti, derz
oto-sığdırma + gerçek 73-çizgi eşleşmesi, cam kesim/tarama koordinatları,
panjur çıta rampası (gerçek dosyayla 86 adım/çıta eşleşmesi), offset modu
(kümülatif/mutlak), nesting parça paketleme ve dosya içe aktarma.

## Çalıştırma

### 1) Backend

**Hiçbir kurulum yapmadan (varsayılan, önerilen başlangıç):**

```bash
cd server
npm install
npm run dev                # veya: npm start
```

`.env` dosyası yoksa ya da içinde `MONGODB_URI` yoksa sunucu otomatik olarak
`server/data/presets.json`'a yazar — MongoDB kurmana gerek yok, direkt çalışır.

**MongoDB'ye geçmek istediğinde:**

```bash
cp .env.example .env
# .env içinde MONGODB_URI satırının başındaki # işaretini kaldır, adresini yaz
npm run dev
```

MongoDB kurulu değilse: [MongoDB Community](https://www.mongodb.com/try/download/community)
kur ya da ücretsiz bir [MongoDB Atlas](https://www.mongodb.com/atlas) cluster'ı
oluşturup `MONGODB_URI`'yi ona göre ayarla. Sunucu başlarken hangi depoyu
kullandığını konsola yazar (`[server] preset storage: ...`), `/api/health`
endpoint'i de aynı bilgiyi döner.

### 2) Frontend

```bash
cd client
npm install
npm run dev
```

Tarayıcıda `http://localhost:5173` açılır. Vite, `/api` isteklerini otomatik
olarak `http://localhost:4000`'e yönlendirir (bkz. `vite.config.js`).

### Production build

```bash
cd client
npm run build      # dist/ klasörünü üretir, herhangi bir statik sunucudan servis edilebilir
```

## Bilinen sınırlama

- Cam Modelleri'nde tarama köşeleri hâlâ keskin (kare) — ArtCAM'deki
  dekoratif rozet/fileto detayı bu sürümde de yok (orijinalde de yoktu,
  bu bir MERN-dönüşüm eksiği değil).
- Cam Modelleri'nin kendi ayarları için preset sistemi yok (Kapak'ta var).
  İstenirse `CamModule.jsx`'e `module:'cam'` filtresiyle aynı `PresetPanel`
  deseni eklenebilir — altyapı (backend, model) zaten hazır.
