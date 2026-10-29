import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { apiFetch } from './apiClient';
import SocialWhatsAppWorkspace from './SocialWhatsAppWorkspace';
import styles from './SocialMediaArtworkStudio.module.css';

type ArtworkFormat = {
  id: string;
  label: string;
  channel: string;
  width: number;
  height: number;
  note: string;
};

const formats: ArtworkFormat[] = [
  { id: 'facebook-feed', label: 'Facebook Feed · Landscape', channel: 'Facebook Feed', width: 1200, height: 630, note: 'Landscape promotional artwork for a Facebook Page post.' },
  { id: 'square-feed', label: 'Square Feed Post', channel: 'Facebook / Instagram Feed', width: 1080, height: 1080, note: 'A square creative for feed placements.' },
  { id: 'instagram-portrait', label: 'Instagram Feed · Portrait', channel: 'Instagram Feed', width: 1080, height: 1350, note: 'A portrait feed creative with room for readable copy.' },
  { id: 'story-status', label: 'Story / Status · Vertical', channel: 'Instagram Story / WhatsApp Status export', width: 1080, height: 1920, note: 'Exports artwork for manual sharing. Direct WhatsApp Status publishing is not provided by this tool.' },
];

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, startY: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return startY;
  const lines: string[] = [];
  let line = '';
  let truncated = false;

  for (let index = 0; index < words.length; index += 1) {
    const candidate = line ? line + ' ' + words[index] : words[index];
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[index];
      if (lines.length >= maxLines) {
        truncated = true;
        line = lines[maxLines - 1];
        break;
      }
    }
    if (index === words.length - 1) lines.push(line);
  }

  if (lines.length === 0 && line) lines.push(line);
  if (truncated && lines.length >= maxLines) {
    let last = lines[maxLines - 1] || line;
    while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + '…';
  } else if (lines.length > maxLines) {
    lines.length = maxLines;
  }
  lines.slice(0, maxLines).forEach((item, index) => ctx.fillText(item, x, startY + index * lineHeight));
  return startY + Math.min(lines.length, maxLines) * lineHeight;
}

function drawPhotoCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, radius: number) {
  if (width < 10 || height < 10) return;
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  if (imageRatio > targetRatio) {
    sourceWidth = image.height * targetRatio;
    sourceX = (image.width - sourceWidth) / 2;
  } else {
    sourceHeight = image.width / targetRatio;
    sourceY = (image.height - sourceHeight) / 2;
  }
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  ctx.restore();
}


type ArtworkDraft = {
  id: string;
  name: string;
  formatId: string;
  brandName: string;
  headline: string;
  message: string;
  callToAction: string;
  caption: string;
  hashtags: string;
  primary: string;
  accent: string;
  photoSource: string | null;
  updatedAt: string;
};
type ArtworkDraftSummary = Pick<ArtworkDraft, 'id' | 'name' | 'updatedAt'>;
type MetaDestination = { publicId: string; type: string; displayName: string; username: string | null; status: string };
type MetaStatus = { configured: boolean; publishingReady: boolean; code: string; message: string; destinations: MetaDestination[] };
type MetaPublishJob = { publicId: string; status: string; destinationType: string; destinationName: string; caption: string; externalPostId: string | null; errorCode: string | null; createdAt: string; updatedAt: string; publishedAt: string | null };

function openArtworkDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Saved drafts are not available in this browser context.'));
      return;
    }
    const request = indexedDB.open('bajaj-social-media-artwork', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) {
        request.result.createObjectStore('drafts', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open artwork draft storage.'));
  });
}

async function listArtworkDrafts(): Promise<ArtworkDraftSummary[]> {
  const db = await openArtworkDraftDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
    request.onsuccess = () => {
      const drafts = (request.result as ArtworkDraft[])
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      db.close();
      resolve(drafts);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Could not list saved artwork drafts.'));
    };
  });
}

