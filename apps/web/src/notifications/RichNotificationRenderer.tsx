import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from './apiClient';
import styles from './RichNotificationRenderer.module.css';

type RichBlock = Record<string, unknown> & { type: string };
type RichDocument = { version: 1; blocks: RichBlock[] };
type Surface = 'customer' | 'staff' | 'admin';
type Mode = 'mobile' | 'desktop' | 'push' | 'inbox';

export default function RichNotificationRenderer({
  document,
  surface = 'customer',
  mode = 'mobile',
}: {
  document: RichDocument | null | undefined;
  surface?: Surface;
  mode?: Mode;
}) {
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const serialized = useMemo(() => JSON.stringify(document ?? null), [document]);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    const loaded: Record<string, string> = {};
    let parsed: RichDocument | null = null;
    try {
      const value = JSON.parse(serialized) as unknown;
      if (value && typeof value === 'object' && 'version' in value && 'blocks' in value) {
        parsed = value as RichDocument;
      }
    } catch { parsed = null; }

    const ids = new Set<string>();
    const visit = (blocks: RichBlock[]) => {
      for (const block of blocks) {
        if (typeof block.assetId === 'string' && block.assetId.trim()) ids.add(block.assetId.trim());
        if (Array.isArray(block.blocks)) visit(block.blocks.filter((x): x is RichBlock =>
          Boolean(x) && typeof x === 'object' && 'type' in x));
        if (Array.isArray(block.items)) visit(block.items.filter((x): x is RichBlock =>
          Boolean(x) && typeof x === 'object' && 'type' in x));
      }
    };
    if (parsed?.version === 1 && Array.isArray(parsed.blocks)) visit(parsed.blocks);

    setMediaUrls({});
    Promise.all([...ids].map(async (id) => {
      const response = await apiFetch(`/api/v1/admin/notifications/media/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Media is unavailable');
      const blob = await response.blob();
      if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Unsupported media type');
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      loaded[id] = url;
    }).map(p => p.catch(() => undefined))).then(() => {
      if (active) setMediaUrls(loaded);
      else createdUrls.forEach(url => URL.revokeObjectURL(url));
    });
    return () => {
      active = false;
      createdUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [serialized]);

  if (!document || document.version !== 1 || !Array.isArray(document.blocks)) {
    return <div className={styles.empty}>Choose a validated notification design to preview it.</div>;
  }

  const renderBlock = (block: RichBlock, index: number): ReactNode => {
    const type = block.type;
    const text = (key: string, fallback = '') => typeof block[key] === 'string' ? String(block[key]) : fallback;
    const asset = text('assetId');
    const imageUrl = asset ? mediaUrls[asset] : undefined;
    const children = Array.isArray(block.blocks) ? block.blocks as RichBlock[] : [];
    const blockKey = `${type}-${index}-${text('title')}`;

    if (type === 'hero') {
      return <section key={blockKey} className={styles.hero}>
        {text('eyebrow') && <span className={styles.eyebrow}>{text('eyebrow')}</span>}
        {imageUrl && <img className={styles.heroImage} src={imageUrl} alt={text('alt', text('title'))} />}
        <h2>{text('title', 'Your dealership update')}</h2>
        {text('subtitle') && <p>{text('subtitle')}</p>}
      </section>;
    }
    if (type === 'richText') {
      return <div key={blockKey} className={styles.richText}>{text('text').split('\n').map((paragraph, paragraphIndex) =>
        <p key={paragraphIndex}>{paragraph}</p>)}</div>;
    }
    if (type === 'image' || type === 'animation') {
      if (!imageUrl) return <div key={blockKey} className={styles.mediaPlaceholder}>Image will appear after it is available to your account.</div>;
      return <figure key={blockKey} className={styles.figure}>
        <img src={imageUrl} alt={Boolean(block.decorative) ? '' : text('alt')} />
        {text('caption') && <figcaption>{text('caption')}</figcaption>}
      </figure>;
    }
    if (type === 'video') {
      return <div key={blockKey} className={styles.mediaPlaceholder}>Video blocks are reserved for a configured video-media adapter.</div>;
    }
    if (type === 'vehicleCard' || type === 'serviceCard' || type === 'courseCard' || type === 'eventCard') {
      return <section key={blockKey} className={styles.infoCard}>
        <span className={styles.cardLabel}>{type === 'vehicleCard' ? 'VEHICLE' : type === 'serviceCard' ? 'SERVICE UPDATE' : type === 'eventCard' ? 'APPOINTMENT' : 'DETAILS'}</span>
        <h3>{text('title', text('modelName', text('courseName', 'Details')))}</h3>
        {text('description') && <p>{text('description')}</p>}
        {text('buttonLabel') && validHref(text('target')) && <a href={text('target')} className={styles.linkButton}>{text('buttonLabel')}</a>}
      </section>;
    }
    if (type === 'highlight') {
      return <div key={blockKey} className={styles.highlight}><span>{text('label')}</span><strong>{text('value')}</strong>{text('description') && <p>{text('description')}</p>}</div>;
    }
    if (type === 'badge') return <div key={blockKey} className={styles.badge}>{text('text', 'UPDATE')}</div>;
    if (type === 'icon') return <div key={blockKey} className={styles.iconText}><span aria-hidden="true">{text('icon', '✦')}</span><div><strong>{text('title')}</strong><p>{text('text')}</p></div></div>;
    if (type === 'divider') return <hr key={blockKey} className={styles.divider} />;
    if (type === 'spacer') return <div key={blockKey} className={styles.spacer} style={{ height: `${clamp(Number(block.height) || 16, 4, 96)}px` }} />;
    if (type === 'cta') {
      const href = text('target');
      return validHref(href) ? <a key={blockKey} className={styles.cta} href={href}>{text('label', 'Open details')} <span aria-hidden="true">↗</span></a> : null;
    }
    if (type === 'footer') return <footer key={blockKey} className={styles.footer}>{text('text')}</footer>;
    if (type === 'container' || type === 'carousel') return <div key={blockKey} className={styles.container}>{children.map(renderBlock)}</div>;
    return <div key={blockKey} className={styles.unsupported}>This notification includes a content type that this version cannot display.</div>;
  };

  return <div className={`${styles.renderer} ${styles[`surface_${surface}`] ?? ''} ${styles[`mode_${mode}`] ?? ''}`}>
    {document.blocks.map(renderBlock)}
  </div>;
}

function validHref(value: string) {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
