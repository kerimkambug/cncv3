import { useState, useEffect, useMemo } from 'react';
import { generatePanjurGcode, panjurGroups } from '../../lib/gcode/panjur.js';
import { useCtrlEnter } from '../../hooks/useCtrlEnter.js';

export default function PanjurModule({ onBackToMenu }) {
  const [width, setWidth] = useState(200);
  const [height, setHeight] = useState(200);
  const [offsetMode, setOffsetMode] = useState('normal');
  const [direction, setDirection] = useState('y');
  const [offset, setOffset] = useState(60);
  const [offsetLeft, setOffsetLeft] = useState(60);
  const [offsetRight, setOffsetRight] = useState(60);
  const [offsetBottom, setOffsetBottom] = useState(60);
  const [offsetTop, setOffsetTop] = useState(60);
  const [centerFlat, setCenterFlat] = useState(0);

  const [pitch, setPitch] = useState(40.5);
  const [exitGap, setExitGap] = useState(0.45);
  const [stepover, setStepover] = useState(0.468);
  const [edgeInset, setEdgeInset] = useState('auto');
  const [startZ, setStartZ] = useState(17.937);
  const [endZ, setEndZ] = useState(3.105);
  const [feed, setFeed] = useState(20000);
  const [groundEntry, setGroundEntry] = useState(false);
  const [exitCut, setExitCut] = useState(4);
  const [t4Z, setT4Z] = useState(9); // İlk dalış derinliği (2 pasolu kesim için)
  const [t4Feed, setT4Feed] = useState(5000); // T4 kesim hızı (rölyef feed'i T14 için)

  const [toolNo, setToolNo] = useState('14');
  const [spindle, setSpindle] = useState(12000);
  const [plunge, setPlunge] = useState(3000);
  const [drillTool, setDrillTool] = useState('4');
  const [exitToolDia, setExitToolDia] = useState(4);
  const [drillSpindle, setDrillSpindle] = useState(12000);
  const [t14TipDia, setT14TipDia] = useState(2);
  const [t14BodyDia, setT14BodyDia] = useState(12);
  const [t14Height, setT14Height] = useState(65);

  const [safeZ, setSafeZ] = useState(30);
  const [toolChangeZ, setToolChangeZ] = useState(30);
  const [homeZ, setHomeZ] = useState(30);

  const [output, setOutput] = useState('');
  const [message, setMessage] = useState(null);

  // Yan yana seri üretim: kapak listesi (sınır yok, X başlangıcı oransal ilerler)
  const [covers, setCovers] = useState([{ id: 1, width: 700, height: 400 }]);
  const [coverGap, setCoverGap] = useState(0);
  const [nextCoverId, setNextCoverId] = useState(2);
  const PLATE_WIDTH = 2100;

  function addCover() {
    setCovers((cs) => [...cs, { id: nextCoverId, width: 700, height: 400 }]);
    setNextCoverId((i) => i + 1);
  }
  function updateCover(id, field, value) {
    setCovers((cs) => cs.map((cv) => (cv.id === id ? { ...cv, [field]: parseFloat(value) || 0 } : cv)));
  }
  function removeCover(id) {
    setCovers((cs) => (cs.length > 1 ? cs.filter((cv) => cv.id !== id) : cs));
  }

  const currentConfig = useMemo(() => {
    const detailed = offsetMode === 'detailed';
    const normOff = parseFloat(offset) || 0;
    return {
      width: parseFloat(width) || 0,
      height: parseFloat(height) || 0,
      offset: normOff,
      offsetMode,
      offsetLeft: detailed ? (parseFloat(offsetLeft) || 0) : normOff,
      offsetRight: detailed ? (parseFloat(offsetRight) || 0) : normOff,
      offsetBottom: detailed ? (parseFloat(offsetBottom) || 0) : normOff,
      offsetTop: detailed ? (parseFloat(offsetTop) || 0) : normOff,
      centerFlat: detailed ? (parseFloat(centerFlat) || 0) : 0,
      direction,
      pitch: parseFloat(pitch) || 0,
      exitGap: parseFloat(exitGap) || 0,
      stepover: parseFloat(stepover) || 0,
      edgeInset,
      t14TipDia: parseFloat(t14TipDia) || 0,
      t14BodyDia: parseFloat(t14BodyDia) || 0,
      t14Height: parseFloat(t14Height) || 0,
      startZ: parseFloat(startZ) || 0,
      endZ: parseFloat(endZ) || 0,
      feed: parseFloat(feed) || 0,
      plunge: parseFloat(plunge) || 0,
      toolNo,
      spindle: parseFloat(spindle) || 0,
      groundEntry,
      exitCut: parseFloat(exitCut) || 0,
      t4Z: parseFloat(t4Z) || 0,
      t4Feed: parseFloat(t4Feed) || 5000,
      drillTool,
      drillSpindle: parseFloat(drillSpindle) || 0,
      exitToolDia: parseFloat(exitToolDia) || 0,
      safeZ: parseFloat(safeZ) || 30,
      toolChangeZ: parseFloat(toolChangeZ) || 30,
      homeZ: parseFloat(homeZ) || 30,
    };
  }, [
    width, height, offsetMode, direction, offset, offsetLeft, offsetRight, offsetBottom, offsetTop, centerFlat,
    pitch, exitGap, stepover, edgeInset, startZ, endZ, feed, plunge, toolNo, spindle, groundEntry, exitCut,
    drillTool, drillSpindle, exitToolDia, t14TipDia, t14BodyDia, t14Height, safeZ, toolChangeZ, homeZ, t4Z, t4Feed
  ]);

  const summaryText = useMemo(() => {
    try {
      const g = panjurGroups(currentConfig);
      const w = g.crossEnd - g.crossStart;
      const h = g.alongEnd - g.alongStart;
      const flat = g.centerFlat > 0 ? ` — ortada ${g.centerFlat.toFixed(1)} mm düz alan` : '';
      const lengths = [...new Set(g.groups.map((x) => Number((x.end - x.start).toFixed(3))))];
      const lenText = lengths.length === 1 ? `${lengths[0].toFixed(3)} mm` : `${lengths.map((v) => v.toFixed(3)).join(' / ')} mm`;
      return `İşleme alanı: ${w.toFixed(1)} × ${h.toFixed(1)} mm — ${g.groups.length} panjur — gerçek boy ${lenText} — hedef kademe ${currentConfig.pitch.toFixed(2)} mm — çıkış payı ${currentConfig.exitGap.toFixed(2)} mm${flat} — ${currentConfig.groundEntry ? 'zemine giriş + T' + currentConfig.drillTool : 'zemine giriş kapalı'}.`;
    } catch (e) {
      return e.message;
    }
  }, [currentConfig]);

  function generate() {
    setMessage(null);
    try {
      // Yan yana seri üretim: her kapak kendi ölçüsüyle, X başlangıcı oransal artarak
      const multi = covers.length > 1;
      const coverList = multi ? covers : [{ id: 1, width: currentConfig.width, height: currentConfig.height }];

      const totalWidth = coverList.reduce((s, cv) => s + (cv.width || 0) + (multi ? coverGap : 0), 0) - (multi ? coverGap : 0);
      if (totalWidth > PLATE_WIDTH) {
        throw new Error(`Toplam genişlik (${totalWidth.toFixed(0)} mm) plakayı aşıyor (${PLATE_WIDTH} mm).`);
      }

      let combined = [];
      let xOffset = 0;
      let n = 1;

      // FAZ 1: T14 takımını bir kez al, tüm kapakların rasterını sırayla işle
      for (let i = 0; i < coverList.length; i++) {
        const cv = coverList[i];
        const cfg = { ...currentConfig, width: cv.width, height: cv.height };
        const res = generatePanjurGcode(cfg, xOffset, 0, true, n, {
          phase: currentConfig.groundEntry ? 'raster' : 'all',
          t14Header: i === 0,
        });
        for (const line of res.gcode.split('\n')) {
          if (line.trim()) combined.push(line);
        }
        n = res.nextN;
        xOffset += cv.width + (multi ? coverGap : 0);
      }

      // FAZ 2: T4 kesim bıçağını bir kez al, tüm kapakların çıkış kanallarını sırayla aç
      if (currentConfig.groundEntry) {
        let exX = 0;
        let t4Header = true;
        for (const cv of coverList) {
          const cfg = { ...currentConfig, width: cv.width, height: cv.height };
          const res = generatePanjurGcode(cfg, exX, 0, true, n, { phase: 'exit', t14Header: false, t4Header });
          for (const line of res.gcode.split('\n')) {
            if (line.trim()) combined.push(line);
          }
          n = res.nextN;
          t4Header = false;
          exX += cv.width + (multi ? coverGap : 0);
        }
        combined.push(`N${n++} M5`);
      }

      combined.push('N9998 G0 Z30.00');
      combined.push('N9999 M5');
      combined.push('M9');
      combined.push('M16');
      combined.push('M30');
      combined.push('%');

      const isT4Used = currentConfig.groundEntry ? '_Kesimli' : '';
      const name = multi
        ? `Panjur_Seri_${coverList.length}adet_${totalWidth.toFixed(0)}x${Math.max(...coverList.map((cv) => cv.height))}${isT4Used}.nc`
        : `Panjur_${currentConfig.width}x${currentConfig.height}${isT4Used}.nc`;

      setOutput(combined.join('\n'));
      setMessage({
        type: 'ok',
        text: multi
          ? `${coverList.length} kapak tek programda birleştirildi (toplam X: ${totalWidth.toFixed(0)} mm). İsim: ${name}`
          : `G-code üretildi.`,
      });
    } catch (err) {
      setMessage({ type: 'err', text: err.message });
      setOutput('');
    }
  }

  useCtrlEnter(generate);

  function copyCode() {
    if (!output) return;
    navigator.clipboard.writeText(output);
  }
function downloadFile() {
    if (!output.trim()) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);

    const isT4Used = currentConfig.groundEntry ? "_Kesimli" : "";
    if (covers.length > 1) {
      const totalWidth = covers.reduce((s, cv) => s + cv.width + coverGap, 0) - coverGap;
      a.download = `Panjur_Seri_${covers.length}adet_${totalWidth}x${Math.max(...covers.map((cv) => cv.height))}${isT4Used}.nc`;
    } else {
      a.download = `Panjur_${currentConfig.width}x${currentConfig.height}${isT4Used}.nc`;
    }

    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="wrap app-screen active">
      <div className="topbar">
        <div>
          <h1>Empire CNC — Panjur Kapak</h1>
          <div className="sub">Dış ölçüden offseti çıkarır, panjur boylarını otomatik böler ve referans NC'deki eğimli raster mantığıyla G-code üretir.</div>
        </div>
        {onBackToMenu && (
          <div className="top-actions">
            <button type="button" className="btn-secondary" onClick={onBackToMenu}>
              ← Ana Menü
            </button>
          </div>
        )}
      </div>

      <div className="panjur-module">
      <div className="card">
        <h2>1. Ölçü ve Offsetler</h2>
        <div className="row2">
          <div>
            <label>Net dış genişlik X (mm)</label>
            <input type="number" value={width} min="1" step="1" onChange={(e) => setWidth(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Net dış yükseklik Y (mm)</label>
            <input type="number" value={height} min="1" step="1" onChange={(e) => setHeight(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="row2" style={{ marginTop: 10 }}>
          <div>
            <label>Offset modu</label>
            <select value={offsetMode} onChange={(e) => setOffsetMode(e.target.value)}>
              <option value="normal">Normal — 4 kenar aynı</option>
              <option value="detailed">Ayrıntılı — her kenar ayrı</option>
            </select>
          </div>
          <div>
            <label>Panjur yönü</label>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="y">Y yönünde panjur boyu</option>
              <option value="x">X yönünde panjur boyu</option>
            </select>
          </div>
        </div>

        {offsetMode === 'normal' ? (
          <div className="row2" style={{ marginTop: 10 }}>
            <div>
              <label>Dıştan offset — 4 kenar (mm)</label>
              <input type="number" value={offset} min="0" step="1" onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="hint" style={{ margin: 0, alignSelf: 'end' }}>
              Dört kenara aynı mesafe uygulanır.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div className="row2">
              <div>
                <label>Soldan offset (mm)</label>
                <input type="number" value={offsetLeft} min="0" step="0.1" onChange={(e) => setOffsetLeft(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label>Sağdan offset (mm)</label>
                <input type="number" value={offsetRight} min="0" step="0.1" onChange={(e) => setOffsetRight(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="row2" style={{ marginTop: 10 }}>
              <div>
                <label>Alttan offset (mm)</label>
                <input type="number" value={offsetBottom} min="0" step="0.1" onChange={(e) => setOffsetBottom(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label>Üstten offset (mm)</label>
                <input type="number" value={offsetTop} min="0" step="0.1" onChange={(e) => setOffsetTop(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="row2" style={{ marginTop: 10 }}>
              <div>
                <label>Ortada düz alan (mm)</label>
                <input type="number" value={centerFlat} min="0" step="0.1" onChange={(e) => setCenterFlat(parseFloat(e.target.value) || 0)} />
              </div>
              <div className="hint" style={{ margin: 0, alignSelf: 'end' }}>
                Uzun kapaklarda panjurları ortada bu genişlikte düz bir bant bırakarak iki taraftan üretir. 0 = düz alan yok. Delikli modda T4, uçta 3 mm eski + 1 mm yeni panjur payını Z0'a işler.
              </div>
            </div>
          </div>
        )}

        <div className="measure-summary" style={{ marginTop: 14 }}>
          {summaryText}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>1b. Yan Yana Kapaklar (Seri Üretim)</h2>
        <div className="hint" style={{ marginBottom: 10 }}>
          Soldan sağa yan yana farklı ölçülerde kapaklar ekleyin; her kapak en/boy ister ve hepsine aynı ayarlar uygulanır. X başlangıcı her kapakta oransal olarak ilerler. Toplam genişlik plaka sınırına (2100 mm) kadar serbesttir.
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>X Başlangıç</th>
              <th style={{ textAlign: 'left' }}>Genişlik X (mm)</th>
              <th style={{ textAlign: 'left' }}>Yükseklik Y (mm)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let cx = 0;
              return covers.map((cv) => {
                const startX = cx;
                cx += cv.width + coverGap;
                return (
                  <tr key={cv.id}>
                    <td style={{ color: 'var(--muted)' }}>{startX.toFixed(0)} mm</td>
                    <td>
                      <input type="number" min="1" step="1" value={cv.width}
                        onChange={(e) => updateCover(cv.id, 'width', e.target.value)} style={{ width: 90 }} />
                    </td>
                    <td>
                      <input type="number" min="1" step="1" value={cv.height}
                        onChange={(e) => updateCover(cv.id, 'height', e.target.value)} style={{ width: 90 }} />
                    </td>
                    <td>
                      <button type="button" className="icon-btn" onClick={() => removeCover(cv.id)}
                        disabled={covers.length === 1} style={{ opacity: covers.length === 1 ? 0.4 : 1 }}>✕</button>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
        <div className="row2" style={{ marginTop: 10 }}>
          <div>
            <label>Kapak arası boşluk (mm)</label>
            <input type="number" min="0" step="1" value={coverGap} onChange={(e) => setCoverGap(parseFloat(e.target.value) || 0)} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button type="button" className="btn-secondary" onClick={addCover}>+ Kapak Ekle</button>
          </div>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Tek kapakla çalışmak isterseniz diğerlerini silin — o zaman yukarıdaki ana ölçü kullanılır.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>2. Panjur Geometrisi</h2>
        <div className="row3">
          <div>
            <label>Panjur kademesi (mm)</label>
            <input type="number" value={pitch} min="0.1" step="0.1" onChange={(e) => setPitch(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Rölyef çıkış payı (mm)</label>
            <input type="number" value={exitGap} min="0" step="0.01" onChange={(e) => setExitGap(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Raster stepover (mm)</label>
            <input type="number" value={stepover} min="0.05" step="0.001" onChange={(e) => setStepover(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label title="auto = konik bıçak açısından otomatik hesaplanır (en derin noktada takımın gerçek yarıçapı). Sayı girersen sabit mm içeri çeker.">Kenar içeri çekme</label>
            <select value={edgeInset === 'auto' ? 'auto' : 'manual'} onChange={(e) => setEdgeInset(e.target.value === 'auto' ? 'auto' : 1)}>
              <option value="auto">Otomatik (konik açıdan)</option>
              <option value="manual">Elle (mm)</option>
            </select>
          </div>
        </div>
        {edgeInset !== 'auto' && (
          <div className="row2" style={{ marginTop: 10 }}>
            <div>
              <label>Elle içeri çekme (mm)</label>
              <input type="number" value={edgeInset} min="0" step="0.1" onChange={(e) => setEdgeInset(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        )}
        <div className="row4" style={{ marginTop: 10 }}>
          <div>
            <label>Başlangıç Z (üst yüzey)</label>
            <input type="number" value={startZ} step="0.001" onChange={(e) => setStartZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Son Z / en derin nokta</label>
            <input type="number" value={endZ} step="0.001" onChange={(e) => setEndZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Raster feed F</label>
            <input type="number" value={feed} min="1" step="100" onChange={(e) => setFeed(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 12 }}>
          <input
            type="checkbox"
            checked={groundEntry}
            style={{ width: 'auto' }}
            onChange={(e) => setGroundEntry(e.target.checked)}
          />
          Zemine kadar in / alt çıkışı T4 ile en son aç
        </label>

        {groundEntry && (
          <div className="row2" style={{ marginTop: 10 }}>
            <div>
              <label>Çıkış kesimi (mm)</label>
              <input type="number" value={exitCut} min="0.1" step="0.1" onChange={(e) => setExitCut(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label>T4 İlk Dalış Z</label>
              <input type="number" value={t4Z} step="0.1" onChange={(e) => setT4Z(parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label>T4 Kesim Hızı</label>
              <input type="number" value={t4Feed} min="100" step="100" onChange={(e) => setT4Feed(parseFloat(e.target.value) || 5000)} />
            </div>
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          Panjur kademesi, bir panjur başlangıcından sonraki panjur başlangıcına hedef mesafedir. Sistem offsetlerden kalan alanı ve bu kademeyi kullanarak panjur sayısını ve gerçek panjur uzunluğunu otomatik hesaplar; çıkış payı panjurlar arasındaki boşluktur. Zemine giriş açıksa T4, tüm panjur uçlarında tek seferde; panjur eğimini end-3'ten end+1'e devam ettirerek Z0'a iner ve sonra uç boyunca keser.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>3. Takım ve Makine</h2>
        <div className="row3">
          <div>
            <label>Panjur takımı</label>
            <input type="text" value={toolNo} onChange={(e) => setToolNo(e.target.value)} />
          </div>
          <div>
            <label>Spindle S</label>
            <input type="number" value={spindle} min="1" step="100" onChange={(e) => setSpindle(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Dalış F</label>
            <input type="number" value={plunge} min="1" step="50" onChange={(e) => setPlunge(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="row3" style={{ marginTop: 10 }}>
          <div>
            <label>Uç delme takımı</label>
            <input type="text" value={drillTool} onChange={(e) => setDrillTool(e.target.value)} />
          </div>
          <div>
            <label>Uç bıçağı çapı (mm)</label>
            <input type="number" value={exitToolDia} min="4" max="4" step="0.1" onChange={(e) => setExitToolDia(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Uç delme S</label>
            <input type="number" value={drillSpindle} min="1" step="100" onChange={(e) => setDrillSpindle(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="row3" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div>
            <label>T14 uç çapı (mm, ballnose)</label>
            <input type="number" value={t14TipDia} min="0.1" step="0.1" onChange={(e) => setT14TipDia(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>T14 gövde çapı (mm)</label>
            <input type="number" value={t14BodyDia} min="1" step="0.5" onChange={(e) => setT14BodyDia(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>T14 konik yükseklik (mm)</label>
            <input type="number" value={t14Height} min="1" step="1" onChange={(e) => setT14Height(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="row3" style={{ marginTop: 10 }}>
          <div>
            <label>Safe Z</label>
            <input type="number" value={safeZ} onChange={(e) => setSafeZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Takım Değiştirme Z</label>
            <input type="number" value={toolChangeZ} onChange={(e) => setToolChangeZ(parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label>Home Z</label>
            <input type="number" value={homeZ} onChange={(e) => setHomeZ(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div className="hint" style={{ marginTop: 10 }}>
          Zemine giriş açıksa önce bütün panjurlar T14 ile işlenir, sonra takım bir kez T4'e değişir. T4 her uçta dik dalmaz; mevcut eğimi end-3'ten end+1'e düz çizgi olarak sürdürüp Z0'a iner, ardından panjur genişliğini Z0'da keser.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <button type="button" className="btn-primary" style={{ marginTop: 0 }} onClick={generate}>
          Panjur G-code Üret
        </button>
        <div className="hint" style={{ marginTop: 6 }}>Kısayol: Ctrl+Enter (Mac: ⌘+Enter)</div>

        {message && (
          <div className={message.type === 'err' ? 'err' : 'ok'} style={{ display: 'block', marginTop: 10 }}>
            {message.text}
          </div>
        )}
      </div>

      {output && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>G-code Çıktısı</h2>
          <textarea value={output} readOnly spellCheck={false} placeholder="Panjur G-code burada görünecek..." />
          <div className="out-actions">
            <button type="button" className="btn-secondary" onClick={copyCode}>Kopyala</button>
            <button type="button" className="btn-secondary" onClick={downloadFile}>.nc indir</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