async function readArtworkDraft(id: string): Promise<ArtworkDraft | undefined> {
  const db = await openArtworkDraftDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts', 'readonly').objectStore('drafts').get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result as ArtworkDraft | undefined);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Could not load the selected artwork draft.'));
    };
  });
}

async function writeArtworkDraft(draft: ArtworkDraft): Promise<void> {
  const db = await openArtworkDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(draft);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not save this artwork draft.'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error('Saving this artwork draft was cancelled.'));
    };
  });
}

async function removeArtworkDraft(id: string): Promise<void> {
  const db = await openArtworkDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error('Could not delete this artwork draft.'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error('Deleting this artwork draft was cancelled.'));
    };
  });
}

function newDraftId() {
  return globalThis.crypto?.randomUUID?.()
    ?? 'draft-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export default function SocialMediaArtworkStudio({ onClose, canManage = false, canPublish = false, canReadWhatsapp = false, canManageWhatsapp = false, canSendWhatsapp = false }: { onClose: () => void; canManage?: boolean; canPublish?: boolean; canReadWhatsapp?: boolean; canManageWhatsapp?: boolean; canSendWhatsapp?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [formatId, setFormatId] = useState(formats[0].id);
  const [brandName, setBrandName] = useState('Lucky Bajaj Agency');
  const [headline, setHeadline] = useState('Your Next Ride Starts Here');
  const [message, setMessage] = useState('Discover dependable service, genuine parts and friendly support from our team.');
  const [callToAction, setCallToAction] = useState('Visit us today');
  const [caption, setCaption] = useState('Your journey matters to us. Visit Lucky Bajaj Agency for trusted service and support.');
  const [hashtags, setHashtags] = useState('#LuckyBajaj #Bajaj #RideWithConfidence');
  const [primary, setPrimary] = useState('#15213a');
  const [accent, setAccent] = useState('#f97316');
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftName, setDraftName] = useState('New campaign draft');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<ArtworkDraftSummary[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [publishDestinationId, setPublishDestinationId] = useState('');
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [publishJob, setPublishJob] = useState<MetaPublishJob | null>(null);
  const [pendingPublishAssetId, setPendingPublishAssetId] = useState<string | null>(null);
  const [publishIdempotencyKey, setPublishIdempotencyKey] = useState(() => newDraftId());

  const selectedFormat = formats.find((format) => format.id === formatId) ?? formats[0];
  const activeMetaDestinations = metaStatus?.destinations.filter((destination) => destination.status === 'ACTIVE') ?? [];
  const fullCaption = [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n');

  useEffect(() => {
    let disposed = false;
    setMetaLoading(true);
    apiFetch('/api/v1/admin/social/meta/status', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as MetaStatus | { message?: string };
        if (!response.ok) throw new Error(('message' in payload && payload.message) || 'Social account status could not be loaded.');
        if (!disposed) setMetaStatus(payload as MetaStatus);
      })
      .catch((cause) => {
        if (!disposed) setMetaError(cause instanceof Error ? cause.message : 'Social account status could not be loaded.');
      })
      .finally(() => { if (!disposed) setMetaLoading(false); });

    const hash = window.location.hash;
    const queryStart = hash.indexOf('?');
    if (queryStart >= 0) {
      const outcome = new URLSearchParams(hash.slice(queryStart + 1)).get('meta');
      if (outcome === 'connected') setNotice('Meta account connected. Review the available destinations below.');
      else if (outcome === 'cancelled') setNotice('Meta account connection was cancelled.');
      else if (outcome && outcome !== 'error') setNotice('Meta account connection could not be verified. Review the connection status below.');
      else if (outcome === 'error') setMetaError('Meta could not complete account connection. Check the server configuration and try again.');
    }

    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const active = metaStatus?.destinations.filter((destination) => destination.status === 'ACTIVE') ?? [];
    if (!active.some((destination) => destination.publicId === publishDestinationId)) {
      setPublishDestinationId(active[0]?.publicId ?? '');
    }
  }, [metaStatus, publishDestinationId]);

  useEffect(() => {
    let disposed = false;
    listArtworkDrafts()
      .then((drafts) => { if (!disposed) setSavedDrafts(drafts); })
      .catch(() => { if (!disposed) setSavedDrafts([]); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let cancelled = false;
    const render = (photo?: HTMLImageElement) => {
      if (cancelled) return;
      const width = selectedFormat.width;
      const height = selectedFormat.height;
      canvas.width = width;
      canvas.height = height;
      const scale = Math.min(width / 1080, height / 1080);
      const ratio = width / height;
      const landscape = ratio >= 1.4;

      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, primary);
      background.addColorStop(0.68, '#172740');
      background.addColorStop(1, '#0b1220');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(width * 0.94, height * 0.09, Math.min(width, height) * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.1;
      ctx.beginPath();
      ctx.arc(width * 0.04, height * 0.96, Math.min(width, height) * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const margin = width * 0.075;
      const markSize = Math.max(40, Math.min(width, height) * (landscape ? 0.09 : 0.075));
      const brandY = height * (landscape ? 0.18 : 0.105);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(margin + markSize * 0.42, brandY - markSize * 0.18, markSize * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.round(markSize * 0.38) + 'px Arial, sans-serif';
      ctx.fillText('LB', margin + markSize * 0.42, brandY - markSize * 0.18);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + Math.round(Math.max(22, Math.min(width, height) * 0.035)) + 'px Arial, sans-serif';
      ctx.fillText(brandName.trim() || 'Your Dealership', margin + markSize * 1.05, brandY);

      const titleFontSize = Math.max(32, Math.round(Math.min(width, height) * (landscape ? 0.075 : 0.066)));
      const titleLineHeight = titleFontSize * 1.12;
      const titleX = margin;
      const titleY = height * (landscape ? 0.43 : 0.245);
      const titleMaxWidth = width * (landscape ? 0.52 : 0.85);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.font = '800 ' + titleFontSize + 'px Arial, sans-serif';
      const titleEnd = wrapText(ctx, headline.trim() || 'Your Next Ride Starts Here', titleX, titleY, titleMaxWidth, titleLineHeight, landscape ? 2 : 3);

      const messageFontSize = Math.max(19, Math.round(Math.min(width, height) * (landscape ? 0.034 : 0.027)));
      const messageLineHeight = messageFontSize * 1.45;
      const messageY = titleEnd + messageLineHeight * 0.15;
      ctx.fillStyle = '#e4eaf3';
      ctx.font = '400 ' + messageFontSize + 'px Arial, sans-serif';
      const messageEnd = wrapText(ctx, message, titleX, messageY, titleMaxWidth, messageLineHeight, landscape ? 2 : 3);

      const ctaY = height * (landscape ? 0.81 : 0.855);
      const buttonHeight = Math.max(42, Math.min(height * 0.085, 72 * scale));
      const buttonWidth = Math.min(width * (landscape ? 0.43 : 0.68), Math.max(210 * scale, (callToAction.length * messageFontSize * 0.56) + 52 * scale));
      const buttonX = landscape ? margin : (width - buttonWidth) / 2;
      const buttonTop = Math.min(ctaY - buttonHeight * 0.75, height - buttonHeight - height * 0.075);
      ctx.fillStyle = accent;
      roundedRect(ctx, buttonX, buttonTop, buttonWidth, buttonHeight, buttonHeight * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 ' + Math.round(Math.max(17, messageFontSize * 0.84)) + 'px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(callToAction.trim() || 'Learn more', buttonX + buttonWidth / 2, buttonTop + buttonHeight / 2, buttonWidth - 24 * scale);
      ctx.textBaseline = 'alphabetic';

      if (photo) {
        if (landscape) {
          const photoX = width * 0.65;
          const photoY = height * 0.22;
          const photoW = width * 0.28;
          const photoH = height * 0.55;
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.12;
          roundedRect(ctx, photoX - 8 * scale, photoY - 8 * scale, photoW + 16 * scale, photoH + 16 * scale, 28 * scale);
          ctx.fill();
          ctx.globalAlpha = 1;
          drawPhotoCover(ctx, photo, photoX, photoY, photoW, photoH, 22 * scale);
        } else {
          const photoTop = messageEnd + messageLineHeight * 0.2;
          const photoY = Math.min(photoTop, buttonTop - height * 0.08 - height * 0.2);
          const photoH = Math.max(0, Math.min(height * 0.23, buttonTop - photoY - height * 0.07));
          if (photoH > height * 0.06) {
            const photoX = margin;
            const photoW = width - margin * 2;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.12;
            roundedRect(ctx, photoX - 6 * scale, photoY - 6 * scale, photoW + 12 * scale, photoH + 12 * scale, 28 * scale);
            ctx.fill();
            ctx.globalAlpha = 1;
            drawPhotoCover(ctx, photo, photoX, photoY, photoW, photoH, 22 * scale);
          }
        }
      }

      ctx.fillStyle = '#cbd5e1';
      ctx.textAlign = landscape ? 'left' : 'center';
      ctx.font = '600 ' + Math.max(13, Math.round(17 * scale)) + 'px Arial, sans-serif';
      ctx.fillText('SERVICE YOU CAN TRUST', landscape ? margin : width / 2, height * 0.965);
      ctx.textAlign = 'left';
    };

    if (photoSource) {
      const image = new Image();
      image.onload = () => render(image);
      image.onerror = () => render();
      image.src = photoSource;
    } else {
      render();
    }
    return () => { cancelled = true; };
  }, [selectedFormat, brandName, headline, message, callToAction, primary, accent, photoSource]);

  function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setError('');
    setNotice('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Choose an image smaller than 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoSource(reader.result);
      else setError('The image could not be read.');
    };
    reader.onerror = () => setError('The image could not be read.');
    reader.readAsDataURL(file);
  }


  async function publishArtwork(){
    const destination=activeMetaDestinations.find(item=>item.publicId===publishDestinationId);
    if(!metaStatus?.publishingReady){setMetaError('Publishing is not configured yet. Configure public media URL and signing key first.');return;}
    if(!destination){setMetaError('Choose an active Facebook Page or Instagram professional account.');return;}
    if(publishJob?.status==='PROCESSING'||publishJob?.status==='UNKNOWN'){setMetaError('This request is processing or uncertain. Refresh its status before attempting another post.');return;}
    if(!window.confirm('Publish this artwork and caption to '+destination.displayName+'? This creates a public social post.'))return;
    setPublishingBusy(true);setMetaError('');setError('');setNotice('');
    try{
      let assetId=pendingPublishAssetId;
      if(!assetId){
        const canvas=canvasRef.current;if(!canvas)throw new Error('Artwork preview is not ready.');
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('JPEG artwork could not be prepared.')),'image/jpeg',0.92));
        const data=new FormData();data.append('file',blob,'lucky-bajaj-campaign.jpg');
        const upload=await apiFetch('/api/v1/admin/social/media',{method:'POST',body:data});
        const stored=await upload.json().catch(()=>({})) as {assetId?:string;message?:string;detail?:string};
        if(!upload.ok||!stored.assetId)throw new Error(stored.message??stored.detail??'Artwork upload failed.');
        assetId=stored.assetId;setPendingPublishAssetId(assetId);
      }
      const response=await apiFetch('/api/v1/admin/social/meta/publish',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({destinationPublicId:destination.publicId,assetId,caption:fullCaption.slice(0,2200),idempotencyKey:publishIdempotencyKey})});
      const result=await response.json().catch(()=>({})) as MetaPublishJob&{message?:string;detail?:string};
      if(!response.ok||!result.publicId)throw new Error(result.message??result.detail??'Publish request could not be confirmed.');
      setPublishJob(result);
      if(result.status==='PUBLISHED'){setNotice('Published to '+destination.displayName+'. Provider post ID: '+(result.externalPostId??'recorded')+'.');setPendingPublishAssetId(null);setPublishIdempotencyKey(newDraftId());}
      else if(result.status==='PROCESSING'){setNotice('Meta accepted the Instagram container. Publication will complete after provider readiness checks.');setPendingPublishAssetId(null);setPublishIdempotencyKey(newDraftId());}
      else if(result.status==='FAILED'){setMetaError('Publishing failed ('+(result.errorCode??'provider_error')+'). Check account permissions.');setPendingPublishAssetId(null);setPublishIdempotencyKey(newDraftId());}
      else setMetaError('Provider outcome is uncertain. The system will not automatically repost; refresh job status before acting.');
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Publish request could not be confirmed.');}
    finally{setPublishingBusy(false);}
  }
  async function refreshPublishJob(){
    if(!publishJob)return;setMetaError('');
    try{
      const response=await apiFetch('/api/v1/admin/social/meta/publishes/'+publishJob.publicId,{cache:'no-store'});
      const result=await response.json().catch(()=>({})) as MetaPublishJob&{message?:string};
      if(!response.ok||!result.publicId)throw new Error(result.message??'Publish status could not be refreshed.');
      setPublishJob(result);
      if(result.status==='PUBLISHED')setNotice('Published to '+result.destinationName+'. Provider post ID: '+(result.externalPostId??'recorded')+'.');
      else if(result.status==='FAILED')setMetaError('Publishing failed ('+(result.errorCode??'provider_error')+').');
      else if(result.status==='UNKNOWN')setMetaError('The provider result is uncertain. Do not repost until reconciled.');
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Publish status could not be refreshed.');}
  }

  async function connectMeta() {
    setMetaConnecting(true);
    setMetaError('');
    try {
      const response = await apiFetch('/api/v1/admin/social/meta/connect', { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { authorizationUrl?: string; message?: string };
      if (!response.ok || !payload.authorizationUrl) {
        throw new Error(payload.message || 'Meta account connection is not available.');
      }
      window.location.assign(payload.authorizationUrl);
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : 'Meta account connection could not be started.');
      setMetaConnecting(false);
    }
  }

  async function refreshSavedDrafts() {
    try {
      setSavedDrafts(await listArtworkDrafts());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved drafts could not be refreshed.');
    }
  }

  async function saveDraft() {
    const cleanName = draftName.trim();
    if (!cleanName) {
      setError('Enter a name for this campaign draft.');
      return;
    }
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      const draft: ArtworkDraft = {
        id: activeDraftId ?? newDraftId(),
        name: cleanName.slice(0, 100),
        formatId,
        brandName,
        headline,
        message,
        callToAction,
        caption,
        hashtags,
        primary,
        accent,
        photoSource,
        updatedAt: new Date().toISOString(),
      };
      await writeArtworkDraft(draft);
      setActiveDraftId(draft.id);
      setDraftName(draft.name);
      await refreshSavedDrafts();
      setNotice('Draft saved on this browser. It is not yet synced to other staff devices.');
    } catch (cause) {
      const storageError = cause instanceof DOMException && cause.name === 'QuotaExceededError';
      setError(storageError
        ? 'Browser storage is full. Remove the campaign photo or delete an older saved draft, then try again.'
        : cause instanceof Error ? cause.message : 'The draft could not be saved.');
    } finally {
      setDraftBusy(false);
    }
  }

  async function loadDraft(id: string) {
    if (!id) {
      setActiveDraftId(null);
      setDraftName('New campaign draft');
      return;
    }
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      const draft = await readArtworkDraft(id);
      if (!draft) throw new Error('This saved draft was not found.');
      setActiveDraftId(draft.id);
      setDraftName(draft.name);
      setFormatId(draft.formatId);
      setBrandName(draft.brandName);
      setHeadline(draft.headline);
      setMessage(draft.message);
      setCallToAction(draft.callToAction);
      setCaption(draft.caption);
      setHashtags(draft.hashtags);
      setPrimary(draft.primary);
      setAccent(draft.accent);
      setPhotoSource(draft.photoSource);
      setNotice('Saved draft loaded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected draft could not be loaded.');
    } finally {
      setDraftBusy(false);
    }
  }

  async function deleteDraft() {
    if (!activeDraftId) {
      setError('Choose a saved draft before deleting it.');
      return;
    }
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      await removeArtworkDraft(activeDraftId);
      setSavedDrafts(await listArtworkDrafts());
      setActiveDraftId(null);
      setDraftName('New campaign draft');
      setNotice('Saved draft deleted from this browser.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected draft could not be deleted.');
    } finally {
      setDraftBusy(false);
    }
  }

  function newDraft() {
    setActiveDraftId(null);
    setDraftName('New campaign draft');
    setFormatId(formats[0].id);
    setBrandName('Lucky Bajaj Agency');
    setHeadline('Your Next Ride Starts Here');
    setMessage('Discover dependable service, genuine parts and friendly support from our team.');
    setCallToAction('Visit us today');
    setCaption('Your journey matters to us. Visit Lucky Bajaj Agency for trusted service and support.');
    setHashtags('#LuckyBajaj #Bajaj #RideWithConfidence');
    setPrimary('#15213a');
    setAccent('#f97316');
    setPhotoSource(null);
    setError('');
    setNotice('Started a new draft. Save it to keep it on this browser.');
  }

  function downloadArtwork(mimeType: 'image/png' | 'image/jpeg' = 'image/png') {
    const canvas = canvasRef.current;
    if (!canvas) {
      setError('The artwork preview is not ready yet.');
      return;
    }
    setError('');
    setNotice('');
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Artwork export failed. Try again.');
        return;
      }
      const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'lucky-bajaj-' + selectedFormat.id + '.' + extension;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Artwork downloaded as ' + extension.toUpperCase() + '. This does not publish it to a social account.');
    }, mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
  }

  async function shareArtwork() {
    const canvas = canvasRef.current;
    if (!canvas) {
      setError('The artwork preview is not ready yet.');
      return;
    }
    setError('');
    setNotice('');
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not prepare the artwork for sharing.')), 'image/png');
      });
      const file = new File([blob], 'lucky-bajaj-' + selectedFormat.id + '.png', { type: 'image/png' });
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: headline.trim() || brandName.trim(), text: fullCaption });
        setNotice('The device share sheet opened. Confirm the destination and send/publish inside that app.');
      } else {
        downloadArtwork('image/png');
        try {
          await navigator.clipboard.writeText(fullCaption);
          setNotice('This browser cannot share the image directly. The PNG was downloaded and the caption was copied; share them manually.');
        } catch {
          setNotice('This browser cannot share the image directly. The PNG was downloaded; copy the caption manually.');
        }
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setNotice('Sharing was cancelled. Your artwork is unchanged.');
      } else {
        setError(cause instanceof Error ? cause.message : 'The device share sheet could not be opened.');
      }
    }
  }

  async function getArtworkJpeg(): Promise<Blob> {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('The current artwork preview is not ready.');
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The artwork could not be prepared as a JPEG.')), 'image/jpeg', 0.92);
    });
  }

  async function copyCaption() {
    setError('');
    setNotice('');
    try {
      await navigator.clipboard.writeText(fullCaption);
      setNotice('Caption and hashtags copied.');
    } catch {
      setError('Clipboard access was blocked. Select and copy the caption manually.');
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="social-artwork-title">
      <section className={styles.studio}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>LUCKY BAJAJ AGENCY · CAMPAIGN DESIGN</span>
            <h2 id="social-artwork-title">Social Media Artwork Studio</h2>
            <p>Create a channel-sized artwork and caption. Publishing integrations are a separate next phase.</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close social media artwork studio">×</button>
        </header>
        <section className={styles.metaPanel} aria-label="Meta account connections">
          <div className={styles.metaPanelHeader}>
            <div>
              <strong>Facebook & Instagram accounts</strong>
              <p>{metaLoading ? 'Checking server configuration and connected destinations…' : metaStatus?.message ?? 'Account connection status is unavailable.'}</p>
            </div>
            <button type="button" className={styles.secondary} disabled={!canManage || metaLoading || metaConnecting || !metaStatus?.configured} onClick={() => void connectMeta()}>
              {metaConnecting ? 'Opening Meta…' : canManage ? 'Connect account' : 'Account manager permission required'}
            </button>
          </div>
          {metaError && <div className={styles.error} role="alert">{metaError}</div>}
          {!metaLoading && metaStatus?.destinations?.length ? (
            <div className={styles.destinations}>
              {metaStatus.destinations.map((destination) => (
                <div className={styles.destination} key={destination.publicId}>
                  <span className={destination.type === 'FACEBOOK_PAGE' ? styles.facebookMark : styles.instagramMark}>
                    {destination.type === 'FACEBOOK_PAGE' ? 'f' : '◎'}
                  </span>
                  <div className={styles.destinationCopy}>
                    <strong>{destination.displayName}</strong>
                    <small>{destination.type === 'FACEBOOK_PAGE' ? 'Facebook Page' : 'Instagram professional account'}{destination.username ? ' · @' + destination.username.replace(/^@/, '') : ''}</small>
                  </div>
                  <span className={destination.status === 'ACTIVE' ? styles.connectedState : styles.disconnectedState}>
                    {destination.status === 'ACTIVE' ? 'Connected' : 'Reconnect'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <p className={styles.metaFootnote}>{metaStatus?.publishingReady ? 'Direct publishing is configured. Each post needs confirmation and a provider-backed result.' : 'Publishing needs a public HTTPS media URL and asset-signing key. Connecting an account alone never publishes content.'}</p>
        </section>
        <div className={styles.content}>
          <aside className={styles.controls}>
            <div className={styles.draftPanel}>
              <div className={styles.draftPanelTitle}>Saved drafts <span>Browser only</span></div>
              <label>Draft name
                <input maxLength={100} value={draftName} onChange={(event) => setDraftName(event.target.value)} />
              </label>
              <label>Open saved draft
                <select disabled={draftBusy || savedDrafts.length === 0} value={activeDraftId ?? ''} onChange={(event) => void loadDraft(event.target.value)}>
                  <option value="">Choose a saved draft…</option>
                  {savedDrafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name} · {new Date(draft.updatedAt).toLocaleDateString('en-IN')}</option>)}
                </select>
              </label>
              <div className={styles.draftActions}>
                <button type="button" className={styles.secondary} disabled={draftBusy} onClick={() => void saveDraft()}>{draftBusy ? 'Saving…' : activeDraftId ? 'Save changes' : 'Save draft'}</button>
                <button type="button" className={styles.secondary} disabled={draftBusy} onClick={newDraft}>New</button>
                <button type="button" className={styles.textButton} disabled={draftBusy || !activeDraftId} onClick={() => void deleteDraft()}>Delete</button>
              </div>
            </div>
            <label>Artwork format
              <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
                {formats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
              </select>
            </label>
            <p className={styles.formatNote}>{selectedFormat.note} <strong>{selectedFormat.width} × {selectedFormat.height}</strong></p>
            <label>Dealership / brand<input maxLength={80} value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
            <label>Headline<textarea rows={3} maxLength={140} value={headline} onChange={(event) => setHeadline(event.target.value)} /></label>
            <label>Supporting message<textarea rows={4} maxLength={240} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
            <label>Call to action<input maxLength={45} value={callToAction} onChange={(event) => setCallToAction(event.target.value)} /></label>
            <label>Caption<textarea rows={3} maxLength={700} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
            <label>Hashtags<input maxLength={220} value={hashtags} onChange={(event) => setHashtags(event.target.value)} /></label>
            <label>Optional campaign photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhotoUpload} /></label>
            {photoSource && <button className={styles.textButton} type="button" onClick={() => setPhotoSource(null)}>Remove photo</button>}
            <div className={styles.colors}>
              <label>Brand colour<input aria-label="Brand colour" type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
              <label>Accent colour<input aria-label="Accent colour" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
            </div>
            <p className={styles.privacy}>Artwork remains browser-local until you choose to upload, publish or share it. Publishing uploads the rendered JPEG only after you confirm the action.</p>
          </aside>
          <main className={styles.previewColumn}>
            <div className={styles.previewBar}><span>LIVE PREVIEW · {selectedFormat.channel}</span><small>{selectedFormat.width} × {selectedFormat.height} PNG</small></div>
            <div className={styles.previewFrame} style={{ aspectRatio: selectedFormat.width + ' / ' + selectedFormat.height }}>
              <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={'Preview of ' + headline} />
            </div>
            <label className={styles.captionPreview}>Caption preview<textarea readOnly rows={4} value={fullCaption} /></label>

            <section className={styles.publishPanel} aria-label="Publish campaign artwork">
              <div className={styles.publishPanelHeading}><strong>Publish to social media</strong><span>{metaStatus?.publishingReady?'API ready':'Not configured'}</span></div>
              <label>Destination
                <select value={publishDestinationId} onChange={(event)=>setPublishDestinationId(event.target.value)} disabled={!activeMetaDestinations.length||publishingBusy}>
                  {activeMetaDestinations.length===0&&<option value="">Connect a Facebook Page or Instagram account first</option>}
                  {activeMetaDestinations.map(d=><option key={d.publicId} value={d.publicId}>{d.displayName} · {d.type==='FACEBOOK_PAGE'?'Facebook Page':'Instagram'}</option>)}
                </select>
              </label>
              <button type="button" className={styles.publishButton} disabled={!canPublish||!metaStatus?.publishingReady||!publishDestinationId||publishingBusy||publishJob?.status==='PROCESSING'||publishJob?.status==='UNKNOWN'} onClick={()=>void publishArtwork()}>{publishingBusy?'Preparing and publishing…':canPublish?'Publish now':'Publishing permission required'}</button>
              {publishJob&&<div className={styles.publishResult}>
                <div><strong>Latest publish job</strong><span className={publishJob.status==='PUBLISHED'?styles.connectedState:publishJob.status==='FAILED'?styles.disconnectedState:styles.publishPendingState}>{publishJob.status}</span></div>
                <p>{publishJob.destinationName}{publishJob.externalPostId?' · Post ID '+publishJob.externalPostId:''}{publishJob.errorCode?' · '+publishJob.errorCode:''}</p>
                {(publishJob.status==='PROCESSING'||publishJob.status==='UNKNOWN')&&<button type="button" className={styles.textButton} disabled={publishingBusy} onClick={()=>void refreshPublishJob()}>Refresh publish status</button>}
              </div>}
              <p className={styles.note}>Publishing creates a real post. Final confirmation is required; uncertain outcomes are not automatically retried.</p>
            </section>
            {error && <div className={styles.error} role="alert">{error}</div>}
            {notice && <div className={styles.notice} role="status">{notice}</div>}
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void copyCaption()}>Copy caption</button>
              <button type="button" className={styles.secondary} onClick={() => downloadArtwork('image/jpeg')}>Download JPEG</button>
              <button type="button" className={styles.secondary} onClick={() => void shareArtwork()}>Share from device</button>
              <button type="button" className={styles.primary} onClick={() => downloadArtwork('image/png')}>Download PNG</button>
            </div>
            <p className={styles.note}>Facebook/Instagram posts and WhatsApp Business template messages use separate, permission-gated API workflows. WhatsApp Status is still manual export/share.</p>
          </main>
        </div>
        {(canReadWhatsapp || canManageWhatsapp || canSendWhatsapp) && <SocialWhatsAppWorkspace canRead={canReadWhatsapp} canManage={canManageWhatsapp} canSend={canSendWhatsapp} getArtworkJpeg={getArtworkJpeg} />}
      </section>
    </div>
  );
}
