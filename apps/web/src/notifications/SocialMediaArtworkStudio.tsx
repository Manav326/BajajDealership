import { appConfirm } from '../dialogs/dialogService';
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { apiFetch } from './apiClient';
import SocialWhatsAppWorkspace from './SocialWhatsAppWorkspace';
import styles from './SocialMediaArtworkStudio.module.css';
import {
  addArtworkAsset, ARTWORK_ASSET_LIMIT, ARTWORK_ASSET_MAX_BYTES, ARTWORK_TEMPLATES,
  blobToDataUrl, loadArtworkAssets, removeArtworkAsset, resolveArtworkAssetSource,
  type ArtworkAsset, type ArtworkTemplate,
} from './artworkAssets';
import {
  addArtworkMusicAsset, ARTWORK_MUSIC_LIMIT, ARTWORK_MUSIC_MAX_BYTES, ARTWORK_MUSIC_LIBRARY_MAX_BYTES,
  MUSIC_CLIP_DEFAULT_SECONDS, MUSIC_CLIP_MAX_SECONDS, MUSIC_CLIP_MIN_SECONDS,
  loadArtworkMusicAssets, removeArtworkMusicAsset, updateArtworkMusicAsset,
  type ArtworkMusicAsset,
} from './artworkMusic';

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
  { id: 'story-status', label: 'Story / Status · Vertical', channel: 'Social Story / Status / Reel export', width: 1080, height: 1920, note: 'Exports vertical video for manual sharing. Native Story music stickers and direct Status publishing are not provided by this tool.' },
];

type StoryTarget = 'whatsapp-status' | 'instagram-story' | 'facebook-story' | 'social-reel';
const storyTargets: Array<{ id: StoryTarget; label: string; maxDuration: number; description: string }> = [
  { id: 'whatsapp-status', label: 'WhatsApp Status', maxDuration: 90, description: 'Up to 90 seconds for supported Status-video clients. The app may show a shorter limit.' },
  { id: 'instagram-story', label: 'Instagram Story', maxDuration: 60, description: 'Keep Story video to 60 seconds; use Reels for longer videos.' },
  { id: 'facebook-story', label: 'Facebook Story', maxDuration: 60, description: 'Use the conservative 60-second Story preset.' },
  { id: 'social-reel', label: 'Instagram / Facebook Reel', maxDuration: 120, description: 'Longer vertical video up to 2 minutes; this editor still exports a single file.' },
];
function storyTargetSettings(id: StoryTarget) {
  return storyTargets.find((target) => target.id === id) ?? storyTargets[0];
}

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


type CanvasObject = {
  id: string;
  kind: 'text' | 'rectangle' | 'circle' | 'image';
  assetId?: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
  align: 'left' | 'center' | 'right';
  rotation: number;
  opacity: number;
};

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
  headlineColor?: string;
  messageColor?: string;
  photoSource: string | null;
  logoSource?: string | null;
  layers?: ArtworkLayerVisibility;
  transforms?: ArtworkTransforms;
  musicAssetId?: string | null;
  musicClipStart?: number;
  musicClipDuration?: number;
  musicVolume?: number;
  storyTarget?: StoryTarget;
  objects?: CanvasObject[];
  updatedAt: string;
};
type ArtworkLayerVisibility = { decorations: boolean; brand: boolean; headline: boolean; message: boolean; photo: boolean; callToAction: boolean; footer: boolean };
type ArtworkLayerKey = keyof ArtworkLayerVisibility;
type ArtworkTransform = { x: number; y: number; scale: number };
type ArtworkTransforms = Record<ArtworkLayerKey, ArtworkTransform>;
const defaultArtworkLayers: ArtworkLayerVisibility = { decorations: true, brand: true, headline: true, message: true, photo: true, callToAction: true, footer: true };
const defaultArtworkTransforms: ArtworkTransforms = {
  decorations: { x: 0, y: 0, scale: 100 }, brand: { x: 0, y: 0, scale: 100 },
  headline: { x: 0, y: 0, scale: 100 }, message: { x: 0, y: 0, scale: 100 },
  photo: { x: 0, y: 0, scale: 100 }, callToAction: { x: 0, y: 0, scale: 100 },
  footer: { x: 0, y: 0, scale: 100 },
};
type ArtworkDraftSummary = Pick<ArtworkDraft, 'id' | 'name' | 'updatedAt'>;
type MetaDestination = { publicId: string; type: string; displayName: string; username: string | null; status: string };
type MetaStatus = { configured: boolean; publishingReady: boolean; code: string; message: string; missingConfigurationKeys: string[]; missingPublishingConfigurationKeys: string[]; destinations: MetaDestination[] };
type MetaPublishRequest = { publicId: string; assetPublicId: string; status: string; destinationType: string; destinationName: string; caption: string; requestedBy: string; approvedBy: string | null; requestedAt: string; scheduledAt: string | null; approvedAt: string | null; publishStatus: string; externalPostId: string | null; errorCode: string | null };

function openArtworkDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Saved drafts are not available in this browser context.'));
      return;
    }
    const request = indexedDB.open('bajaj-social-media-artwork', 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) {
        request.result.createObjectStore('drafts', { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains('assets')) {
        request.result.createObjectStore('assets', { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains('music')) {
        request.result.createObjectStore('music', { keyPath: 'id' });
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

async function listArtworkDraftsUsingAsset(assetId: string): Promise<ArtworkDraftSummary[]> {
  const db = await openArtworkDraftDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
    request.onsuccess = () => {
      const drafts = (request.result as ArtworkDraft[])
        .filter((draft) => draft.objects?.some((object) => object.kind === 'image' && object.assetId === assetId))
        .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
      db.close();
      resolve(drafts);
    };
    request.onerror = () => {
      db.close();
      reject(request.error ?? new Error('Could not check saved draft image references.'));
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

function localDateTimeMin(minutes = 2): string {
  const date = new Date(Date.now() + minutes * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timeoutId); resolve(value); },
      (cause: unknown) => {
        window.clearTimeout(timeoutId);
        reject(cause instanceof Error ? cause : new Error(message));
      },
    );
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
  const [headlineColor, setHeadlineColor] = useState('#ffffff');
  const [messageColor, setMessageColor] = useState('#e4eaf3');
  const [photoSource, setPhotoSource] = useState<string | null>(null);
  const [logoSource, setLogoSource] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<ArtworkLayerVisibility>(defaultArtworkLayers);
  const [layerTransforms, setLayerTransforms] = useState<ArtworkTransforms>(defaultArtworkTransforms);
  const [selectedLayer, setSelectedLayer] = useState<ArtworkLayerKey>('headline');
  const [canvasObjects, setCanvasObjects] = useState<CanvasObject[]>([]);
  const [selectedCanvasObjectId, setSelectedCanvasObjectId] = useState<string | null>(null);
  const canvasDragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const canvasUndoRef = useRef<CanvasObject[][]>([]);
  const canvasRedoRef = useRef<CanvasObject[][]>([]);
  const [artworkAssets, setArtworkAssets] = useState<ArtworkAsset[]>([]);
  const [assetPreviewSources, setAssetPreviewSources] = useState<Record<string, string>>({});
  const assetPreviewUrlsRef = useRef<Record<string, string>>({});
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedLogoAssetId, setSelectedLogoAssetId] = useState<string | null>(null);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [assetPreviewId, setAssetPreviewId] = useState<string | null>(null);
  const pickerDialogRef = useRef<HTMLDivElement | null>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(true);
  const [assetBusyId, setAssetBusyId] = useState<string | null>(null);
  const [musicAssets, setMusicAssets] = useState<ArtworkMusicAsset[]>([]);
  const [musicLibraryOpen, setMusicLibraryOpen] = useState(false);
  const [musicSearch, setMusicSearch] = useState('');
  const [favoriteMusicIds, setFavoriteMusicIds] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('bajaj-social-music-favourites') ?? '[]') as string[]; }
    catch { return []; }
  });
  const [previewingMusicId, setPreviewingMusicId] = useState<string | null>(null);
  const pickerAudioRef = useRef<HTMLAudioElement | null>(null);
  const pickerAudioUrlRef = useRef<string | null>(null);
  const [selectedMusicId, setSelectedMusicId] = useState<string | null>(null);
  const [storyTarget, setStoryTarget] = useState<StoryTarget>('whatsapp-status');
  const [musicPreviewUrl, setMusicPreviewUrl] = useState<string | null>(null);
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const [musicClipStart, setMusicClipStart] = useState(0);
  const [musicClipDuration, setMusicClipDuration] = useState(MUSIC_CLIP_DEFAULT_SECONDS);
  const [musicVolume, setMusicVolume] = useState(78);
  const [musicIsPlaying, setMusicIsPlaying] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftName, setDraftName] = useState('New campaign draft');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<ArtworkDraftSummary[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [metaDisconnecting, setMetaDisconnecting] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [publishDestinationId, setPublishDestinationId] = useState('');
  const [publishingBusy, setPublishingBusy] = useState(false);
  const [pendingPublishAssetId, setPendingPublishAssetId] = useState<string | null>(null);
  const [publishIdempotencyKey, setPublishIdempotencyKey] = useState(() => newDraftId());
  const [publishRequests, setPublishRequests] = useState<MetaPublishRequest[]>([]);
  const [publishPreviewUrls, setPublishPreviewUrls] = useState<Record<string, string>>({});
  const [publishPreviewLoadingId, setPublishPreviewLoadingId] = useState<string | null>(null);
  const publishPreviewUrlRefs = useRef<Record<string, string>>({});

  const [scheduleLocal, setScheduleLocal] = useState('');
  const [activeStudioTab, setActiveStudioTab] = useState<'create' | 'connections' | 'publishing'>('create');

  useEffect(() => { void refreshPublishRequests(); }, []);
  useEffect(() => () => {
    Object.values(publishPreviewUrlRefs.current).forEach((url) => URL.revokeObjectURL(url));
    Object.values(assetPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    if (pickerAudioRef.current) { pickerAudioRef.current.pause(); pickerAudioRef.current.src = ''; }
    if (pickerAudioUrlRef.current) URL.revokeObjectURL(pickerAudioUrlRef.current);
  }, []);



  useEffect(() => {
    const dialog = pickerDialogRef.current;
    if ((!assetLibraryOpen && !musicLibraryOpen) || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true');

    (focusableElements()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAssetLibraryOpen(false);
        setMusicLibraryOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      const trigger = pickerTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else previousFocus?.focus();
    };
  }, [assetLibraryOpen, musicLibraryOpen]);

  const selectedFormat = formats.find((format) => format.id === formatId) ?? formats[0];
  const selectedMusicTrack = musicAssets.find((track) => track.id === selectedMusicId) ?? null;
  const selectedStoryTarget = storyTargetSettings(storyTarget);
  const storyDurationLimit = selectedStoryTarget.maxDuration;
  const selectedMusicReady = Boolean(selectedMusicTrack?.fileData && musicPreviewUrl);
  const musicStartLimit = Math.max(0, (selectedMusicTrack?.durationSeconds ?? 0) - musicClipDuration);
  const activeMetaDestinations = Array.isArray(metaStatus?.destinations)
    ? metaStatus.destinations.filter((destination) => destination.status === 'ACTIVE')
    : [];
  const canPublishSelectedFormat = selectedFormat.id !== 'story-status';
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
    refreshArtworkAssets().catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'The asset library could not be loaded.');
    });
    refreshArtworkMusicAssets().catch((cause) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'The music library could not be loaded.');
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const track = musicAssets.find((item) => item.id === selectedMusicId);
    if (!track?.fileData) {
      setMusicPreviewUrl(null);
      setMusicIsPlaying(false);
      return;
    }
    const url = URL.createObjectURL(track.fileData);
    setMusicPreviewUrl(url);
    setMusicIsPlaying(false);
    return () => URL.revokeObjectURL(url);
  }, [musicAssets, selectedMusicId]);

  useEffect(() => {
    window.localStorage.setItem('bajaj-social-music-favourites', JSON.stringify(favoriteMusicIds));
  }, [favoriteMusicIds]);

  useEffect(() => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    audio.volume = musicVolume / 100;
  }, [musicVolume, musicPreviewUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let cancelled = false;
    const render = (photo?: HTMLImageElement, logo?: HTMLImageElement, objectImages: Record<string, HTMLImageElement> = {}) => {
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

      if (layerVisibility.decorations) {
        const transform = layerTransforms.decorations;
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(width * (0.94 + transform.x / 100), height * (0.09 + transform.y / 100), Math.min(width, height) * 0.22 * transform.scale / 100, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.1;
        ctx.beginPath();
        ctx.arc(width * (0.04 + transform.x / 100), height * (0.96 + transform.y / 100), Math.min(width, height) * 0.18 * transform.scale / 100, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const margin = width * 0.075;
      if (layerVisibility.brand) {
        const transform = layerTransforms.brand;
        const markSize = Math.max(40, Math.min(width, height) * (landscape ? 0.09 : 0.075) * transform.scale / 100);
        const brandX = margin + width * transform.x / 100;
        const brandY = height * (landscape ? 0.18 : 0.105) + height * transform.y / 100;
        if (logo) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(brandX + markSize * 0.42, brandY - markSize * 0.18, markSize * 0.42, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(logo, brandX, brandY - markSize * 0.6, markSize, markSize);
          ctx.restore();
        } else {
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(brandX + markSize * 0.42, brandY - markSize * 0.18, markSize * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '800 ' + Math.round(markSize * 0.38) + 'px Arial, sans-serif';
          ctx.fillText('LB', brandX + markSize * 0.42, brandY - markSize * 0.18);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 ' + Math.round(Math.max(22, Math.min(width, height) * 0.035 * transform.scale / 100)) + 'px Arial, sans-serif';
        ctx.fillText(brandName.trim() || 'Your Dealership', brandX + markSize * 1.05, brandY);
      }

      const headlineTransform = layerTransforms.headline;
      const titleFontSize = Math.max(24, Math.round(Math.min(width, height) * (landscape ? 0.075 : 0.066) * headlineTransform.scale / 100));
      const titleLineHeight = titleFontSize * 1.12;
      const titleX = margin + width * headlineTransform.x / 100;
      const titleY = height * (landscape ? 0.43 : 0.245) + height * headlineTransform.y / 100;
      const titleMaxWidth = width * (landscape ? 0.52 : 0.85) * headlineTransform.scale / 100;
      ctx.fillStyle = headlineColor;
      ctx.textAlign = 'left';
      ctx.font = '800 ' + titleFontSize + 'px Arial, sans-serif';
      const titleEnd = layerVisibility.headline
        ? wrapText(ctx, headline.trim() || 'Your Next Ride Starts Here', titleX, titleY, titleMaxWidth, titleLineHeight, landscape ? 2 : 3)
        : titleY;

      const messageTransform = layerTransforms.message;
      const messageFontSize = Math.max(14, Math.round(Math.min(width, height) * (landscape ? 0.034 : 0.027) * messageTransform.scale / 100));
      const messageLineHeight = messageFontSize * 1.45;
      const messageX = margin + width * messageTransform.x / 100;
      const messageY = titleEnd + messageLineHeight * 0.15 + height * messageTransform.y / 100;
      const messageMaxWidth = width * (landscape ? 0.52 : 0.85) * messageTransform.scale / 100;
      ctx.fillStyle = messageColor;
      ctx.font = '400 ' + messageFontSize + 'px Arial, sans-serif';
      const messageEnd = layerVisibility.message
        ? wrapText(ctx, message, messageX, messageY, messageMaxWidth, messageLineHeight, landscape ? 2 : 3)
        : titleEnd;

      const ctaTransform = layerTransforms.callToAction;
      const ctaY = height * (landscape ? 0.81 : 0.855) + height * ctaTransform.y / 100;
      const buttonHeight = Math.max(30, Math.min(height * 0.085, 72 * scale) * ctaTransform.scale / 100);
      const buttonWidth = Math.min(width * (landscape ? 0.43 : 0.68), Math.max(210 * scale, (callToAction.length * messageFontSize * 0.56) + 52 * scale)) * ctaTransform.scale / 100;
      const buttonX = (landscape ? margin : (width - buttonWidth) / 2) + width * ctaTransform.x / 100;
      const buttonTop = Math.max(0, Math.min(ctaY - buttonHeight * 0.75, height - buttonHeight - height * 0.04));
      if (layerVisibility.callToAction) {
        ctx.fillStyle = accent;
        roundedRect(ctx, buttonX, buttonTop, buttonWidth, buttonHeight, buttonHeight * 0.3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 ' + Math.round(Math.max(17, messageFontSize * 0.84)) + 'px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(callToAction.trim() || 'Learn more', buttonX + buttonWidth / 2, buttonTop + buttonHeight / 2, buttonWidth - 24 * scale);
        ctx.textBaseline = 'alphabetic';
      }

      if (photo && layerVisibility.photo) {
        const photoTransform = layerTransforms.photo;
        if (landscape) {
          const photoX = width * (0.65 + photoTransform.x / 100);
          const photoY = height * (0.22 + photoTransform.y / 100);
          const photoW = width * 0.28 * photoTransform.scale / 100;
          const photoH = height * 0.55 * photoTransform.scale / 100;
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.12;
          roundedRect(ctx, photoX - 8 * scale, photoY - 8 * scale, photoW + 16 * scale, photoH + 16 * scale, 28 * scale);
          ctx.fill();
          ctx.globalAlpha = 1;
          drawPhotoCover(ctx, photo, photoX, photoY, photoW, photoH, 22 * scale);
        } else {
          const photoTop = messageEnd + messageLineHeight * 0.2 + height * photoTransform.y / 100;
          const photoY = Math.max(0, Math.min(photoTop, buttonTop - height * 0.08 - height * 0.2));
          const photoH = Math.max(0, Math.min(height * 0.23 * photoTransform.scale / 100, buttonTop - photoY - height * 0.07));
          if (photoH > height * 0.06) {
            const photoX = margin + width * photoTransform.x / 100;
            const photoW = (width - margin * 2) * photoTransform.scale / 100;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 0.12;
            roundedRect(ctx, photoX - 6 * scale, photoY - 6 * scale, photoW + 12 * scale, photoH + 12 * scale, 28 * scale);
            ctx.fill();
            ctx.globalAlpha = 1;
            drawPhotoCover(ctx, photo, photoX, photoY, photoW, photoH, 22 * scale);
          }
        }
      }

      if (layerVisibility.footer) {
        const footerTransform = layerTransforms.footer;
        ctx.fillStyle = '#cbd5e1';
        ctx.textAlign = landscape ? 'left' : 'center';
        ctx.font = '600 ' + Math.max(10, Math.round(17 * scale * footerTransform.scale / 100)) + 'px Arial, sans-serif';
        ctx.fillText('SERVICE YOU CAN TRUST', (landscape ? margin : width / 2) + width * footerTransform.x / 100, height * 0.965 + height * footerTransform.y / 100);
        ctx.textAlign = 'left';
      }
      canvasObjects.forEach((item) => {
        const x = width * item.x / 100;
        const y = height * item.y / 100;
        const objectWidth = width * item.width / 100;
        const objectHeight = height * item.height / 100;
        ctx.save();
        ctx.translate(x + objectWidth / 2, y + objectHeight / 2);
        ctx.rotate((item.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, Math.min(100, item.opacity)) / 100;
        ctx.fillStyle = item.fill;
        if (item.kind === 'image') {
          const objectImage = objectImages[item.id];
          if (objectImage) drawPhotoCover(ctx, objectImage, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight, 8 * scale);
          else {
            ctx.fillStyle = '#e2e8f0';
            roundedRect(ctx, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight, 8 * scale);
            ctx.fill();
            ctx.fillStyle = '#64748b';
            ctx.font = '600 ' + Math.max(12, 16 * scale) + 'px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Loading image…', 0, 0, objectWidth - 10);
          }
        } else if (item.kind === 'rectangle') {
          roundedRect(ctx, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight, Math.min(18 * scale, objectHeight * .18));
          ctx.fill();
        } else if (item.kind === 'circle') {
          ctx.beginPath();
          ctx.ellipse(0, 0, objectWidth / 2, objectHeight / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.font = (item.italic ? 'italic ' : '') + (item.bold ? '800 ' : '500 ') + Math.max(14, Math.round(item.fontSize * scale)) + 'px ' + item.fontFamily + ', sans-serif';
          ctx.textAlign = item.align;
          ctx.textBaseline = 'middle';
          const textX = item.align === 'left' ? -objectWidth / 2 : item.align === 'right' ? objectWidth / 2 : 0;
          const rows = item.text.split(/\r?\n/).slice(0, 5);
          const lineHeight = Math.max(18, item.fontSize * scale * 1.2);
          rows.forEach((line, index) => ctx.fillText(line, textX, (index - (rows.length - 1) / 2) * lineHeight, objectWidth));
        }
        ctx.restore();
      });
    };

    let photoLoaded = !photoSource;
    let logoLoaded = !logoSource;
    const objectAssetIds = [...new Set(canvasObjects.filter((item) => item.kind === 'image' && item.assetId).map((item) => item.assetId!))];
    const loadedObjectImages: Record<string, HTMLImageElement> = {};
    let objectImagesPending = objectAssetIds.length;
    let loadedPhoto: HTMLImageElement | undefined;
    let loadedLogo: HTMLImageElement | undefined;
    const renderWhenReady = () => {
      if (!cancelled && photoLoaded && logoLoaded && objectImagesPending === 0) render(loadedPhoto, loadedLogo, loadedObjectImages);
    };
    if (photoSource) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => { loadedPhoto = image; photoLoaded = true; renderWhenReady(); };
      image.onerror = () => { photoLoaded = true; renderWhenReady(); };
      image.src = photoSource;
    }
    objectAssetIds.forEach((assetId) => {
      const asset = artworkAssets.find((item) => item.id === assetId);
      const source = assetPreviewSources[assetId] || asset?.sourceUrl || '';
      const objectIds = canvasObjects.filter((item) => item.kind === 'image' && item.assetId === assetId).map((item) => item.id);
      if (!source) {
        objectImagesPending -= 1;
        renderWhenReady();
        return;
      }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        objectIds.forEach((id) => { loadedObjectImages[id] = image; });
        objectImagesPending -= 1;
        renderWhenReady();
      };
      image.onerror = () => {
        objectImagesPending -= 1;
        renderWhenReady();
      };
      image.src = source;
    });
    if (logoSource) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => { loadedLogo = image; logoLoaded = true; renderWhenReady(); };
      image.onerror = () => { logoLoaded = true; renderWhenReady(); };
      image.src = logoSource;
    }
    renderWhenReady();
    return () => { cancelled = true; };
  }, [selectedFormat, brandName, headline, message, callToAction, primary, accent, headlineColor, messageColor, photoSource, logoSource, layerVisibility, layerTransforms, canvasObjects, artworkAssets, assetPreviewSources]);

  async function refreshArtworkAssets(): Promise<ArtworkAsset[]> {
    const assets = await loadArtworkAssets();
    Object.values(assetPreviewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    const previews: Record<string, string> = {};
    const createdUrls: Record<string, string> = {};
    for (const asset of assets) {
      if (asset.fileData) {
        const url = URL.createObjectURL(asset.fileData);
        previews[asset.id] = url;
        createdUrls[asset.id] = url;
      } else {
        previews[asset.id] = asset.sourceUrl ?? '';
      }
    }
    assetPreviewUrlsRef.current = createdUrls;
    setArtworkAssets(assets);
    setAssetPreviewSources(previews);
    return assets;
  }

  async function selectArtworkAsset(asset: ArtworkAsset, target: 'photo' | 'logo' = 'photo'): Promise<boolean> {
    setAssetBusyId(asset.id);
    setError('');
    setNotice('');
    try {
      const source = await resolveArtworkAssetSource(asset);
      if (target === 'logo') {
        setLogoSource(source);
        setSelectedLogoAssetId(asset.id);
      } else {
        setPhotoSource(source);
        setSelectedAssetId(asset.id);
      }
      await refreshArtworkAssets();
      setNotice(asset.name + (target === 'logo' ? ' is now used as the dealership logo.' : ' is now selected as the campaign image.') + ' It is cached in this browser.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be imported into the asset library.');
      return false;
    } finally {
      setAssetBusyId(null);
    }
  }

  async function refreshArtworkMusicAssets(): Promise<ArtworkMusicAsset[]> {
    const tracks = await loadArtworkMusicAssets();
    setMusicAssets(tracks);
    return tracks;
  }

  async function selectMusicTrack(track: ArtworkMusicAsset) {
    if (!track.fileData) {
      window.open(track.sourcePage, '_blank', 'noopener,noreferrer');
      setNotice('Download the MP3 from the linked source page, then attach it to this track below. Source pages are not direct audio files.');
      return;
    }
    setSelectedMusicId(track.id);
    setMusicClipStart(0);
    setMusicClipDuration(Math.min(MUSIC_CLIP_DEFAULT_SECONDS, Math.floor(track.durationSeconds)));
    setError('');
    setNotice(track.name + ' is ready for your Story / Status video. The track is saved in this browser.');
  }

  async function handleMusicFile(event: ChangeEvent<HTMLInputElement>, starterTrackId?: string) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setError('');
    setNotice('');
    if (!file) return;

    const acceptedTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/x-m4a'];
    const hasAudioExtension = /\.(mp3|m4a|mp4|wav|ogg|webm|aac)$/i.test(file.name);
    if (!acceptedTypes.includes(file.type.toLowerCase()) && !hasAudioExtension) {
      setError('Choose a supported MP3, M4A, WAV, OGG or WebM audio file.');
      return;
    }
    if (file.size < 1 || file.size > ARTWORK_MUSIC_MAX_BYTES) {
      setError('Audio files must be smaller than 25 MB.');
      return;
    }

    const temporaryUrl = URL.createObjectURL(file);
    let durationSeconds = 0;
    try {
      const audioDuration = await new Promise<number>((resolve, reject) => {
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => resolve(probe.duration);
        probe.onerror = () => reject(new Error('The selected audio file could not be decoded by this browser.'));
        probe.src = temporaryUrl;
        probe.load();
      });
      durationSeconds = audioDuration;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected audio file could not be read.');
      URL.revokeObjectURL(temporaryUrl);
      return;
    }
    URL.revokeObjectURL(temporaryUrl);

    if (!Number.isFinite(durationSeconds) || durationSeconds < MUSIC_CLIP_MIN_SECONDS) {
      setError('Choose an audio track at least 20 seconds long so it can be trimmed for a Story.');
      return;
    }

    const existingTrack = starterTrackId ? musicAssets.find((track) => track.id === starterTrackId) : undefined;
    if (starterTrackId && !existingTrack) {
      setError('That catalogue track is no longer available. Refresh the studio and try again.');
      return;
    }
    const trackId = existingTrack?.id ?? newDraftId();
    const guessedMime = file.type || (file.name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream');
    const track: ArtworkMusicAsset = existingTrack
      ? { ...existingTrack, fileData: file, mimeType: guessedMime, durationSeconds }
      : {
          id: trackId,
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Uploaded music',
          category: 'Uploaded',
          creator: 'Added by staff',
          sourcePage: 'Uploaded locally by staff',
          licenseLabel: 'Confirm permission for commercial use before exporting a public promotion.',
          durationSeconds,
          isStarter: false,
          createdAt: new Date().toISOString(),
          mimeType: guessedMime,
          fileData: file,
        };

    setVideoExporting(false);
    try {
      if (existingTrack) await updateArtworkMusicAsset(track);
      else await addArtworkMusicAsset(track);
      const refreshedTracks = await refreshArtworkMusicAssets();
      setSelectedMusicId(trackId);
      setMusicClipStart(0);
      setMusicClipDuration(Math.min(MUSIC_CLIP_DEFAULT_SECONDS, Math.floor(durationSeconds)));
      setMusicVolume(78);
      setNotice(track.name + ' is saved in this browser and ready to use in composed videos.');
      if (!refreshedTracks.some((item) => item.id === trackId)) {
        throw new Error('The music track was saved but could not be found in the refreshed library. Reopen the studio.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The music track could not be stored in this browser.');
    }
  }

  async function deleteMusicTrack(track: ArtworkMusicAsset) {
    if (track.isStarter) return;
    if (!(await appConfirm('Remove this uploaded music track from this browser? Existing exported videos are not affected.', { title: 'Remove uploaded music', confirmLabel: 'Remove track', danger: true }))) return;
    setError('');
    setNotice('');
    try {
      await removeArtworkMusicAsset(track.id);
      if (selectedMusicId === track.id) setSelectedMusicId(null);
      await refreshArtworkMusicAssets();
      setNotice('Uploaded music removed from this browser.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The music track could not be removed.');
    }
  }

  async function toggleMusicPreview() {
    const audio = musicAudioRef.current;
    if (!audio || !selectedMusicReady) {
      setError('Import a track and select it before previewing audio.');
      return;
    }
    if (musicIsPlaying) {
      audio.pause();
      setMusicIsPlaying(false);
      return;
    }
    try {
      const start = Math.min(musicClipStart, musicStartLimit);
      audio.currentTime = start;
      audio.volume = musicVolume / 100;
      await audio.play();
      setMusicIsPlaying(true);
    } catch {
      setError('The selected track could not be previewed in this browser.');
    }
  }

  function handleMusicTimeUpdate() {
    const audio = musicAudioRef.current;
    if (!audio || !musicIsPlaying) return;
    const end = musicClipStart + musicClipDuration;
    if (audio.currentTime >= end) {
      audio.pause();
      audio.currentTime = musicClipStart;
      setMusicIsPlaying(false);
    }
  }

  async function applyArtworkTemplate(template: ArtworkTemplate) {
    setFormatId(template.formatId);
    setHeadline(template.headline);
    setMessage(template.message);
    setCallToAction(template.callToAction);
    setCaption(template.caption);
    setHashtags(template.hashtags);
    setPrimary(template.primary);
    setAccent(template.accent);
    setHeadlineColor('#ffffff');
    setMessageColor('#e4eaf3');
    setLayerVisibility(defaultArtworkLayers);
    setLayerTransforms(defaultArtworkTransforms);
    setSelectedLayer('headline');
    setError('');
    setNotice('');
    let asset = artworkAssets.find((item) => item.id === template.assetId);
    if (!asset) {
      const refreshedAssets = await refreshArtworkAssets();
      asset = refreshedAssets.find((item) => item.id === template.assetId);
    }
    if (!asset) {
      setError('The template image is missing from the asset library. Refresh the studio and try again.');
      return;
    }
    const selected = await selectArtworkAsset(asset);
    if (!selected) return;
    setNotice(template.name + ' template loaded. Review the wording, dealership details and any offer terms before exporting.');
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setError('');
    setNotice('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Only PNG and JPEG files can be stored in the asset library.');
      return;
    }
    if (file.size < 1 || file.size > ARTWORK_ASSET_MAX_BYTES) {
      setError('Choose a JPEG or PNG image no larger than 4.5 MB.');
      return;
    }
    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await createImageBitmap(file);
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) {
          setError('This image has invalid or excessive dimensions (maximum 20 megapixels).');
          return;
        }
      } catch {
        setError('The selected file is not a readable PNG or JPEG image.');
        return;
      } finally {
        bitmap?.close();
      }
    }
    const asset: ArtworkAsset = {
      id: newDraftId(),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Uploaded image',
      category: 'Uploaded',
      sourceUrl: null,
      sourcePage: 'Uploaded locally by an authorized staff user',
      credit: 'User-uploaded asset',
      mimeType: file.type as ArtworkAsset['mimeType'],
      isStarter: false,
      createdAt: new Date().toISOString(),
      fileData: file.slice(0, file.size, file.type),
    };
    setAssetBusyId(asset.id);
    try {
      await addArtworkAsset(asset);
      setPhotoSource(await blobToDataUrl(asset.fileData!));
      setSelectedAssetId(asset.id);
      await refreshArtworkAssets();
      setAssetLibraryOpen(true);
      setNotice('Image uploaded to the browser-local asset library.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be added to the asset library.');
    } finally {
      setAssetBusyId(null);
    }
  }

  async function deleteLibraryAsset(asset: ArtworkAsset) {
    if (asset.isStarter) return;
    setError('');
    setNotice('');
    try {
      const referencedDrafts = await listArtworkDraftsUsingAsset(asset.id);
      const usedOnCurrentCanvas = canvasObjects.some((object) => object.kind === 'image' && object.assetId === asset.id);
      if (usedOnCurrentCanvas || referencedDrafts.length > 0) {
        const references = [
          ...(usedOnCurrentCanvas ? ['the current canvas'] : []),
          ...referencedDrafts.map((draft) => '"' + draft.name + '"'),
        ];
        setError('Cannot remove "' + asset.name + '" because it is used by ' + references.join(', ') + '. Remove its image layer from the current canvas and every listed draft, save those drafts, then try again.');
        return;
      }
      if (!(await appConfirm('Remove "' + asset.name + '" from this browser’s artwork asset library?', { title: 'Remove artwork asset', confirmLabel: 'Remove asset', danger: true }))) return;
      await removeArtworkAsset(asset.id);
      if (selectedAssetId === asset.id) {
        setSelectedAssetId(null);
        setPhotoSource(null);
      }
      if (selectedLogoAssetId === asset.id) {
        setSelectedLogoAssetId(null);
        setLogoSource(null);
      }
      await refreshArtworkAssets();
      setNotice('Uploaded asset removed from this browser.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be removed.');
    }
  }

  function toggleArtworkLayer(layer: ArtworkLayerKey, visible: boolean) {
    setSelectedLayer(layer);
    setLayerVisibility((current) => ({ ...current, [layer]: visible }));
  }

  function updateSelectedLayerTransform(axis: keyof ArtworkTransform, value: number) {
    setLayerTransforms((current) => ({
      ...current,
      [selectedLayer]: { ...current[selectedLayer], [axis]: value },
    }));
  }

  function resetSelectedLayerTransform() {
    setLayerTransforms((current) => ({ ...current, [selectedLayer]: { ...defaultArtworkTransforms[selectedLayer] } }));
  }


  async function publishArtwork(){
    const destination=activeMetaDestinations.find(item=>item.publicId===publishDestinationId);
    if(!metaStatus?.publishingReady){setMetaError('Publishing is not configured yet. Configure the public media URL and signing key first.');return;}
    if(!destination){setMetaError('Choose an active Facebook Page or Instagram professional account.');return;}
    if(scheduleLocal && Number.isNaN(new Date(scheduleLocal).getTime())){setMetaError('Choose a valid local date and time.');return;}
    const scheduledAt=scheduleLocal?new Date(scheduleLocal).toISOString():null;
    const prompt=scheduledAt
      ? 'Request approval to publish to '+destination.displayName+' at '+new Date(scheduledAt).toLocaleString()+'? An Owner or Manager must approve it before dispatch.'
      : 'Submit this artwork to '+destination.displayName+' for approval? An Owner or Manager must approve it before a public post is made.';
    if (!(await appConfirm(prompt, { title: 'Submit artwork for approval', confirmLabel: 'Submit request' }))) return;
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
      const response=await apiFetch('/api/v1/admin/social/meta/publish-requests',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({destinationPublicId:destination.publicId,assetId,caption:fullCaption.slice(0,2200),idempotencyKey:publishIdempotencyKey,scheduledAt})});
      const result=await response.json().catch(()=>({})) as MetaPublishRequest&{message?:string;detail?:string};
      if(!response.ok||!result.publicId)throw new Error(result.message??result.detail??'Approval request could not be saved.');
      setPublishRequests(old=>[result,...old.filter(item=>item.publicId!==result.publicId)]);
      setPendingPublishAssetId(null);setPublishIdempotencyKey(newDraftId());setScheduleLocal('');
      setNotice(scheduledAt
        ? 'Scheduled publish request saved. It will not publish until an Owner or Manager approves it.'
        : 'Approval request saved. The post will not be sent until an Owner or Manager approves it.');
      await refreshPublishRequests();
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Approval request could not be saved.');}
    finally{setPublishingBusy(false);}
  }
  async function togglePublishPreview(request:MetaPublishRequest){
    const existing=publishPreviewUrlRefs.current[request.publicId];
    if(existing){
      URL.revokeObjectURL(existing);
      delete publishPreviewUrlRefs.current[request.publicId];
      setPublishPreviewUrls(old=>{const next={...old};delete next[request.publicId];return next;});
      return;
    }
    setPublishPreviewLoadingId(request.publicId);setMetaError('');
    try{
      const response=await apiFetch('/api/v1/admin/social/media/'+request.assetPublicId+'/preview',{cache:'no-store'});
      if(!response.ok){
        const error=await response.json().catch(()=>({})) as {message?:string;detail?:string};
        throw new Error(error.message??error.detail??'Artwork preview could not be loaded.');
      }
      const blob=await response.blob();
      if(blob.type!=='image/jpeg')throw new Error('The submitted artwork is not a supported JPEG preview.');
      const url=URL.createObjectURL(blob);
      publishPreviewUrlRefs.current[request.publicId]=url;
      setPublishPreviewUrls(old=>({...old,[request.publicId]:url}));
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Artwork preview could not be loaded.');}
    finally{setPublishPreviewLoadingId(null);}
  }

  async function refreshPublishRequests(){
    try{
      const response=await apiFetch('/api/v1/admin/social/meta/publish-requests?limit=50',{cache:'no-store'});
      const result=await response.json().catch(()=>[]) as MetaPublishRequest[]|{message?:string};
      if(!response.ok||!Array.isArray(result))throw new Error(('message' in result && result.message)||'Publish approval queue could not be loaded.');
      setPublishRequests(result);
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Publish approval queue could not be loaded.');}
  }

  async function decidePublishRequest(request:MetaPublishRequest,decision:'approve'|'reject'){
    const prompt=decision==='approve'
      ? (request.scheduledAt?'Approve this campaign for scheduled publishing?':'Approve and publish this campaign now? This creates a public post.')
      : 'Reject this campaign request? No post will be published.';
    if (!(await appConfirm(prompt, { title: decision === 'approve' ? 'Approve campaign request' : 'Reject campaign request', confirmLabel: decision === 'approve' ? 'Approve' : 'Reject' }))) return;
    setPublishingBusy(true);setMetaError('');setNotice('');
    try{
      const response=await apiFetch('/api/v1/admin/social/meta/publish-requests/'+request.publicId+'/'+decision,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:''})});
      const result=await response.json().catch(()=>({})) as MetaPublishRequest&{message?:string;detail?:string};
      if(!response.ok||!result.publicId)throw new Error(result.message??result.detail??'Approval decision could not be saved.');
      setPublishRequests(old=>[result,...old.filter(item=>item.publicId!==result.publicId)]);
      setNotice(decision==='reject'?'Campaign request rejected.':result.status==='SCHEDULED'
        ?'Campaign approved and scheduled. The backend will dispatch it at the chosen time.'
        :result.publishStatus==='PUBLISHED'?'Campaign approved and published. Provider post ID: '+(result.externalPostId??'recorded')+'.'
        :'Campaign approved. Provider status: '+(result.publishStatus||result.status)+'.');
      await refreshPublishRequests();
    }catch(cause){setMetaError(cause instanceof Error?cause.message:'Approval decision could not be saved.');}
    finally{setPublishingBusy(false);}
  }

  async function disconnectMeta() {
    const activeDestinations = metaStatus?.destinations.filter((destination) => destination.status === 'ACTIVE').length ?? 0;
    if (!canManage || activeDestinations === 0) return;
    if (!(await appConfirm('Disconnect all linked Facebook/Instagram accounts from this app? Future publishing will stop. Meta revocation will be attempted; if Meta does not confirm it, remove the app in Meta Business settings too.', { title: 'Disconnect social accounts', confirmLabel: 'Disconnect accounts', danger: true }))) return;

    setMetaDisconnecting(true);
    setMetaError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/v1/admin/social/meta/disconnect', { method: 'POST' });
      const result = await response.json().catch(() => ({})) as {
        connectionsDisconnected?: number;
        destinationsDisabled?: number;
        providerRevocationsConfirmed?: number;
        message?: string;
        detail?: string;
      };
      if (!response.ok || result.connectionsDisconnected === undefined)
        throw new Error(result.message ?? result.detail ?? 'Meta disconnect could not be completed.');
      setNotice(result.message ?? 'Meta accounts disconnected.');
      const statusResponse = await apiFetch('/api/v1/admin/social/meta/status', { cache: 'no-store' });
      const nextStatus = await statusResponse.json().catch(() => ({})) as MetaStatus & { message?: string; detail?: string };
      if (!statusResponse.ok) throw new Error(nextStatus.message ?? nextStatus.detail ?? 'Disconnect succeeded, but status could not be refreshed.');
      setMetaStatus(nextStatus);
      setPendingPublishAssetId(null);
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : 'Meta disconnect could not be completed.');
    } finally {
      setMetaDisconnecting(false);
    }
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
        headlineColor,
        messageColor,
        photoSource,
        logoSource,
        layers: layerVisibility,
        transforms: layerTransforms,
        musicAssetId: selectedMusicId,
        musicClipStart,
        musicClipDuration,
        musicVolume,
        storyTarget,
        objects: canvasObjects,
        updatedAt: new Date().toISOString(),
      };
      await writeArtworkDraft(draft);
      setActiveDraftId(draft.id);
      setDraftName(draft.name);
      await refreshSavedDrafts();
      setNotice('Draft saved in this browser. Existing browser drafts remain available on this device; they are not synced to other staff devices.');
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
      setHeadlineColor(draft.headlineColor ?? '#ffffff');
      setMessageColor(draft.messageColor ?? '#e4eaf3');
      setPhotoSource(draft.photoSource);
      setLogoSource(draft.logoSource ?? null);
      setLayerVisibility(draft.layers ?? defaultArtworkLayers);
      setLayerTransforms(draft.transforms ?? defaultArtworkTransforms);
      const restoredTarget = draft.storyTarget ?? 'whatsapp-status';
      setStoryTarget(restoredTarget);
      setSelectedMusicId(draft.musicAssetId ?? null);
      setMusicClipDuration(Math.min(draft.musicClipDuration ?? MUSIC_CLIP_DEFAULT_SECONDS, storyTargetSettings(restoredTarget).maxDuration));
      setMusicClipStart(draft.musicClipStart ?? 0);
      setMusicVolume(draft.musicVolume ?? 78);
      setSelectedLayer('headline');
      setCanvasObjects(draft.objects ?? []);
      setSelectedCanvasObjectId(null);
      canvasUndoRef.current = [];
      canvasRedoRef.current = [];
      setSelectedAssetId(null);
      setSelectedLogoAssetId(null);
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
    setHeadlineColor('#ffffff');
    setMessageColor('#e4eaf3');
    setPhotoSource(null);
    setLogoSource(null);
    setSelectedAssetId(null);
    setSelectedLogoAssetId(null);
    setLayerVisibility(defaultArtworkLayers);
    setLayerTransforms(defaultArtworkTransforms);
    setCanvasObjects([]);
    setSelectedCanvasObjectId(null);
    canvasUndoRef.current = [];
    canvasRedoRef.current = [];
    setSelectedMusicId(null);
    setStoryTarget('whatsapp-status');
    setMusicClipStart(0);
    setMusicClipDuration(MUSIC_CLIP_DEFAULT_SECONDS);
    setMusicVolume(78);
    setSelectedLayer('headline');
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

  async function createStoryVideo() {
    const sourceCanvas = canvasRef.current;
    const track = musicAssets.find((item) => item.id === selectedMusicId);
    if (!track?.fileData || !musicPreviewUrl) {
      setError('Import and select a music track before creating the Story video.');
      return;
    }
    if (formatId !== 'story-status') {
      setFormatId('story-status');
      setNotice('Switched the artwork to the 9:16 Story / Status layout. Review the preview, then create the video again.');
      return;
    }
    if (!sourceCanvas || typeof MediaRecorder === 'undefined' || typeof sourceCanvas.captureStream !== 'function') {
      setError('This browser does not support video export. Try the latest Chrome, Edge or Safari.');
      return;
    }

    setVideoExporting(true);
    setError('');
    setNotice('Preparing a vertical Story video with your selected music. Keep this tab open until export finishes.');
    let audioContext: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    let outputStream: MediaStream | null = null;
    let frameId = 0;
    let recorder: MediaRecorder | null = null;
    let videoBlobPromise: Promise<Blob> | null = null;

    try {
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = 1080;
      outputCanvas.height = 1920;
      const outputContext = outputCanvas.getContext('2d');
      if (!outputContext) throw new Error('The Story video canvas could not be created.');

      // Resume the Web Audio context directly from the user's click before any file decode awaits.
      audioContext = new AudioContext();
      await withTimeout(audioContext.resume(), 5_000, 'The browser audio engine did not start. Try the latest Chrome, Edge or Safari.');
      const sourceBytes = await track.fileData.arrayBuffer();
      const decodedAudio = await withTimeout(audioContext.decodeAudioData(sourceBytes), 15_000, 'The selected audio file could not be decoded for video export. Try an MP3 or WAV file.');
      const requestedDuration = Math.min(storyDurationLimit, MUSIC_CLIP_MAX_SECONDS, Math.max(MUSIC_CLIP_MIN_SECONDS, musicClipDuration));
      const duration = Math.min(requestedDuration, Math.floor(decodedAudio.duration));
      if (duration < MUSIC_CLIP_MIN_SECONDS) {
        throw new Error('The audio file has less than 20 seconds of usable audio. Choose a longer track.');
      }
      const selectionStart = Math.max(0, Math.min(musicClipStart, Math.max(0, decodedAudio.duration - duration)));

      const gain = audioContext.createGain();
      const audioDestination = audioContext.createMediaStreamDestination();
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = decodedAudio;
      const volume = Math.max(0, Math.min(1, musicVolume / 100));
      const audioStartAt = audioContext.currentTime + 0.12;
      gain.gain.setValueAtTime(0, audioStartAt);
      gain.gain.linearRampToValueAtTime(volume, audioStartAt + Math.min(0.6, duration / 4));
      gain.gain.setValueAtTime(volume, audioStartAt + Math.max(0.6, duration - 0.8));
      gain.gain.linearRampToValueAtTime(0, audioStartAt + duration);
      audioSource.connect(gain);
      gain.connect(audioDestination);

      const videoStream = outputCanvas.captureStream(30);
      outputStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);
      const mimeCandidates = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const supportedMime = mimeCandidates.find((mime) => MediaRecorder.isTypeSupported(mime));
      recorder = supportedMime
        ? new MediaRecorder(outputStream, { mimeType: supportedMime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 })
        : new MediaRecorder(outputStream);

      videoBlobPromise = new Promise<Blob>((resolve, reject) => {
        if (!recorder) return reject(new Error('The video recorder could not be created.'));
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error('Video recording failed. Try a shorter clip or another browser.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder?.mimeType || supportedMime || 'video/webm' }));
      });

      const drawFrame = (elapsedSeconds: number) => {
        const zoom = 1 + Math.min(0.025, 0.025 * elapsedSeconds / duration);
        outputContext.fillStyle = '#0b1220';
        outputContext.fillRect(0, 0, 1080, 1920);
        outputContext.save();
        outputContext.translate(540, 960);
        outputContext.scale(zoom, zoom);
        outputContext.drawImage(sourceCanvas, -540, -960, 1080, 1920);
        outputContext.restore();

        // Gentle floating light flecks give the campaign image the motion feel of a social Story.
        for (let index = 0; index < 16; index += 1) {
          const phase = (elapsedSeconds * (18 + (index % 5) * 3) + index * 127) % 1920;
          const x = (index * 193 + Math.sin(elapsedSeconds * 0.55 + index) * 44 + 1080) % 1080;
          outputContext.globalAlpha = 0.08 + (Math.sin(elapsedSeconds * 2 + index) + 1) * 0.08;
          outputContext.fillStyle = index % 3 === 0 ? '#ffffff' : '#fbbf24';
          outputContext.beginPath();
          outputContext.arc(x, 1920 - phase, index % 4 === 0 ? 3 : 1.6, 0, Math.PI * 2);
          outputContext.fill();
        }
        outputContext.globalAlpha = 1;
      };

      recorder.start(250);
      audioSource.start(audioStartAt, selectionStart, duration);
      const startTimestamp = performance.now();
      await withTimeout(new Promise<void>((resolve, reject) => {
        const draw = (now: number) => {
          try {
            const elapsed = Math.max(0, (now - startTimestamp) / 1000);
            drawFrame(elapsed);
            if (elapsed >= duration) {
              resolve();
              return;
            }
            frameId = window.requestAnimationFrame(draw);
          } catch (cause) {
            reject(cause instanceof Error ? cause : new Error('A Story video frame could not be rendered.'));
          }
        };
        frameId = window.requestAnimationFrame(draw);
      }), (duration * 1000) + 10_000, 'The browser stopped rendering video frames. Keep this tab visible and try again.');
      if (recorder.state !== 'inactive') recorder.stop();
      const videoBlob = await withTimeout(videoBlobPromise, 10_000, 'The browser recorder did not finish the video. Try another supported browser.');
      if (!videoBlob.size) throw new Error('Video export produced an empty file. Try again.');
      const mimeType = videoBlob.type || supportedMime || 'video/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const url = URL.createObjectURL(videoBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'lucky-bajaj-story-' + duration + 's.' + extension;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const uploadNote = extension === 'mp4'
        ? 'Upload it manually in the selected social app; this file is not published automatically.'
        : 'This browser exported WebM. Some social upload flows accept MP4/MOV only, so convert it to MP4 before posting if the app rejects it.';
      setNotice('Vertical video exported for ' + selectedStoryTarget.label + ' (' + duration + ' seconds, ' + extension.toUpperCase() + '). ' + uploadNote);
    } catch (cause) {
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* The recorder may already be stopping. */ }
      }
      setError(cause instanceof Error ? cause.message : 'The Story video could not be exported.');
    } finally {
      if (frameId) window.cancelAnimationFrame(frameId);
      try { audioSource?.stop(); } catch { /* The scheduled source may have already ended. */ }
      outputStream?.getTracks().forEach((trackItem) => trackItem.stop());
      if (audioContext && audioContext.state !== 'closed') {
        try { await audioContext.close(); } catch { /* The browser may already have closed the audio context. */ }
      }
      setVideoExporting(false);
    }
  }


  async function togglePickerMusicPreview(track: ArtworkMusicAsset) {
    if (!track.fileData) {
      window.open(track.sourcePage, '_blank', 'noopener,noreferrer');
      setNotice('Opened the creator source page for ' + track.name + '. Listen there, then download and attach the MP3 to preview it inside the editor.');
      return;
    }
    const audio = pickerAudioRef.current;
    if (!audio) return;
    if (previewingMusicId === track.id && !audio.paused) {
      audio.pause();
      setPreviewingMusicId(null);
      return;
    }
    audio.pause();
    if (pickerAudioUrlRef.current) URL.revokeObjectURL(pickerAudioUrlRef.current);
    const url = URL.createObjectURL(track.fileData);
    pickerAudioUrlRef.current = url;
    audio.src = url;
    audio.volume = musicVolume / 100;
    audio.currentTime = 0;
    try { await audio.play(); setPreviewingMusicId(track.id); setError(''); }
    catch { setPreviewingMusicId(null); setError('The selected music could not be previewed in this browser.'); }
  }

  function toggleMusicFavourite(id: string) {
    setFavoriteMusicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }


  function pushCanvasObjectHistory() {
    canvasUndoRef.current = [...canvasUndoRef.current.slice(-39), canvasObjects];
    canvasRedoRef.current = [];
  }

  async function addCanvasImageObject(asset: ArtworkAsset) {
    setAssetBusyId(asset.id);
    setError('');
    setNotice('');
    try {
      await resolveArtworkAssetSource(asset);
      const refreshed = await refreshArtworkAssets();
      if (!refreshed.some((item) => item.id === asset.id)) throw new Error('The selected image could not be cached in the asset library.');
      pushCanvasObjectHistory();
      const next: CanvasObject = {
        id: newDraftId(), kind: 'image', assetId: asset.id, text: '',
        x: 32, y: 32, width: 38, height: 32, fill: '#ffffff', fontSize: 24,
        bold: false, italic: false, fontFamily: 'Arial', align: 'left', rotation: 0, opacity: 100,
      };
      setCanvasObjects((current) => [...current, next]);
      setSelectedCanvasObjectId(next.id);
      setAssetLibraryOpen(false);
      setNotice(asset.name + ' added as an independent canvas image layer.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be added as a canvas layer.');
    } finally {
      setAssetBusyId(null);
    }
  }

  function addCanvasObject(kind: CanvasObject['kind']) {
    pushCanvasObjectHistory();
    const next: CanvasObject = {
      id: newDraftId(), kind, text: kind === 'text' ? 'Your message here' : '',
      x: 28, y: 43, width: kind === 'text' ? 48 : 24, height: kind === 'text' ? 9 : 18,
      fill: kind === 'text' ? '#ffffff' : accent, fontSize: 44, bold: true, italic: false, fontFamily: 'Arial', align: 'left', rotation: 0, opacity: 100,
    };
    setCanvasObjects((current) => [...current, next]);
    setSelectedCanvasObjectId(next.id);
  }

  function updateCanvasObject(id: string, changes: Partial<CanvasObject>) {
    pushCanvasObjectHistory();
    setCanvasObjects((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }


  function reorderCanvasObject(id: string, direction: -1 | 1) {
    const index = canvasObjects.findIndex((item) => item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= canvasObjects.length) return;
    pushCanvasObjectHistory();
    const next = [...canvasObjects];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setCanvasObjects(next);
  }

  function duplicateCanvasObject() {
    const selected = canvasObjects.find((item) => item.id === selectedCanvasObjectId);
    if (!selected) return;
    pushCanvasObjectHistory();
    const copy = { ...selected, id: newDraftId(), x: Math.min(88, selected.x + 4), y: Math.min(88, selected.y + 4) };
    setCanvasObjects((current) => [...current, copy]);
    setSelectedCanvasObjectId(copy.id);
  }

  function deleteCanvasObject() {
    if (!selectedCanvasObjectId) return;
    pushCanvasObjectHistory();
    setCanvasObjects((current) => current.filter((item) => item.id !== selectedCanvasObjectId));
    setSelectedCanvasObjectId(null);
  }

  function undoCanvasObject() {
    const previous = canvasUndoRef.current.pop();
    if (!previous) return;
    canvasRedoRef.current.push(canvasObjects);
    setCanvasObjects(previous);
  }

  function redoCanvasObject() {
    const next = canvasRedoRef.current.pop();
    if (!next) return;
    canvasUndoRef.current.push(canvasObjects);
    setCanvasObjects(next);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const selected = [...canvasObjects].reverse().find((item) =>
      x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
    );
    if (!selected) { setSelectedCanvasObjectId(null); return; }
    event.preventDefault();
    pushCanvasObjectHistory();
    setSelectedCanvasObjectId(selected.id);
    canvasDragRef.current = { id: selected.id, offsetX: x - selected.x, offsetY: y - selected.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = canvasDragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100 - drag.offsetX;
    const y = ((event.clientY - rect.top) / rect.height) * 100 - drag.offsetY;
    setCanvasObjects((current) => current.map((item) => item.id === drag.id
      ? { ...item, x: Math.max(0, Math.min(100 - item.width, x)), y: Math.max(0, Math.min(100 - item.height, y)) }
      : item));
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    canvasDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className={styles.page}>
      <section className={styles.studio}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>LUCKY BAJAJ AGENCY · CAMPAIGN DESIGN</span>
            <h2 id="social-artwork-title">LuckyBajaj Creative Studio</h2>
            <p>Create dealership campaigns in the editor, then connect accounts and manage approval, scheduling and delivery.</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Back to staff workspace">← Back</button>
        </header>

        <nav className={styles.studioTabs} aria-label="Social media studio sections">
          <button type="button" className={activeStudioTab === 'create' ? styles.studioTabActive : styles.studioTab} aria-current={activeStudioTab === 'create' ? 'page' : undefined} onClick={() => setActiveStudioTab('create')}><span>01</span>Create & edit</button>
          <button type="button" className={activeStudioTab === 'connections' ? styles.studioTabActive : styles.studioTab} aria-current={activeStudioTab === 'connections' ? 'page' : undefined} onClick={() => setActiveStudioTab('connections')}><span>02</span>Connections</button>
          <button type="button" className={activeStudioTab === 'publishing' ? styles.studioTabActive : styles.studioTab} aria-current={activeStudioTab === 'publishing' ? 'page' : undefined} onClick={() => setActiveStudioTab('publishing')}><span>03</span>Publishing & history</button>
        </nav>
        <div className={styles.connectionsWorkspace} style={{ display: activeStudioTab === 'connections' ? 'grid' : 'none' }}>
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
          {!metaLoading && !!metaStatus?.missingConfigurationKeys?.length && (
            <div className={styles.configurationNotice} role="status">
              <strong>Meta connection configuration is incomplete</strong>
              <p>The following setting(s) are missing or invalid. Add or correct them in the API deployment environment:</p>
              <ul>{metaStatus.missingConfigurationKeys.map((key) => <li key={key}><code>{key}</code></li>)}</ul>
            </div>
          )}
          {!metaLoading && !!metaStatus?.missingPublishingConfigurationKeys?.length && (
            <div className={styles.configurationNotice} role="status">
              <strong>Direct publishing is not configured</strong>
              <p>Account connection can be configured separately, but direct publishing stays disabled until these settings are correct:</p>
              <ul>{metaStatus.missingPublishingConfigurationKeys.map((key) => <li key={key}><code>{key}</code></li>)}</ul>
            </div>
          )}
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
          {canManage && metaStatus?.destinations?.some((destination) => destination.status === 'ACTIVE') && <button type="button" className={styles.textButton} disabled={metaDisconnecting || metaConnecting} onClick={() => void disconnectMeta()}>{metaDisconnecting ? 'Disconnecting accounts…' : 'Disconnect all Meta accounts'}</button>}
          <p className={styles.metaFootnote}>{metaStatus?.publishingReady ? 'Direct publishing is configured. Each post needs confirmation and a provider-backed result.' : 'Direct publishing is disabled until every required setting is configured. The exact setting names are listed above; connecting an account alone never publishes content.'}</p>
        </section>

          {(canReadWhatsapp || canManageWhatsapp || canSendWhatsapp) && <SocialWhatsAppWorkspace canRead={canReadWhatsapp} canManage={canManageWhatsapp} canSend={canSendWhatsapp} getArtworkJpeg={getArtworkJpeg} />}
        </div>
        {activeStudioTab === 'publishing' && <div className={styles.publishWorkspace}>
            <section className={styles.publishPanel} aria-label="Publish campaign artwork">
              <div className={styles.publishPanelHeading}><strong>Publish to social media</strong><span>{metaStatus?.publishingReady?'API ready':'Not configured'}</span></div>
              <label>Destination
                <select value={publishDestinationId} onChange={(event)=>setPublishDestinationId(event.target.value)} disabled={!activeMetaDestinations.length||publishingBusy}>
                  {activeMetaDestinations.length===0&&<option value="">Connect a Facebook Page or Instagram account first</option>}
                  {activeMetaDestinations.map(d=><option key={d.publicId} value={d.publicId}>{d.displayName} · {d.type==='FACEBOOK_PAGE'?'Facebook Page':'Instagram'}</option>)}
                </select>
              </label>
              <label>Schedule for (optional)
                <input type="datetime-local" value={scheduleLocal} min={localDateTimeMin()} onChange={(event)=>setScheduleLocal(event.target.value)} disabled={publishingBusy}/>
              </label>
              <p className={styles.note}>Leave blank for immediate publishing after approval. Scheduled posts must be at least two minutes ahead and within 90 days.</p>
              <button type="button" className={styles.publishButton} disabled={!canPublish||!canPublishSelectedFormat||!metaStatus?.publishingReady||!publishDestinationId||publishingBusy} onClick={()=>void publishArtwork()}>{publishingBusy?'Saving approval request…':!canPublish?'Publishing permission required':canPublishSelectedFormat?'Request approval':'Choose a feed format to request approval'}</button>
              <div className={styles.publishResult}>
                <div><strong>Approval and schedule queue</strong><button type="button" className={styles.textButton} disabled={publishingBusy} onClick={()=>void refreshPublishRequests()}>Refresh</button></div>
                {publishRequests.length===0&&<p>No publish requests yet.</p>}
                {publishRequests.map(request=><article key={request.publicId} className={styles.publishResult}>
                  <div><strong>{request.destinationName}</strong><span className={request.publishStatus==='PUBLISHED'?styles.connectedState:request.publishStatus==='FAILED'||request.publishStatus==='REJECTED'?styles.disconnectedState:styles.publishPendingState}>{request.publishStatus||request.status}</span></div>
                  <p>{request.status.replaceAll('_',' ')} · requested by {request.requestedBy}{request.approvedBy?' · approved by '+request.approvedBy:''}</p>
                  {request.scheduledAt&&<p>Scheduled: {new Date(request.scheduledAt).toLocaleString()}</p>}
                  <p>{request.caption}</p>
                  <button type="button" className={styles.textButton} disabled={publishPreviewLoadingId!==null}
                    onClick={()=>void togglePublishPreview(request)}>
                    {publishPreviewLoadingId===request.publicId?'Loading artwork preview…':publishPreviewUrls[request.publicId]?'Hide artwork preview':'Preview submitted artwork'}
                  </button>
                  {publishPreviewUrls[request.publicId]&&<img src={publishPreviewUrls[request.publicId]}
                    alt={'Submitted campaign artwork for '+request.destinationName}
                    style={{maxWidth:'100%',maxHeight:360,display:'block',objectFit:'contain',marginTop:8}} />}
                  {canManage&&request.status==='PENDING_APPROVAL'&&!publishPreviewUrls[request.publicId]&&
                    <p className={styles.note}>Load the submitted artwork preview before approving. If it cannot be loaded, reject the request and ask for a fresh submission.</p>}
                  {request.externalPostId&&<p>Provider post ID: {request.externalPostId}</p>}
                  {request.errorCode&&<p>Error: {request.errorCode}</p>}
                  {canManage&&request.status==='PENDING_APPROVAL'&&<div className={styles.actions}>
                    <button type="button" className={styles.primary} disabled={publishingBusy||!publishPreviewUrls[request.publicId]} onClick={()=>void decidePublishRequest(request,'approve')}>Approve {request.scheduledAt?'schedule':'and publish'}</button>
                    <button type="button" className={styles.secondary} disabled={publishingBusy} onClick={()=>void decidePublishRequest(request,'reject')}>Reject</button>
                  </div>}
                  {canManage&&request.status==='SCHEDULED'&&<button type="button" className={styles.textButton} disabled={publishingBusy} onClick={()=>void (async()=>{try{const response=await apiFetch('/api/v1/admin/social/meta/publish-requests/'+request.publicId+'/cancel',{method:'POST'});const result=await response.json() as MetaPublishRequest;if(!response.ok)throw new Error('Cancel request failed.');setPublishRequests(old=>old.map(item=>item.publicId===result.publicId?result:item));}catch(cause){setMetaError(cause instanceof Error?cause.message:'Cancel request failed.');}})()}>Cancel scheduled post</button>}
                </article>)}
              </div>
              {!canPublishSelectedFormat && <p className={styles.note}>Story / Status artwork is export/share-only in this version. Choose Facebook Feed, Square Feed or Instagram Feed to publish directly.</p>}
              <p className={styles.note}>Requests are saved in the backend for approval. The scheduler dispatches approved posts; uncertain provider outcomes are reconciled and never blindly reposted.</p>
            </section>

        </div>}
        <div className={styles.content} style={{ display: activeStudioTab === 'create' ? 'grid' : 'none' }}>
          <aside className={styles.controls}>
            <div className={styles.pickerLaunchers}>
              <button type="button" className={styles.pickerLaunchButton} onClick={(event) => { pickerTriggerRef.current = event.currentTarget; setAssetPreviewId(artworkAssets[0]?.id ?? null); setAssetSearch(''); setAssetLibraryOpen(true); }}><span>▧</span><strong>Photos & assets</strong><small>{artworkAssets.length} images · browse library</small></button>
              <button type="button" className={styles.pickerLaunchButton} onClick={(event) => { pickerTriggerRef.current = event.currentTarget; setMusicSearch(''); setMusicLibraryOpen(true); }}><span>♫</span><strong>Music & sound</strong><small>{musicAssets.length} tracks · choose audio</small></button>
            </div>
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
            <section className={styles.templatePanel} aria-label="Ready-made campaign templates">
              <div className={styles.panelHeading}>
                <div><strong>Ready-made campaigns</strong><small>Festival, national and awareness designs</small></div>
                <button type="button" className={styles.textButton} onClick={() => setTemplateGalleryOpen((open) => !open)}>
                  {templateGalleryOpen ? 'Collapse' : 'Browse'}
                </button>
              </div>
              {templateGalleryOpen && <div className={styles.templateGrid}>
                {ARTWORK_TEMPLATES.map((template) => {
                  const asset = artworkAssets.find((item) => item.id === template.assetId);
                  const thumbnail = assetPreviewSources[template.assetId] || asset?.sourceUrl || '';
                  return <button key={template.id} type="button"
                    className={styles.templateTile}
                    disabled={assetBusyId !== null}
                    aria-label={'Use ' + template.name + ' template'}
                    onClick={() => void applyArtworkTemplate(template)}>
                    {thumbnail ? <img src={thumbnail} alt="" loading="lazy" /> : <span className={styles.templatePlaceholder}>Festival artwork</span>}
                    <span><strong>{template.name}</strong><small>{template.occasion}</small></span>
                  </button>;
                })}
              </div>}
              <p className={styles.panelFootnote}>Choose a design, then edit its headline, message, colours, image and call to action. Confirm text and any offer details before export.</p>
            </section>
            {assetLibraryOpen && <div className={styles.pickerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setAssetLibraryOpen(false); }}>
              <div ref={pickerDialogRef} className={styles.pickerDialog} role="dialog" aria-modal="true" aria-label="Choose an artwork image" tabIndex={-1}>
            <section className={styles.assetPanel} aria-label="Artwork asset library">
              <div className={styles.panelHeading}>
                <div><strong>Asset library</strong><small>{artworkAssets.length} / {ARTWORK_ASSET_LIMIT} images · JPEG or PNG</small></div>
                <button type="button" className={styles.textButton} onClick={() => setAssetLibraryOpen((open) => !open)}>
                  {assetLibraryOpen ? 'Hide library' : 'Browse library'}
                </button>
              </div>
              <label className={styles.assetUpload}>Upload image to library
                <input data-testid="artwork-image-upload" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => void handlePhotoUpload(event)} disabled={assetBusyId !== null || artworkAssets.length >= ARTWORK_ASSET_LIMIT} />
              </label>
              <p className={styles.panelFootnote}>Maximum 50 assets total; each upload is limited to 4.5 MB and 20 megapixels. Starter images are imported and kept in this browser when selected. Uploaded files are browser-local and are not synced to other staff devices.</p>
              <input className={styles.pickerSearch} type="search" aria-label="Search image assets" placeholder="Search images and categories" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} />
              {assetPreviewId && artworkAssets.find((item) => item.id === assetPreviewId) && <div className={styles.assetFocusPreview}><img src={assetPreviewSources[assetPreviewId] || artworkAssets.find((item) => item.id === assetPreviewId)?.sourceUrl || ''} alt={artworkAssets.find((item) => item.id === assetPreviewId)?.name || 'Artwork image preview'} /><div><strong>{artworkAssets.find((item) => item.id === assetPreviewId)?.name}</strong><small>{artworkAssets.find((item) => item.id === assetPreviewId)?.category}</small></div></div>}
              {assetLibraryOpen && <div className={styles.assetGrid}>
                {artworkAssets.filter((asset) => (asset.name + ' ' + asset.category).toLowerCase().includes(assetSearch.toLowerCase())).map((asset) => <article key={asset.id} className={styles.assetTile} onMouseEnter={() => setAssetPreviewId(asset.id)} onFocus={() => setAssetPreviewId(asset.id)} onClick={() => setAssetPreviewId(asset.id)}>
                  {assetPreviewSources[asset.id]
                    ? <img src={assetPreviewSources[asset.id]} alt="" loading="lazy" />
                    : <div className={styles.templatePlaceholder}>Image preview</div>}
                  <strong>{asset.name}</strong>
                  <small>{asset.category}</small>
                  <small>{asset.fileData ? 'Stored in this browser' : 'Online starter · imported on use'}</small>
                  <a href={asset.sourcePage} target="_blank" rel="noreferrer">Source &amp; license</a>
                  <div className={styles.assetActions}>
                    <button type="button" className={styles.secondary} disabled={assetBusyId !== null}
                      onClick={() => void selectArtworkAsset(asset)}>
                      {assetBusyId === asset.id ? 'Importing…' : selectedAssetId === asset.id ? 'Image selected' : 'Use image'}
                    </button>
                    <button type="button" className={styles.secondary} disabled={assetBusyId !== null}
                      onClick={() => void addCanvasImageObject(asset)}>
                      Add to canvas
                    </button>
                    <button type="button" className={styles.secondary} disabled={assetBusyId !== null}
                      onClick={() => void selectArtworkAsset(asset, 'logo')}>
                      {selectedLogoAssetId === asset.id ? 'Logo selected' : 'Use as logo'}
                    </button>
                    {!asset.isStarter && <button type="button" className={styles.textButton}
                      disabled={assetBusyId !== null} onClick={() => void deleteLibraryAsset(asset)}>Remove</button>}
                  </div>
                </article>)}
              </div>}
            </section>
              </div>
            </div>}
            {musicLibraryOpen && <div className={styles.pickerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setMusicLibraryOpen(false); }}>
              <div ref={pickerDialogRef} className={styles.pickerDialog} role="dialog" aria-modal="true" aria-label="Choose background music" tabIndex={-1}>
            <section className={styles.musicPanel} aria-label="Music asset library">
              <div className={styles.panelHeading}>
                <div><strong>Music library</strong><small>{musicAssets.length} / {ARTWORK_MUSIC_LIMIT} tracks · separate from image assets</small></div>
                <button type="button" className={styles.textButton} onClick={() => setMusicLibraryOpen((open) => !open)}>
                  {musicLibraryOpen ? 'Hide music' : 'Browse music'}
                </button>
              </div>
              <label className={styles.musicUpload}>Add your own song
                <input data-testid="artwork-music-upload" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/aac,.mp3,.m4a,.wav,.ogg,.webm,.aac"
                  onChange={(event) => void handleMusicFile(event)}
                  disabled={videoExporting || musicAssets.length >= ARTWORK_MUSIC_LIMIT} />
              </label>
              <p className={styles.panelFootnote}>Maximum 50 songs and {Math.round(ARTWORK_MUSIC_LIBRARY_MAX_BYTES / (1024 * 1024))} MB total audio, separately from the 50 images. Each file is limited to 25 MB. Tracks must be at least 20 seconds; videos can use 20–120 seconds, with 30 seconds as the default. The 10 curated festive picks below link to their source pages: download the MP3 there and attach it once to keep it in this browser. Please check each track's current licence and rights before commercial use.</p>
              <input className={styles.pickerSearch} type="search" aria-label="Search music tracks" placeholder="Search track, creator or category" value={musicSearch} onChange={(event) => setMusicSearch(event.target.value)} />
              {musicLibraryOpen && <div className={styles.musicGrid}>
                {musicAssets.filter((track) => (track.name + ' ' + track.category + ' ' + track.creator).toLowerCase().includes(musicSearch.toLowerCase())).map((track) => (
                  <article key={track.id} className={styles.musicTile} data-ready={Boolean(track.fileData)} data-selected={selectedMusicId === track.id}>
                    <div className={styles.musicTileTop}>
                      <span className={styles.musicDisc} aria-hidden="true">♫</span>
                      <div className={styles.musicTileCopy}>
                        <strong>{track.name}</strong>
                        <small>{track.category} · {track.creator}</small>
                      </div>
                      <span className={styles.musicDuration}>{Math.floor(track.durationSeconds / 60)}:{String(Math.floor(track.durationSeconds % 60)).padStart(2, '0')}</span>
                    </div>
                    <span className={styles.musicStatus}>{track.fileData ? 'Saved in this browser' : 'MP3 not imported yet'}</span>
                    <a href={track.sourcePage} target="_blank" rel="noreferrer">Download from source</a>
                    <label className={styles.musicUpload}>{track.fileData ? 'Replace audio file' : 'Attach downloaded MP3'}
                      <input data-testid={'attach-music-' + track.id} type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/aac,.mp3,.m4a,.wav,.ogg,.webm,.aac"
                        onChange={(event) => void handleMusicFile(event, track.id)}
                        disabled={videoExporting} />
                    </label>
                    <div className={styles.musicActions}>
                      <button type="button" className={styles.secondary} onClick={() => void togglePickerMusicPreview(track)} disabled={videoExporting}>{previewingMusicId === track.id ? 'Pause preview' : track.fileData ? 'Preview' : 'Preview source'}</button>
                      <button type="button" className={styles.textButton} onClick={() => toggleMusicFavourite(track.id)} aria-pressed={favoriteMusicIds.includes(track.id)}>{favoriteMusicIds.includes(track.id) ? '★ Saved' : '☆ Favourite'}</button>
                      <button type="button" className={styles.secondary} onClick={() => void selectMusicTrack(track)} disabled={!track.fileData || videoExporting}>
                        {selectedMusicId === track.id ? 'Selected track' : 'Use track'}
                      </button>
                      {selectedMusicId === track.id && <button type="button" className={styles.secondary} onClick={() => void toggleMusicPreview()} disabled={!selectedMusicReady || videoExporting}>
                        {musicIsPlaying ? 'Pause preview' : 'Preview clip'}
                      </button>}
                      {!track.isStarter && <button type="button" className={styles.textButton} onClick={() => void deleteMusicTrack(track)} disabled={videoExporting}>Remove</button>}
                    </div>
                    {track.contentIdRegistered && <small className={styles.musicRightsWarning}>Content ID registered · automated claims, muting or blocking may occur on social platforms.</small>}
                    <small className={styles.musicLicense}>{track.licenseLabel}</small>
                  </article>
                ))}
              </div>}
            </section>
              </div>
            </div>}
            <audio ref={pickerAudioRef} hidden onEnded={() => setPreviewingMusicId(null)} onPause={() => setPreviewingMusicId(null)} />
            <section className={styles.storyVideoPanel} aria-label="Story video creator">
              <div className={styles.panelHeading}><div><strong>Story video creator</strong><small>9:16 vertical video · choose where it will be used</small></div><span className={styles.storyDurationPill}>{musicClipDuration}s</span></div>
              <label className={styles.storyTargetLabel}>Destination
                <select aria-label="Story video destination" value={storyTarget} disabled={videoExporting}
                  onChange={(event) => {
                    const nextTarget = event.target.value as StoryTarget;
                    const maxDuration = storyTargetSettings(nextTarget).maxDuration;
                    setStoryTarget(nextTarget);
                    setMusicClipDuration((duration) => Math.min(duration, maxDuration));
                    setMusicClipStart((start) => Math.min(start, Math.max(0, (selectedMusicTrack?.durationSeconds ?? 0) - Math.min(musicClipDuration, maxDuration))));
                  }}>
                  {storyTargets.map((target) => <option key={target.id} value={target.id}>{target.label} · up to {target.maxDuration}s</option>)}
                </select>
              </label>
              <p className={styles.panelFootnote}>{selectedStoryTarget.description}</p>
              <audio ref={musicAudioRef} src={musicPreviewUrl ?? undefined} preload="metadata" hidden
                onTimeUpdate={handleMusicTimeUpdate}
                onPause={() => setMusicIsPlaying(false)}
                onEnded={() => setMusicIsPlaying(false)} />
              <div className={styles.storyMusicSummary}>
                <span className={styles.musicDisc} aria-hidden="true">♫</span>
                <div><strong>{selectedMusicTrack?.name ?? 'Choose a song from the Music library'}</strong><small>{selectedMusicReady ? 'Ready to mix into the video' : 'Import an MP3 from the catalogue or upload a track'}</small></div>
              </div>
              <div className={styles.clipPresets} aria-label="Clip length">
                {[20, 30, 60, 90, 120].map((seconds) => (
                  <button key={seconds} type="button" className={musicClipDuration === seconds ? styles.clipPresetActive : styles.clipPreset}
                    aria-pressed={musicClipDuration === seconds}
                    disabled={videoExporting || seconds > storyDurationLimit || (selectedMusicTrack?.fileData ? seconds > selectedMusicTrack.durationSeconds : false)}
                    onClick={() => { setMusicClipDuration(seconds); setMusicClipStart((start) => Math.min(start, Math.max(0, (selectedMusicTrack?.durationSeconds ?? seconds) - seconds))); }}>
                    {seconds}s
                  </button>
                ))}
              </div>
              <label className={styles.musicRange}>Snippet start <strong>{musicClipStart.toFixed(1)}s</strong>
                <input aria-label="Music snippet start" type="range" min={0} max={musicStartLimit} step={0.5} value={Math.min(musicClipStart, musicStartLimit)}
                  onChange={(event) => { setMusicClipStart(Number(event.target.value)); setMusicIsPlaying(false); musicAudioRef.current?.pause(); }}
                  disabled={!selectedMusicReady || videoExporting || musicStartLimit <= 0} />
              </label>
              <label className={styles.musicRange}>Music volume <strong>{musicVolume}%</strong>
                <input aria-label="Music volume" type="range" min={0} max={100} step={1} value={musicVolume}
                  onChange={(event) => setMusicVolume(Number(event.target.value))} disabled={!selectedMusicReady || videoExporting} />
              </label>
              {formatId !== 'story-status' && <button type="button" className={styles.secondary} onClick={() => setFormatId('story-status')} disabled={videoExporting}>Use 9:16 Story format</button>}
              <button type="button" className={styles.primary} onClick={() => void createStoryVideo()} disabled={!selectedMusicReady || videoExporting || formatId !== 'story-status'}>
                {videoExporting ? 'Rendering story video…' : 'Create story video'}
              </button>
              <p className={styles.panelFootnote}>{videoExporting ? 'Rendering the selected clip in real time. Keep this tab open until download begins.' : 'The export combines the current artwork, gentle story-style motion and chosen music. Direct publishing and native music stickers remain inside the social app. MP4 is preferred; if this browser exports WebM instead, convert it before uploading to a platform that only accepts MP4/MOV.'}</p>
            </section>
            <section className={styles.layerPanel} aria-label="Artwork layers">
              <div className={styles.panelHeading}><div><strong>Canvas layers</strong><small>Show or hide individual parts</small></div></div>
              <div className={styles.layerGrid}>
                {([
                  ['brand', 'Dealership name & mark'],
                  ['headline', 'Main heading'],
                  ['message', 'Supporting message'],
                  ['photo', 'Campaign image'],
                  ['callToAction', 'Call-to-action badge'],
                  ['decorations', 'Background decorations'],
                  ['footer', 'Footer tagline'],
                ] as Array<[keyof ArtworkLayerVisibility, string]>).map(([layer, label]) =>
                  <label className={styles.layerToggle} key={layer} data-selected={selectedLayer === layer} onClick={() => setSelectedLayer(layer)}>
                    <input type="checkbox" checked={layerVisibility[layer]} onChange={(event) => toggleArtworkLayer(layer, event.target.checked)} />
                    <span>{label}</span>
                  </label>)}
              </div>
              <div className={styles.transformControls}>
                <div className={styles.panelHeading}><div><strong>Selected layer: {selectedLayer === 'brand' ? 'Dealership name & mark' : selectedLayer === 'headline' ? 'Main heading' : selectedLayer === 'message' ? 'Supporting message' : selectedLayer === 'photo' ? 'Campaign image' : selectedLayer === 'callToAction' ? 'Call-to-action badge' : selectedLayer === 'decorations' ? 'Background decorations' : 'Footer tagline'}</strong><small>Move or resize this part of the artwork</small></div></div>
                <label className={styles.rangeControl}>Position X <span>{layerTransforms[selectedLayer].x}%</span>
                  <input type="range" min={-35} max={35} step={1} value={layerTransforms[selectedLayer].x} onChange={(event) => updateSelectedLayerTransform('x', Number(event.target.value))} />
                </label>
                <label className={styles.rangeControl}>Position Y <span>{layerTransforms[selectedLayer].y}%</span>
                  <input type="range" min={-25} max={25} step={1} value={layerTransforms[selectedLayer].y} onChange={(event) => updateSelectedLayerTransform('y', Number(event.target.value))} />
                </label>
                <label className={styles.rangeControl}>Size <span>{layerTransforms[selectedLayer].scale}%</span>
                  <input type="range" min={60} max={150} step={5} value={layerTransforms[selectedLayer].scale} onChange={(event) => updateSelectedLayerTransform('scale', Number(event.target.value))} />
                </label>
                <div className={styles.assetActions}>
                  <button type="button" className={styles.secondary} onClick={resetSelectedLayerTransform}>Reset selected layer</button>
                  <button type="button" className={styles.secondary} onClick={() => setLayerTransforms(defaultArtworkTransforms)}>Reset all layers</button>
                </div>
              </div>
            </section>
            <section className={styles.objectPanel} aria-label="Selected canvas object">
              <div className={styles.panelHeading}><div><strong>Canvas objects</strong><small>{canvasObjects.length} editable object(s) · select and drag on canvas</small></div></div>
              {selectedCanvasObjectId && canvasObjects.find((item) => item.id === selectedCanvasObjectId) ? (() => {
                const selected = canvasObjects.find((item) => item.id === selectedCanvasObjectId)!;
                return <div className={styles.objectInspector}>
                  {selected.kind === 'text' && <label>Text<input value={selected.text} maxLength={180} onChange={(event) => updateCanvasObject(selected.id, { text: event.target.value })} /></label>}
                  {selected.kind === 'image' && <p className={styles.panelFootnote}>Image layer: {artworkAssets.find((asset) => asset.id === selected.assetId)?.name ?? 'Stored artwork asset'}. Add another image from the picker to place it independently.</p>}
                  <label>Colour<input type="color" value={selected.fill} onChange={(event) => updateCanvasObject(selected.id, { fill: event.target.value })} /></label>
                  {selected.kind === 'text' && <>
                    <label>Font family<select value={selected.fontFamily} onChange={(event) => updateCanvasObject(selected.id, { fontFamily: event.target.value })}><option>Arial</option><option>Georgia</option><option>Verdana</option><option>Tahoma</option><option>Trebuchet MS</option><option>Impact</option><option>Courier New</option></select></label>
                    <label>Font size<input type="range" min={18} max={120} value={selected.fontSize} onChange={(event) => updateCanvasObject(selected.id, { fontSize: Number(event.target.value) })} /></label>
                    <label>Alignment<select value={selected.align} onChange={(event) => updateCanvasObject(selected.id, { align: event.target.value as CanvasObject['align'] })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
                    <label className={styles.objectCheck}><input type="checkbox" checked={selected.bold} onChange={(event) => updateCanvasObject(selected.id, { bold: event.target.checked })} /> Bold</label>
                    <label className={styles.objectCheck}><input type="checkbox" checked={selected.italic} onChange={(event) => updateCanvasObject(selected.id, { italic: event.target.checked })} /> Italic</label>
                  </>}
                  <label>Width <strong>{Math.round(selected.width)}%</strong><input type="range" min={5} max={90} value={selected.width} onChange={(event) => updateCanvasObject(selected.id, { width: Number(event.target.value) })} /></label>
                  <label>Height <strong>{Math.round(selected.height)}%</strong><input type="range" min={3} max={80} value={selected.height} onChange={(event) => updateCanvasObject(selected.id, { height: Number(event.target.value) })} /></label>
                  <label>Rotation <strong>{selected.rotation}°</strong><input type="range" min={-180} max={180} value={selected.rotation} onChange={(event) => updateCanvasObject(selected.id, { rotation: Number(event.target.value) })} /></label>
                  <label>Opacity<input type="range" min={10} max={100} value={selected.opacity} onChange={(event) => updateCanvasObject(selected.id, { opacity: Number(event.target.value) })} /></label>
                  <div className={styles.assetActions}><button type="button" className={styles.secondary} onClick={() => reorderCanvasObject(selected.id, 1)}>Bring forward</button><button type="button" className={styles.secondary} onClick={() => reorderCanvasObject(selected.id, -1)}>Send backward</button><button type="button" className={styles.secondary} onClick={duplicateCanvasObject}>Duplicate</button><button type="button" className={styles.textButton} onClick={deleteCanvasObject}>Delete object</button></div>
                </div>;
              })() : <p className={styles.panelFootnote}>Add text or shapes from the canvas toolbar. Existing dealership artwork layers remain editable below.</p>}
              {canvasObjects.length > 0 && <div className={styles.objectLayerList} aria-label="Object layers">{[...canvasObjects].reverse().map((item) => <button key={item.id} type="button" className={selectedCanvasObjectId === item.id ? styles.objectLayerActive : styles.objectLayer} onClick={() => setSelectedCanvasObjectId(item.id)}>{item.kind === 'text' ? 'T' : item.kind === 'circle' ? '○' : item.kind === 'image' ? '▧' : '▭'} {item.kind === 'text' ? item.text.slice(0, 24) : item.kind === 'image' ? artworkAssets.find((asset) => asset.id === item.assetId)?.name ?? 'Image' : item.kind}</button>)}</div>}
            </section>
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
            <label>Upload JPEG / PNG to asset library<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => void handlePhotoUpload(event)} disabled={assetBusyId !== null || artworkAssets.length >= ARTWORK_ASSET_LIMIT} /></label>
            {photoSource && <button className={styles.textButton} type="button" onClick={() => setPhotoSource(null)}>Remove photo</button>}
            <div className={styles.colors}>
              <label>Background colour<input aria-label="Background colour" type="color" value={primary} onChange={(event) => setPrimary(event.target.value)} /></label>
              <label>Accent colour<input aria-label="Accent colour" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
              <label>Headline colour<input aria-label="Headline colour" type="color" value={headlineColor} onChange={(event) => setHeadlineColor(event.target.value)} /></label>
              <label>Message colour<input aria-label="Message colour" type="color" value={messageColor} onChange={(event) => setMessageColor(event.target.value)} /></label>
            </div>
            {logoSource && <button type="button" className={styles.textButton} onClick={() => { setLogoSource(null); setSelectedLogoAssetId(null); }}>Remove logo image</button>}
            <p className={styles.privacy}>Drafts and your 50-item asset library are stored in this browser. Publishing uploads the rendered JPEG only after you request approval; a Manager or Owner approves before dispatch.</p>
          </aside>
          <main className={styles.previewColumn}>
            <div className={styles.editorToolbar} aria-label="Canvas tools">
              <div><button type="button" onClick={() => addCanvasObject('text')}>＋ Text</button><button type="button" onClick={() => addCanvasObject('rectangle')}>＋ Rectangle</button><button type="button" onClick={() => addCanvasObject('circle')}>＋ Circle</button></div>
              <div><button type="button" onClick={undoCanvasObject} disabled={!canvasUndoRef.current.length}>Undo</button><button type="button" onClick={redoCanvasObject} disabled={!canvasRedoRef.current.length}>Redo</button></div>
            </div>
            <div className={styles.previewBar}><span>LIVE EDITOR · {selectedFormat.channel}</span><small>{selectedFormat.width} × {selectedFormat.height} · drag added objects on canvas</small></div>
            <div className={styles.previewFrame} style={{ aspectRatio: selectedFormat.width + ' / ' + selectedFormat.height }}>
              <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={'Editable canvas for ' + headline} onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onPointerCancel={handleCanvasPointerUp} />
            </div>
            <section className={styles.timelinePanel} aria-label="Story composition timeline">
              <div className={styles.timelineHeading}><div><strong>Story timeline</strong><small>Single artwork scene with a soundtrack · clip length {musicClipDuration}s</small></div><span>{selectedMusicTrack?.name ?? 'No music selected'}</span></div>
              <div className={styles.timelineRuler}><span>00:00</span><span>{Math.round(storyDurationLimit / 4)}s</span><span>{Math.round(storyDurationLimit / 2)}s</span><span>{Math.round(storyDurationLimit * .75)}s</span><span>{storyDurationLimit}s</span></div>
              <div className={styles.timelineTrack}><strong>Scene 01 · Artwork</strong><div className={styles.timelineTrackRail}><span className={styles.timelineSceneBlock}>Current canvas</span></div></div>
              <div className={styles.timelineTrack}><strong>♫ Audio</strong><div className={styles.timelineTrackRail}><span className={styles.timelineAudioBlock} style={{ left: (musicClipStart / Math.max(1, selectedMusicTrack?.durationSeconds ?? storyDurationLimit)) * 100 + '%', width: Math.min(100, (musicClipDuration / Math.max(1, selectedMusicTrack?.durationSeconds ?? storyDurationLimit)) * 100) + '%' }}>{selectedMusicTrack?.name ?? 'Choose music'}</span></div></div>
              <div className={styles.timelineControls}>
                <label>Clip start · {musicClipStart.toFixed(1)}s<input type="range" min={0} max={musicStartLimit} step={0.5} value={Math.min(musicClipStart, musicStartLimit)} onChange={(event) => setMusicClipStart(Number(event.target.value))} disabled={!selectedMusicReady || videoExporting || musicStartLimit <= 0} /></label>
                <label>Clip length · {musicClipDuration}s<input type="range" min={20} max={Math.max(20, Math.min(storyDurationLimit, selectedMusicTrack?.durationSeconds ?? storyDurationLimit))} step={1} value={musicClipDuration} onChange={(event) => setMusicClipDuration(Number(event.target.value))} disabled={!selectedMusicReady || videoExporting} /></label>
              </div>
              <p className={styles.panelFootnote}>The current artwork is rendered for the chosen duration and combined with this audio range when you create the Story video. Direct Story/Status publishing and native music stickers remain in the social apps.</p>
            </section>
            <label className={styles.captionPreview}>Caption preview<textarea readOnly rows={4} value={fullCaption} /></label>

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
      </section>
    </div>
  );
}
