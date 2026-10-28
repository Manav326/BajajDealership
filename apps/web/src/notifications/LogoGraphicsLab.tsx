import { useRef, useState } from 'react';
import { apiFetch } from './apiClient';
import styles from './LogoGraphicsLab.module.css';

export type UploadedNotificationMedia = {
  assetId: string;
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
  altText: string;
  mediaUrl: string;
  createdAt: string;
};

type Props = {
  onUseAsset: (asset: UploadedNotificationMedia) => void;
  onClose: () => void;
};

const symbols = [
  { id: 'spark', label: 'Spark', glyph: '✦' },
  { id: 'shield', label: 'Shield', glyph: '⬟' },
  { id: 'gear', label: 'Gear', glyph: '⚙' },
  { id: 'star', label: 'Star', glyph: '★' },
  { id: 'wheel', label: 'Wheel', glyph: '◉' },
];

export default function LogoGraphicsLab({ onUseAsset, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [brandName, setBrandName] = useState('Lucky Bajaj');
  const [tagline, setTagline] = useState('Service you can trust.');
  const [primary, setPrimary] = useState('#15213a');
  const [accent, setAccent] = useState('#f97316');
  const [surface, setSurface] = useState('#ffffff');
  const [symbol, setSymbol] = useState('spark');
  const [layout, setLayout] = useState<'horizontal' | 'stacked'>('horizontal');
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedSymbol = symbols.find((item) => item.id === symbol) ?? symbols[0];

  async function exportAndUse() {
    if (!svgRef.current) return;
    setBusy(true);
    setError('');
    let objectUrl = '';
    try {
      const svgText = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      objectUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.decoding = 'async';
      image.src = objectUrl;
      await image.decode();

      const canvas = document.createElement('canvas');
      canvas.width = layout === 'horizontal' ? 1200 : 900;
      canvas.height = layout === 'horizontal' ? 420 : 900;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image export is not available in this browser.');
      if (!transparent) {
        context.fillStyle = surface;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The PNG could not be generated.')), 'image/png');
      });

      const formData = new FormData();
      formData.append('file', png, 'lucky-bajaj-notification-graphic.png');
      const response = await apiFetch('/api/v1/admin/notifications/media', { method: 'POST', body: formData });
      const payload = await response.json() as UploadedNotificationMedia | { message?: string; detail?: string };
      if (!response.ok) {
        throw new Error(('message' in payload && payload.message) || ('detail' in payload && payload.detail) || 'The graphic could not be uploaded.');
      }
      onUseAsset(payload as UploadedNotificationMedia);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export this graphic.');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="graphics-title">
      <section className={styles.lab}>
        <header className={styles.header}>
          <div><span className={styles.eyebrow}>QUANTAEDGE · NOTIFICATION DESIGN</span><h2 id="graphics-title">Logo & Graphics Studio</h2><p>Create an editable graphic for this campaign. Artwork is locally composed, not AI-generated.</p></div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close graphics studio">×</button>
        </header>
        <div className={styles.body}>
          <div className={styles.controls}>
            <label>Brand or campaign title<input maxLength={80} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
            <label>Tagline<input maxLength={120} value={tagline} onChange={(event) => setTagline(event.target.value)} /></label>
            <div className={styles.label}>Symbol</div>
            <div className={styles.symbols}>{symbols.map((item) => <button key={item.id} type="button" className={symbol === item.id ? styles.symbolActive : styles.symbolButton} onClick={() => setSymbol(item.id)}><span>{item.glyph}</span><small>{item.label}</small></button>)}</div>
            <div className={styles.label}>Layout</div>
            <div className={styles.segmented}><button type="button" className={layout === 'horizontal' ? styles.segmentActive : ''} onClick={() => setLayout('horizontal')}>Horizontal</button><button type="button" className={layout === 'stacked' ? styles.segmentActive : ''} onClick={() => setLayout('stacked')}>Stacked</button></div>
            <div className={styles.colors}>
              <label>Primary colour<input type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
              <label>Accent colour<input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
              <label>Background<input type="color" value={surface} onChange={(event) => setSurface(event.target.value)} /></label>
            </div>
            <label className={styles.checkbox}><input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} /> Transparent background</label>
          </div>
          <div className={styles.previewArea}>
            <div className={styles.previewToolbar}><span>LIVE PREVIEW</span><small>{layout === 'horizontal' ? '1200 × 420' : '900 × 900'} PNG export</small></div>
            <div className={styles.artwork} style={{ background: transparent ? 'repeating-conic-gradient(#e8edf4 0% 25%,#fff 0% 50%) 50% / 18px 18px' : surface }}>
              <svg ref={svgRef} viewBox={layout === 'horizontal' ? '0 0 1200 420' : '0 0 900 900'} width="100%" role="img" aria-label={brandName || 'Notification graphic'} xmlns="http://www.w3.org/2000/svg">
                {layout === 'horizontal' ? <>
                  <circle cx="200" cy="210" r="105" fill={accent} opacity=".13" />
                  <circle cx="200" cy="210" r="78" fill={primary} />
                  <text x="200" y="235" fontSize="74" fontWeight="800" fill={surface} textAnchor="middle">{selectedSymbol.glyph}</text>
                  <text x="340" y="195" fontSize="62" fontFamily="Arial, sans-serif" fontWeight="800" fill={primary}>{brandName || 'Campaign title'}</text>
                  <rect x="342" y="222" width="96" height="7" rx="4" fill={accent} />
                  <text x="340" y="274" fontSize="28" fontFamily="Arial, sans-serif" fill={primary} opacity=".75">{tagline}</text>
                </> : <>
                  <circle cx="450" cy="275" r="142" fill={accent} opacity=".13" />
                  <circle cx="450" cy="275" r="106" fill={primary} />
                  <text x="450" y="310" fontSize="100" fontWeight="800" fill={surface} textAnchor="middle">{selectedSymbol.glyph}</text>
                  <text x="450" y="500" fontSize="52" fontFamily="Arial, sans-serif" fontWeight="800" textAnchor="middle" fill={primary}>{brandName || 'Campaign title'}</text>
                  <rect x="370" y="530" width="160" height="8" rx="4" fill={accent} />
                  <text x="450" y="594" fontSize="27" fontFamily="Arial, sans-serif" textAnchor="middle" fill={primary} opacity=".75">{tagline}</text>
                </>}
              </svg>
            </div>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <div className={styles.note}>Images are checked for type, size and dimensions before being stored privately for this dealership.</div>
          </div>
        </div>
        <footer className={styles.footer}><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={busy || !brandName.trim()} onClick={() => void exportAndUse()}>{busy ? 'Exporting & uploading…' : 'Use in notification'}</button></footer>
      </section>
    </div>
  );
}
