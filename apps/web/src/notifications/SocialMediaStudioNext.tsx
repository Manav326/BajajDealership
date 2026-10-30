import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import SocialWhatsAppWorkspace from './SocialWhatsAppWorkspace';
import { apiFetch } from './apiClient';
import { ARTWORK_TEMPLATES, STARTER_ARTWORK_ASSETS } from './artworkAssets';
import { STARTER_MUSIC_CATALOG } from './artworkMusic';
import {
  chooseWorkspaceDirectory, downloadBlob, getWorkspacePermission, listProjects, listResources, persistHandleName,
  removeProject, removeResource, requestSavedFolderPermission, saveProject, saveResource, supportsLocalDirectoryAccess, useBrowserStorage,
  type StudioElement, type StudioPage, type StudioProject, type StudioResource, type StudioResourceKind,
} from './socialStudioLocalStore';
import styles from './SocialMediaStudioNext.module.css';

type Tool = 'templates' | 'elements' | 'text' | 'publishing' | 'uploads' | 'brand' | 'audio' | 'layers' | 'pages' | 'resize';
type HubPage = 'projects' | 'resources' | 'publish' | 'whatsapp' | 'connections';
type StoryTarget = 'whatsapp-status' | 'instagram-story' | 'facebook-story' | 'social-reel';
type SizePreset = { id: string; label: string; platform: string; width: number; height: number; group: string };

const SIZE_PRESETS: SizePreset[] = [
  { id: 'ig-square', label: 'Square feed', platform: 'Instagram / Facebook', width: 1080, height: 1080, group: 'Instagram' },
  { id: 'ig-portrait-34', label: 'Portrait feed 3:4', platform: 'Instagram', width: 1080, height: 1440, group: 'Instagram' },
  { id: 'ig-portrait-45', label: 'Portrait feed 4:5', platform: 'Instagram / Facebook', width: 1080, height: 1350, group: 'Instagram' },
  { id: 'ig-landscape', label: 'Landscape feed', platform: 'Instagram', width: 1080, height: 566, group: 'Instagram' },
  { id: 'ig-story', label: 'Story / Reel', platform: 'Instagram / Facebook', width: 1080, height: 1920, group: 'Instagram' },
  { id: 'ig-reel-cover', label: 'Reel cover', platform: 'Instagram', width: 420, height: 654, group: 'Instagram' },
  { id: 'fb-page-cover', label: 'Page cover', platform: 'Facebook', width: 851, height: 315, group: 'Facebook' },
  { id: 'fb-profile', label: 'Profile image', platform: 'Facebook', width: 320, height: 320, group: 'Facebook' },
  { id: 'fb-group-cover', label: 'Group cover', platform: 'Facebook', width: 1640, height: 856, group: 'Facebook' },
  { id: 'fb-event-cover', label: 'Event cover', platform: 'Facebook', width: 1920, height: 1005, group: 'Facebook' },
  { id: 'fb-link', label: 'Link preview', platform: 'Facebook / Open Graph', width: 1200, height: 630, group: 'Facebook' },
  { id: 'yt-thumbnail', label: 'Video thumbnail', platform: 'YouTube', width: 3840, height: 2160, group: 'YouTube' },
  { id: 'yt-banner', label: 'Channel banner', platform: 'YouTube', width: 2560, height: 1440, group: 'YouTube' },
  { id: 'yt-profile', label: 'Channel profile', platform: 'YouTube', width: 800, height: 800, group: 'YouTube' },
  { id: 'yt-shorts', label: 'Shorts', platform: 'YouTube', width: 1080, height: 1920, group: 'YouTube' },
  { id: 'x-post', label: 'Post image', platform: 'X', width: 1600, height: 900, group: 'X' },
  { id: 'x-header', label: 'Profile header', platform: 'X', width: 1500, height: 500, group: 'X' },
  { id: 'linkedin-post', label: 'Post image', platform: 'LinkedIn', width: 1200, height: 627, group: 'LinkedIn' },
  { id: 'linkedin-banner', label: 'Company banner', platform: 'LinkedIn', width: 1128, height: 191, group: 'LinkedIn' },
  { id: 'pinterest-pin', label: 'Standard Pin', platform: 'Pinterest', width: 1000, height: 1500, group: 'Pinterest' },
  { id: 'tiktok', label: 'Video / cover', platform: 'TikTok', width: 1080, height: 1920, group: 'TikTok' },
  { id: 'whatsapp-status', label: 'Status', platform: 'WhatsApp', width: 1080, height: 1920, group: 'WhatsApp' },
];

const STARTER_TEMPLATES = ARTWORK_TEMPLATES;
const randomId = () => globalThis.crypto?.randomUUID?.() ?? 'studio-' + Date.now() + '-' + Math.random().toString(16).slice(2);
const defaultPage = (name = 'Page 1', width = 1080, height = 1080): StudioPage => ({
  id: randomId(), name, width, height, durationSeconds: 5, transitionAfter: 'cut', transitionDurationSeconds: 0.5, background: '#15213a', elements: [],
});
const newProject = (): StudioProject => {
  const page = defaultPage();
  return {
    id: randomId(), name: 'Untitled design', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    pages: [page], selectedPageId: page.id, selectedAudioId: null, audioStartSeconds: 0, audioDurationSeconds: 30, audioVolume: 80,
    audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    caption: '', hashtags: '#LuckyBajaj #Bajaj', primaryColor: '#15213a', accentColor: '#f97316',
  };
};
const element = (type: StudioElement['type'], x = 250, y = 240): StudioElement => ({
  id: randomId(), type, name: type === 'text' ? 'Text' : type === 'image' ? 'Image' : type === 'line' ? 'Line' : 'Shape',
  x, y, width: type === 'text' ? 470 : type === 'line' ? 360 : 280, height: type === 'text' ? 120 : type === 'line' ? 8 : 180,
  rotation: 0, opacity: 1, fill: type === 'text' ? '#ffffff' : '#f97316', stroke: 'transparent', strokeWidth: 0,
  text: type === 'text' ? 'Your text here' : '', fontSize: 76, fontFamily: 'Arial', fontWeight: '700',
  italic: false, letterSpacing: 0, align: 'left', imageFit: 'cover', visible: true, locked: false,
});
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const formatBytes = (value: number) => value < 1024 * 1024 ? Math.max(1, Math.round(value / 1024)) + ' KB' : (value / (1024 * 1024)).toFixed(1) + ' MB';
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'lucky-bajaj';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    close: 'M18 6 6 18M6 6l12 12', back: 'm15 18-6-6 6-6', save: 'M5 4h12l3 3v13H4V4h1zm2 0v6h10V4M8 20v-7h8v7',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2', redo: 'm15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2',
    download: 'M12 3v12m-5-5 5 5 5-5M4 18v3h16v-3', image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01',
    audio: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3z',
    template: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    shapes: 'M12 3 21 20H3zM18 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 15h7v6H4z',
    text: 'M4 5h16M12 5v14m-5 0h10', upload: 'M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3',
    brand: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4',
    pages: 'M5 4h11l3 3v13H5zM16 4v4h4M8 12h8M8 16h8',
    resize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', zoom: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12 5 5M11 8v6m-3-3h6',
    folder: 'M3 6h7l2 2h9v11H3z', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    publish: 'M5 12 12 4l7 8M12 4v13M5 20h14', calendar: 'M4 5h16v15H4zM8 3v4m8-4v4M4 10h16',
    link: 'M10 13a5 5 0 0 0 7.07 0l2-2A5 5 0 0 0 12 4l-1 1m3 6a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20l1-1',
    search: 'm20 20-4-4M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', play: 'm7 4 13 8-13 8z',
    trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3', copy: 'M8 8h12v13H8zM4 16V3h12',
    align: 'M4 5h16M4 10h11M4 15h16M4 20h11', lock: 'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    check: 'm5 12 4 4L19 6', 'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.1 4.1M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.6', unlock: 'M6 10h12v11H6zM9 10V7a3 3 0 0 1 5.8-1', expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', group: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm-12 10a8 8 0 0 1 16 0M18 8a3 3 0 0 1 0 6m1 3a6 6 0 0 1 3 2',
    layers: 'm12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
    folderplus: 'M3 6h7l2 2h9v11H3zM12 11v5m-2.5-2.5h5',
    more: 'M5 12h.01M12 12h.01M19 12h.01', video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
    imageplus: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M12 8v4m-2-2h4',
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.grid} /></svg>;
}

function makeElement(type: StudioElement['type'], page: StudioPage): StudioElement {
  const next = element(type, page.width * .18, page.height * .2);
  if (type === 'text') { next.fontSize = Math.max(36, Math.round(page.width * .075)); next.width = page.width * .64; next.height = page.height * .18; }
  if (type === 'image') { next.width = page.width * .55; next.height = page.height * .4; }
  if (type === 'video') { next.width = page.width * .72; next.height = page.height * .42; next.fill = '#101827'; next.startSeconds = 0; next.durationSeconds = page.durationSeconds; next.sourceStartSeconds = 0; }
  if (type === 'line') { next.width = page.width * .5; next.height = 2; }
  return next;
}

function elementSvg(item: StudioElement, url?: string) {
  const common = { opacity: item.opacity, transform: `rotate(${item.rotation} ${item.width / 2} ${item.height / 2})` };
  if (item.type === 'text') {
    return <text x={0} y={item.fontSize} fill={item.fill} textAnchor={item.align === 'left' ? 'start' : item.align === 'center' ? 'middle' : 'end'}
      fontSize={item.fontSize} fontFamily={item.fontFamily} fontWeight={item.fontWeight} fontStyle={item.italic ? 'italic' : 'normal'} letterSpacing={item.letterSpacing ?? 0}
      transform={common.transform} opacity={common.opacity}>
      {item.text.split('\n').slice(0, 8).map((line, index) => <tspan key={index} x={item.align === 'left' ? 0 : item.align === 'center' ? item.width / 2 : item.width} dy={index === 0 ? 0 : item.fontSize * 1.2}>{line}</tspan>)}
    </text>;
  }
  if (item.type === 'image') return url
    ? <image href={url} x={0} y={0} width={item.width} height={item.height} preserveAspectRatio={item.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'} transform={common.transform} opacity={common.opacity} />
    : <rect x={0} y={0} width={item.width} height={item.height} fill="#94a3b8" opacity=".35" />;
  if (item.shapeKind) return <polygon points={shapePoints(item.shapeKind,item.width,item.height)} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} transform={common.transform} opacity={common.opacity}/>;
  if (item.type === 'video') return <g transform={common.transform} opacity={common.opacity}><rect x={0} y={0} width={item.width} height={item.height} rx={12} fill="#101827" stroke="#93a4ba" strokeWidth={3}/><path d={`M ${item.width*.44} ${item.height*.3} L ${item.width*.68} ${item.height*.5} L ${item.width*.44} ${item.height*.7} Z`} fill="#fff"/><text x={item.width/2} y={item.height*.88} fill="#fff" fontSize={Math.max(12,item.height*.07)} textAnchor="middle">VIDEO CLIP</text></g>;
  if (item.type === 'circle') return <ellipse cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} transform={common.transform} opacity={common.opacity} />;
  if (item.type === 'line') return <line x1={0} y1={item.height / 2} x2={item.width} y2={item.height / 2} stroke={item.fill} strokeWidth={Math.max(2, item.strokeWidth || item.height)} transform={common.transform} opacity={common.opacity} />;
  return <rect x={0} y={0} width={item.width} height={item.height} rx={12} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} transform={common.transform} opacity={common.opacity} />;
}

function makeSvg(page: StudioPage, resourceUrls: Record<string, string>, includeGuides = false, includeVideoPlaceholders = true): string {
  const content = page.elements.filter((item) => item.visible).map((item) => {
    const url = item.resourceId ? resourceUrls[item.resourceId] : undefined;
    let shape = '';
    if (item.type === 'text') {
      const lines = item.text.split('\n').slice(0, 8);
      shape = '<text x="0" y="' + item.fontSize + '" fill="' + item.fill + '" font-family="' + item.fontFamily + '" font-size="' + item.fontSize + '" letter-spacing="' + (item.letterSpacing ?? 0) + '" font-weight="' + item.fontWeight + '" font-style="' + (item.italic ? 'italic' : 'normal') + '" text-anchor="' + (item.align === 'left' ? 'start' : item.align === 'center' ? 'middle' : 'end') + '">' + lines.map((line, i) => '<tspan x="' + (item.align === 'left' ? 0 : item.align === 'center' ? item.width / 2 : item.width) + '" dy="' + (i ? item.fontSize * 1.2 : 0) + '">' + escapeSvg(line) + '</tspan>').join('') + '</text>';
    } else if (item.type === 'image' && url) shape = '<image href="' + url + '" width="' + item.width + '" height="' + item.height + '" preserveAspectRatio="' + (item.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice') + '"/>';
    else if (item.type === 'video' && includeVideoPlaceholders) shape = '<rect width="' + item.width + '" height="' + item.height + '" rx="12" fill="#101827" stroke="#93a4ba" stroke-width="3"/><path d="M ' + item.width*.44 + ' ' + item.height*.3 + ' L ' + item.width*.68 + ' ' + item.height*.5 + ' L ' + item.width*.44 + ' ' + item.height*.7 + ' Z" fill="#fff"/><text x="' + item.width/2 + '" y="' + item.height*.88 + '" text-anchor="middle" fill="#fff" font-size="' + Math.max(12,item.height*.07) + '">VIDEO CLIP</text>';
    else if (item.shapeKind) shape = '<polygon points="' + shapePoints(item.shapeKind,item.width,item.height) + '" fill="' + item.fill + '" stroke="' + item.stroke + '" stroke-width="' + item.strokeWidth + '"/>';
    else if (item.type === 'circle') shape = '<ellipse cx="' + item.width / 2 + '" cy="' + item.height / 2 + '" rx="' + item.width / 2 + '" ry="' + item.height / 2 + '" fill="' + item.fill + '"/>';
    else if (item.type === 'line') shape = '<line x1="0" y1="' + item.height / 2 + '" x2="' + item.width + '" y2="' + item.height / 2 + '" stroke="' + item.fill + '" stroke-width="' + Math.max(2, item.strokeWidth || item.height) + '"/>';
    else shape = '<rect width="' + item.width + '" height="' + item.height + '" rx="12" fill="' + item.fill + '" stroke="' + item.stroke + '" stroke-width="' + item.strokeWidth + '"/>';
    return '<g transform="translate(' + item.x + ' ' + item.y + ') rotate(' + item.rotation + ' ' + item.width / 2 + ' ' + item.height / 2 + ')" opacity="' + item.opacity + '">' + shape + '</g>';
  }).join('');
  const guides = includeGuides ? '<rect x="0" y="0" width="' + page.width + '" height="' + page.height + '" fill="none" stroke="#94a3b8" stroke-dasharray="12 8"/>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + page.width + '" height="' + page.height + '" viewBox="0 0 ' + page.width + ' ' + page.height + '"><rect width="100%" height="100%" fill="' + page.background + '"/>' + content + guides + '</svg>';
}
function formatTime(seconds: number): string { const v = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)); return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); }
function escapeSvg(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char)); }
function shapePoints(kind: NonNullable<StudioElement['shapeKind']>, width: number, height: number): string {
  if (kind === 'triangle') return `${width/2},0 ${width},${height} 0,${height}`;
  if (kind === 'arrow') return `0,${height*.3} ${width*.62},${height*.3} ${width*.62},0 ${width},${height/2} ${width*.62},${height} ${width*.62},${height*.7} 0,${height*.7}`;
  const spikes = kind === 'star' ? 5 : 12;
  return Array.from({length:spikes*2},(_,index)=>{
    const angle=-Math.PI/2+index*Math.PI/spikes;
    const radius=index%2===0?.48:kind==='star'?.21:.34;
    return `${width/2+Math.cos(angle)*width*radius},${height/2+Math.sin(angle)*height*radius}`;
  }).join(' ');
}


async function convertImageBlob(blob: Blob, mimeType: 'image/jpeg'): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot convert the rendered image format.');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (output) => output ? resolve(output) : reject(new Error('The rendered image could not be converted.')),
      mimeType,
      0.94,
    ));
  } finally { bitmap.close(); }
}

async function decodeVideoFrame(sourceUrl: string, requestedTime: number): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      let timeout = 0;
      const cleanup = () => {
        if (timeout) window.clearTimeout(timeout);
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };
      const onError = () => { cleanup(); reject(new Error('A video clip could not be decoded. Use a browser-supported MP4 or WebM file.')); };
      const onLoaded = () => {
        cleanup();
        if (Number.isFinite(video.duration) && requestedTime >= video.duration) {
          reject(new Error('A video clip source in-point is beyond the end of its media.'));
          return;
        }
        if (requestedTime <= 0.01) { resolve(); return; }
        const onSeeked = () => { if (timeout) window.clearTimeout(timeout); video.removeEventListener('error', onSeekError); resolve(); };
        const onSeekError = () => { if (timeout) window.clearTimeout(timeout); video.removeEventListener('seeked', onSeeked); reject(new Error('A video clip frame could not be seeked for the photo render.')); };
        timeout = window.setTimeout(onSeekError, 10000);
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onSeekError, { once: true });
        try { video.currentTime = requestedTime; } catch { onSeekError(); }
      };
      timeout = window.setTimeout(() => { cleanup(); reject(new Error('A video clip could not be decoded in time.')); }, 15000);
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.src = sourceUrl; video.load();
    });
    return video;
  } catch (cause) {
    video.pause(); video.removeAttribute('src'); video.load(); throw cause;
  }
}

async function renderPageBlob(page: StudioPage, urls: Record<string, string>, mimeType: 'image/png' | 'image/jpeg' = 'image/png', sceneTime = 0): Promise<Blob> {
  const svg = new Blob([makeSvg(page, urls, false, false)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svg);
  const decodedVideos: HTMLVideoElement[] = [];
  try {
    const image = new Image();
    image.decoding = 'sync';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable in this browser.');
    context.fillStyle = page.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const clip of page.elements.filter(item => item.type === 'video' && item.visible)) {
      const clipStart = clip.startSeconds ?? 0;
      const clipDuration = clip.durationSeconds ?? page.durationSeconds;
      if (sceneTime < clipStart || sceneTime >= clipStart + clipDuration) continue;
      const sourceUrl = clip.resourceId ? urls[clip.resourceId] : undefined;
      if (!sourceUrl) throw new Error('The video media for "' + clip.name + '" is not available in the resource library.');
      const sourceTime = Math.max(0, (clip.sourceStartSeconds ?? 0) + sceneTime - clipStart);
      const video = await decodeVideoFrame(sourceUrl, sourceTime);
      decodedVideos.push(video);
      context.save();
      context.translate(clip.x + clip.width / 2, clip.y + clip.height / 2);
      context.rotate(clip.rotation * Math.PI / 180);
      context.globalAlpha = clip.opacity;
      context.drawImage(video, -clip.width / 2, -clip.height / 2, clip.width, clip.height);
      context.restore();
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The design could not be exported.')), mimeType, .94));
  } finally {
    decodedVideos.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    URL.revokeObjectURL(url);
  }
}

function pageFromTemplate(templateId: string): StudioPage | null {
  const template = STARTER_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return null;
  const page = defaultPage(template.name, template.formatId === 'instagram-portrait' ? 1080 : 1080, template.formatId === 'instagram-portrait' ? 1350 : 1080);
  page.background = template.primary;
  page.elements = [
    { ...makeElement('text', page), name: 'Headline', text: template.headline, x: page.width * .08, y: page.height * .22, width: page.width * .82, height: page.height * .2, fontSize: page.width * .065, fill: '#ffffff' },
    { ...makeElement('text', page), name: 'Message', text: template.message, x: page.width * .08, y: page.height * .47, width: page.width * .78, height: page.height * .18, fontSize: page.width * .027, fontWeight: '400', fill: '#e5edf6' },
    { ...makeElement('rect', page), name: 'Call to action', x: page.width * .08, y: page.height * .82, width: page.width * .62, height: page.height * .09, fill: template.accent },
    { ...makeElement('text', page), name: 'CTA text', text: template.callToAction, x: page.width * .11, y: page.height * .84, width: page.width * .56, height: page.height * .08, fontSize: page.width * .026, fill: '#ffffff' },
  ];
  return page;
}

export default function SocialMediaStudioNext({ canManage = false, canPublish = false, canReadWhatsapp = false, canManageWhatsapp = false, canSendWhatsapp = false }: {
  canManage?: boolean; canPublish?: boolean; canReadWhatsapp?: boolean; canManageWhatsapp?: boolean; canSendWhatsapp?: boolean;
}) {
  const [hubPage, setHubPage] = useState<HubPage>('projects');
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [resources, setResources] = useState<StudioResource[]>([]);
  const [resourceUrls, setResourceUrls] = useState<Record<string, string>>({});
  const [directoryName, setDirectoryName] = useState('');
  const [permission, setPermission] = useState<PermissionState | 'missing'>('missing');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | StudioResourceKind>('all');
  const [toast, setToast] = useState('');
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [publishRequests, setPublishRequests] = useState<PublishRequest[]>([]);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [publishPreviews, setPublishPreviews] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const [savedProjects, savedResources, localPermission, root] = await Promise.all([
      listProjects(), listResources(), getWorkspacePermission(), getWorkspaceDirectoryName(),
    ]);
    setProjects(savedProjects);
    setResources(savedResources);
    setPermission(localPermission);
    setDirectoryName(root ?? '');
    const nextUrls: Record<string, string> = {};
    savedResources.forEach((resource) => { nextUrls[resource.id] = URL.createObjectURL(resource.blob); });
    setResourceUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return nextUrls;
    });
  }, []);

  useEffect(() => { void refreshLibrary().catch((cause) => notify(cause instanceof Error ? cause.message : 'Local library could not load.')); }, [refreshLibrary, notify]);
  useEffect(() => () => Object.values(resourceUrls).forEach((url) => URL.revokeObjectURL(url)), [resourceUrls]);
  useEffect(() => {
    if (hubPage !== 'connections' && hubPage !== 'publish') return;
    void loadMetaData();
  }, [hubPage]);

  async function loadMetaData() {
    try {
      const [statusResponse, queueResponse] = await Promise.all([
        apiFetch('/api/v1/admin/social/meta/status', { cache: 'no-store' }),
        apiFetch('/api/v1/admin/social/meta/publish-requests?limit=50', { cache: 'no-store' }),
      ]);
      const status = await statusResponse.json() as MetaStatus;
      const queue = await queueResponse.json();
      if (!statusResponse.ok) throw new Error('Meta connection status could not be loaded.');
      if (!queueResponse.ok) throw new Error('Publishing history could not be loaded.');
      setMetaStatus(status);
      setPublishRequests(Array.isArray(queue) ? queue as PublishRequest[] : []);
      if (!destinationId) setDestinationId(status.destinations.find((item) => item.status === 'ACTIVE')?.publicId ?? '');
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Meta status is unavailable.'); }
  }

  async function openDirectoryPicker() {
    setPermissionBusy(true);
    try {
      if (!supportsLocalDirectoryAccess()) { await useBrowserStorage(); setDirectoryName('Browser storage'); setPermission('granted'); notify('Browser-local storage is ready.'); return; }
      const name = await chooseWorkspaceDirectory();
      setDirectoryName(name);
      setPermission('granted');
      notify('Local resource folder connected.');
      await refreshLibrary();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Folder access was not granted.'); }
    finally { setPermissionBusy(false); }
  }

  async function reauthorizeDirectory() {
    setPermissionBusy(true);
    try {
      const result = await requestSavedFolderPermission();
      setPermission(result);
      if (result === 'granted') { notify('Local folder access restored.'); await refreshLibrary(); }
      else notify('Please choose the resource folder again.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Folder access could not be restored.'); }
    finally { setPermissionBusy(false); }
  }

  function createBlankProject() {
    const project = newProject();
    setActiveProject(project);
    setEditorOpen(true);
  }
  async function editProject(project: StudioProject) {
    setActiveProject(clone(project));
    setEditorOpen(true);
  }
  async function uploadResources(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    for (const file of selected) {
      const kind: StudioResourceKind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'export';
      try { await saveResource(file, file.name, kind); }
      catch (cause) { notify(cause instanceof Error ? cause.message : 'Resource could not be saved.'); }
    }
    await refreshLibrary();
  }
  async function deleteResource(resource: StudioResource) {
    const references = projects.filter((item) => item.pages.some((savedPage) => savedPage.elements.some((element) => element.resourceId === resource.id)));
    if (references.length) { notify('This resource is used by: ' + references.map((item) => item.name).join(', ')); return; }
    if (!window.confirm('Remove this resource from the studio library?')) return;
    await removeResource(resource.id);
    if (selectedResourceId === resource.id) setSelectedResourceId(null);
    await refreshLibrary();
  }

  async function getProjectJpeg(project: StudioProject): Promise<Blob> {
    const page = project.pages.find((item) => item.id === project.selectedPageId) ?? project.pages[0];
    if (!page) throw new Error('The design has no page to publish.');
    return renderPageBlob(page, resourceUrls, 'image/jpeg');
  }

  async function submitForApproval(project: StudioProject) {
    if (!canPublish) { notify('Your role does not have social publishing permission.'); return; }
    if (!metaStatus?.publishingReady || !destinationId) { notify('Connect and configure a Meta destination first.'); return; }
    setPublishBusy(true);
    setPublishError('');
    try {
      const jpeg = await getProjectJpeg(project);
      const form = new FormData();
      form.append('file', jpeg, slug(project.name) + '.jpg');
      const uploadResponse = await apiFetch('/api/v1/admin/social/media', { method: 'POST', body: form });
      const uploadPayload = await uploadResponse.json() as { assetId?: string; message?: string; detail?: string };
      if (!uploadResponse.ok || !uploadPayload.assetId) throw new Error(uploadPayload.message ?? uploadPayload.detail ?? 'Artwork upload failed.');
      const requestResponse = await apiFetch('/api/v1/admin/social/meta/publish-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationPublicId: destinationId, assetId: uploadPayload.assetId,
          caption: [project.caption, project.hashtags].filter(Boolean).join('\n\n'),
          idempotencyKey: randomId(), scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
        }),
      });
      const result = await requestResponse.json() as PublishRequest & { message?: string; detail?: string };
      if (!requestResponse.ok) throw new Error(result.message ?? result.detail ?? 'Publish request could not be created.');
      setPublishRequests((items) => [result, ...items.filter((item) => item.publicId !== result.publicId)]);
      setScheduleAt('');
      notify('Approval request created.');
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Publishing request failed.'); }
    finally { setPublishBusy(false); }
  }

  async function loadPrivatePreview(item: PublishRequest) {
    setPreviewLoading(item.publicId);
    try {
      const response = await apiFetch('/api/v1/admin/social/media/' + item.assetPublicId + '/preview', { cache: 'no-store' });
      if (!response.ok) throw new Error('Private artwork preview could not be loaded.');
      const url = URL.createObjectURL(await response.blob());
      setPublishPreviews((old) => { const prior = old[item.publicId]; if (prior) URL.revokeObjectURL(prior); return { ...old, [item.publicId]: url }; });
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Preview failed.'); }
    finally { setPreviewLoading(null); }
  }

  async function decidePublish(item: PublishRequest, decision: 'approve' | 'reject' | 'cancel') {
    setPublishBusy(true);
    try {
      const response = await apiFetch('/api/v1/admin/social/meta/publish-requests/' + item.publicId + '/' + decision, { method: 'POST' });
      const result = await response.json() as PublishRequest & { message?: string; detail?: string };
      if (!response.ok) throw new Error(result.message ?? result.detail ?? 'Publishing decision failed.');
      setPublishRequests((items) => [result, ...items.filter((entry) => entry.publicId !== result.publicId)]);
      notify('Publishing queue updated.');
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Action failed.'); }
    finally { setPublishBusy(false); }
  }

  async function connectMeta() {
    setPublishBusy(true);
    try {
      const response = await apiFetch('/api/v1/admin/social/meta/connect', { method: 'POST' });
      const payload = await response.json() as { authorizationUrl?: string; message?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message ?? 'Meta connection could not start.');
      window.location.assign(payload.authorizationUrl);
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Meta connection failed.'); setPublishBusy(false); }
  }
  async function disconnectMeta() {
    if (!window.confirm('Disconnect Meta accounts for this dealership?')) return;
    setPublishBusy(true);
    try {
      const response = await apiFetch('/api/v1/admin/social/meta/disconnect', { method: 'POST' });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? 'Meta disconnect failed.');
      notify(payload.message ?? 'Meta accounts disconnected.');
      await loadMetaData();
    } catch (cause) { setPublishError(cause instanceof Error ? cause.message : 'Meta disconnect failed.'); }
    finally { setPublishBusy(false); }
  }

  const filteredResources = useMemo(() => resources.filter((resource) =>
    (kindFilter === 'all' || resource.kind === kindFilter)
      && (resource.name + ' ' + resource.kind).toLowerCase().includes(search.toLowerCase())), [resources, kindFilter, search]);

  return <div className={styles.root}>
    <header className={styles.hubHeader}>
      <div className={styles.hubBrand}><span className={styles.brandMark}>LB</span><strong>Creative Library</strong></div>
      <nav className={styles.hubNav} aria-label="Creative workspace">
        {([
          ['projects', 'Projects', 'grid'], ['resources', 'Resources', 'folder'], ['publish', 'Publishing', 'publish'],
          ...(canReadWhatsapp || canManageWhatsapp || canSendWhatsapp ? [['whatsapp', 'WhatsApp', 'audio'] as [HubPage, string, string]] : []), ['connections', 'Connections', 'link'],
        ] as Array<[HubPage, string, string]>).map(([id, label, icon]) => <button key={id} type="button" title={label} aria-label={label}
          className={hubPage === id ? styles.hubNavActive : styles.hubNavButton} onClick={() => setHubPage(id)}><Icon name={icon}/><span>{label}</span></button>)}
      </nav>
      <div className={styles.hubActions}>
        <button type="button" title="Choose local resource folder" aria-label="Choose local resource folder" onClick={() => void openDirectoryPicker()} disabled={permissionBusy}><Icon name="folderplus"/></button>
        <button type="button" title="Upload resources" aria-label="Upload resources" onClick={() => fileInputRef.current?.click()}><Icon name="upload"/></button>
        <button type="button" className={styles.createButton} onClick={createBlankProject}><Icon name="plus"/> Create</button>
      </div>
    </header>
    <input ref={fileInputRef} type="file" multiple accept="image/*,audio/*,video/*" hidden onChange={(event) => void uploadResources(event)}/>
    {permission !== 'granted' && <div className={styles.permissionStrip}>
      <Icon name="folderplus"/>
      <span>{directoryName ? 'Local folder access needs approval' : 'Choose a local folder for editable projects and media'}</span>
      {permission === 'prompt' ? <button type="button" onClick={() => void reauthorizeDirectory()} disabled={permissionBusy}>Grant access</button>
        : <button type="button" onClick={() => void openDirectoryPicker()} disabled={permissionBusy}>{supportsLocalDirectoryAccess() ? 'Choose folder' : 'Use browser storage'}</button>}
    </div>}
    <main className={styles.hubBody}>
      {hubPage === 'projects' && <>
        <div className={styles.sectionTop}><div><h1>Projects</h1><span>{projects.length} designs</span></div><button type="button" onClick={createBlankProject}><Icon name="plus"/> New design</button></div>
        {projects.length ? <div className={styles.projectGrid}>{projects.map((project) => <article className={styles.projectCard} key={project.id}>
          <button type="button" className={styles.projectPreview} onClick={() => void editProject(project)} aria-label={'Open ' + project.name}>
            <div style={{ background: project.pages[0]?.background ?? '#15213a', aspectRatio: (project.pages[0]?.width ?? 1) + '/' + (project.pages[0]?.height ?? 1) }}>
              <span>{project.pages[0]?.name ?? 'Page'}</span>
            </div>
          </button>
          <div className={styles.projectMeta}><strong>{project.name}</strong><span>{project.pages.length} pages · {new Date(project.updatedAt).toLocaleDateString('en-IN')}</span></div>
          <div className={styles.cardActions}><button type="button" title="Edit" aria-label={'Edit ' + project.name} onClick={() => void editProject(project)}><Icon name="text"/></button>
            <button type="button" title="Publish" aria-label={'Publish ' + project.name} onClick={() => { setActiveProject(project); setHubPage('publish'); }}><Icon name="publish"/></button>
            <button type="button" title="Delete" aria-label={'Delete ' + project.name} onClick={() => { if (window.confirm('Delete this project?')) void removeProject(project.id).then(refreshLibrary); }}><Icon name="trash"/></button></div>
        </article>)}</div> : <div className={styles.emptyState}><Icon name="template"/><button type="button" onClick={createBlankProject}>Create your first design</button></div>}
      </>}
      {hubPage === 'resources' && <>
        <div className={styles.sectionTop}><div><h1>Resources</h1><span>{resources.length} files</span></div><button type="button" onClick={() => fileInputRef.current?.click()}><Icon name="upload"/> Import</button></div>
        <div className={styles.resourceFilters}><label><Icon name="search"/><input aria-label="Search resources" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search"/></label>
          <select aria-label="Resource type" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">All</option><option value="image">Images</option><option value="audio">Audio</option><option value="video">Video</option><option value="export">Exports</option></select></div>
        <div className={styles.resourceGrid}>{filteredResources.map((resource) => <article key={resource.id} className={styles.resourceCard} data-testid="studio-resource-card">
          <div className={styles.resourcePreview}>{resource.kind === 'image' || resource.kind === 'export' ? <img src={resourceUrls[resource.id]} alt={resource.name}/> : resource.kind === 'video' && resourceUrls[resource.id] ? <video src={resourceUrls[resource.id]} controls preload="metadata" aria-label={'Preview ' + resource.name}/> : <Icon name={resource.kind === 'audio' ? 'audio' : 'video'}/>}</div>
          <div className={styles.projectMeta}><strong>{resource.name}</strong><span>{resource.kind} · {formatBytes(resource.size)}</span></div>
          <div className={styles.cardActions}><button type="button" aria-label={'Download ' + resource.name} title="Download" onClick={() => downloadBlob(resource.blob, resource.name)}><Icon name="download"/></button>
            <button type="button" aria-label={'Delete ' + resource.name} title="Remove" onClick={() => void deleteResource(resource)}><Icon name="trash"/></button></div>
        </article>)}</div>
      </>}
      {hubPage === 'connections' && <section className={styles.operationPanel}>
        <div className={styles.sectionTop}><h1>Connections</h1><button type="button" onClick={() => void loadMetaData()}><Icon name="undo"/></button></div>
        <div className={styles.connectionCard}><div className={styles.connectionHeader}><strong>Facebook / Instagram</strong><span>{metaStatus?.configured ? 'Connected' : 'Not configured'}</span></div>
          {metaStatus?.destinations?.map((item) => <div className={styles.destinationRow} key={item.publicId}><span>{item.type === 'FACEBOOK_PAGE' ? 'f' : '◎'}</span><strong>{item.displayName}</strong><small>{item.status}</small></div>)}
          {!!metaStatus?.missingConfigurationKeys?.length && <small className={styles.missingKeys}>Missing settings: {metaStatus.missingConfigurationKeys.join(', ')}</small>}
          {!!metaStatus?.missingPublishingConfigurationKeys?.length && <small className={styles.missingKeys}>Publishing settings: {metaStatus.missingPublishingConfigurationKeys.join(', ')}</small>}
          <div className={styles.cardActions}>{canManage && <button type="button" onClick={() => void connectMeta()} disabled={publishBusy}><Icon name="link"/> Connect</button>}
            {canManage && <button type="button" onClick={() => void disconnectMeta()} disabled={publishBusy}><Icon name="close"/> Disconnect</button>}</div>
        </div>
      </section>}
      {hubPage === 'publish' && <section className={styles.operationPanel}>
        <div className={styles.sectionTop}><div><h1>Publishing</h1><span>Facebook Page and Instagram feed</span></div><button type="button" onClick={() => void loadMetaData()}><Icon name="undo"/></button></div>
        <div className={styles.publishComposer}>
          <select aria-label="Publishing design" value={activeProject?.id ?? ''} onChange={(event) => setActiveProject(projects.find((item) => item.id === event.target.value) ?? null)}>
            <option value="">Choose a saved design</option>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          <select aria-label="Publishing destination" value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
            <option value="">Choose destination</option>{metaStatus?.destinations.filter((item) => item.status === 'ACTIVE').map((item) => <option value={item.publicId} key={item.publicId}>{item.displayName}</option>)}
          </select>
          <input aria-label="Schedule publishing" type="datetime-local" value={scheduleAt} min={new Date(Date.now() + 120000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(event) => setScheduleAt(event.target.value)}/>
          <button type="button" className={styles.primaryAction} disabled={!activeProject || !canPublish || !metaStatus?.publishingReady || !destinationId || publishBusy} onClick={() => activeProject && void submitForApproval(activeProject)}>Request approval</button>
        </div>
        {publishError && <p role="alert" className={styles.inlineError}>{publishError}</p>}
        <div className={styles.queueList}>{publishRequests.map((item) => <article key={item.publicId} className={styles.queueCard}>
          <div className={styles.queueTop}><strong>{item.destinationName}</strong><span>{item.publishStatus || item.status}</span></div>
          <p>{item.caption}</p><small>{item.requestedAt ? new Date(item.requestedAt).toLocaleString() : ''}{item.scheduledAt ? ' · ' + new Date(item.scheduledAt).toLocaleString() : ''}</small>
          <div className={styles.cardActions}><button type="button" onClick={() => void loadPrivatePreview(item)} disabled={previewLoading === item.publicId}><Icon name="image"/> Preview</button>
            {canManage && item.status === 'PENDING_APPROVAL' && <><button type="button" disabled={!publishPreviews[item.publicId] || publishBusy} onClick={() => void decidePublish(item, 'approve')}>Approve</button><button type="button" disabled={publishBusy} onClick={() => void decidePublish(item, 'reject')}>Reject</button></>}
            {canManage && item.status === 'SCHEDULED' && <button type="button" disabled={publishBusy} onClick={() => void decidePublish(item, 'cancel')}>Cancel</button>}</div>
          {publishPreviews[item.publicId] && <img className={styles.queuePreview} src={publishPreviews[item.publicId]} alt="Submitted artwork preview"/>}
        </article>)}</div>
      </section>}
      {(canReadWhatsapp || canManageWhatsapp || canSendWhatsapp) && <section className={styles.whatsappHost} style={{ display: hubPage === 'whatsapp' ? 'block' : 'none' }} aria-hidden={hubPage !== 'whatsapp'}>
        <div className={styles.whatsappResourcePicker}><Icon name="image"/><select aria-label="WhatsApp artwork design" value={activeProject?.id ?? ''} onChange={(event) => setActiveProject(projects.find((item) => item.id === event.target.value) ?? null)}><option value="">Choose artwork for image templates</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <SocialWhatsAppWorkspace canRead={canReadWhatsapp} canManage={canManageWhatsapp} canSend={canSendWhatsapp}
          getArtworkJpeg={async () => {
            if (!activeProject) throw new Error('Open a saved design from Projects first.');
            return getProjectJpeg(activeProject);
          }}/>
      </section>}
    </main>
    {toast && <div className={styles.toast} role="status">{toast}</div>}
    {editorOpen && activeProject && <StudioEditor project={activeProject} resources={resources} urls={resourceUrls}
      onProjectChange={setActiveProject} onResourceAdded={async (resource) => { await refreshLibrary(); return resource; }}
      onNotify={notify} onOpenLibrary={() => { setActiveProject(null); setEditorOpen(false); setHubPage('resources'); void refreshLibrary(); }}/>}
  </div>;
}

type MetaStatus = { configured: boolean; publishingReady: boolean; code: string; message: string; missingConfigurationKeys: string[]; missingPublishingConfigurationKeys: string[]; destinations: Array<{ publicId: string; type: string; displayName: string; username: string | null; status: string }> };
type PublishRequest = { publicId: string; assetPublicId: string; status: string; destinationType: string; destinationName: string; caption: string; requestedBy: string; approvedBy: string | null; requestedAt: string; scheduledAt: string | null; approvedAt: string | null; publishStatus: string; externalPostId: string | null; errorCode: string | null };

function StudioEditor({ project, resources, urls, onProjectChange, onResourceAdded, onNotify, onOpenLibrary }: {
  project: StudioProject; resources: StudioResource[]; urls: Record<string, string>;
  onProjectChange: (project: StudioProject) => void;
  onResourceAdded: (resource: StudioResource) => Promise<unknown>; onNotify: (message: string) => void; onOpenLibrary: () => void;
}) {
  const [tool, setTool] = useState<Tool | null>('templates');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(80);
  const [showGuides, setShowGuides] = useState(true);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [customWidth, setCustomWidth] = useState('1080');
  const [customHeight, setCustomHeight] = useState('1080');
  const [selectedAudio, setSelectedAudio] = useState(project.selectedAudioId ?? '');
  const [favoriteMusicIds, setFavoriteMusicIds] = useState<string[]>(() => { try { return JSON.parse(window.localStorage.getItem('lucky-bajaj-studio-music-favourites') ?? '[]') as string[]; } catch { return []; } });
  const [storyTarget, setStoryTarget] = useState<StoryTarget>('whatsapp-status');
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [panelSearch, setPanelSearch] = useState('');
  const [, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
  const [lastSavedName, setLastSavedName] = useState(project.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderedPhoto, setRenderedPhoto] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [renderedVideo, setRenderedVideo] = useState<{ blob: Blob; url: string; name: string; duration: number } | null>(null);
  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [brandAssetPickerOpen, setBrandAssetPickerOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<'photo' | 'video' | 'both'>('photo');
  const [downloadPhotoFormat, setDownloadPhotoFormat] = useState<'png' | 'jpg'>('png');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [audioTrackDuration, setAudioTrackDuration] = useState(125);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioPreviewTime, setAudioPreviewTime] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelinePreviewVisible, setTimelinePreviewVisible] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const [renderStage, setRenderStage] = useState<'idle'|'preparing'|'rendering'|'saving'|'ready'|'failed'|'cancelled'>('idle');
  const [canCancelRender, setCanCancelRender] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineFramesRef = useRef<Record<string, HTMLImageElement>>({});
  const videoElementsRef = useRef<Record<string, HTMLVideoElement>>({});
  const timelineTimeRef = useRef(0);
  const timelineClipTrackRef = useRef<HTMLDivElement | null>(null);
  const timelineClipDragRef = useRef<{clipId:string;pageId:string;pointerId:number;pointerX:number;trackWidth:number;startSeconds:number;durationSeconds:number;sourceStartSeconds:number;previewStartSeconds:number;previewDurationSeconds:number;previewSourceStartSeconds:number;sceneDuration:number;mode:'move'|'start'|'end';changed:boolean}|null>(null);
  const [timelineClipPreview,setTimelineClipPreview] = useState<{clipId:string;startSeconds:number;durationSeconds:number}|null>(null);
  const audioRangeTrackRef = useRef<HTMLDivElement | null>(null);
  const audioRangeDragRef = useRef<{mode:'start'|'end'|'move';pointerX:number;start:number;duration:number}|null>(null);
  const cancelRenderRef = useRef<(()=>void)|null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize' | 'rotate'; ids: string[]; start: { x: number; y: number }; items: StudioElement[]; handle?: string; center?: { x: number; y: number } } | null>(null);
  const undoRef = useRef<StudioProject[]>([]);
  const redoRef = useRef<StudioProject[]>([]);
  const saveTimer = useRef<number | null>(null);
  const editVersionRef = useRef(0);
  const saveInFlightRef = useRef(0);
  const page = project.pages.find((item) => item.id === project.selectedPageId) ?? project.pages[0];
  const totalSceneDuration = project.pages.reduce((sum, item) => sum + item.durationSeconds, 0);
  const audioClipLength = Math.max(.1,Math.min(project.audioDurationSeconds??30,Math.max(.1,audioTrackDuration-project.audioStartSeconds),Math.max(.1,totalSceneDuration)));
  const changeProject = (next:StudioProject) => {
    if(timelinePlaying){setTimelinePlaying(false);audioPlayerRef.current?.pause();}
    setTimelinePreviewVisible(false);timelineTimeRef.current=0;setTimelineTime(0);Object.values(videoElementsRef.current).forEach(video=>video.pause());
    if(renderedPhoto?.url)URL.revokeObjectURL(renderedPhoto.url);if(renderedVideo?.url)URL.revokeObjectURL(renderedVideo.url);
    setRenderedPhoto(null);setRenderedVideo(null);setPhotoPreviewOpen(false);setVideoPreviewOpen(false);setDownloadOpen(false);setRenderStage('idle');setRenderProgress(0);
    editVersionRef.current += 1;
    setSaveStatus('unsaved');
    onProjectChange(next);setDirty(true);
  };
  function beginSave() { saveInFlightRef.current += 1; setSaving(true); setSaveStatus('saving'); }
  function endSave() { saveInFlightRef.current = Math.max(0, saveInFlightRef.current - 1); setSaving(saveInFlightRef.current > 0); }
  const selected = page.elements.filter((item) => selectedIds.includes(item.id));
  const one = selected.length === 1 ? selected[0] : null;
  const selectedAudioResource = resources.find((item) => item.id === selectedAudio && item.kind === 'audio');
  useEffect(()=>{try{window.localStorage.setItem('lucky-bajaj-studio-music-favourites',JSON.stringify(favoriteMusicIds));}catch{/* Session-only favourites remain usable. */}},[favoriteMusicIds]);
  useEffect(()=>{let cancelled=false;const objectUrls:string[]=[];const nextVideos:Record<string,HTMLVideoElement>={};const load=async()=>{const entries=await Promise.all(project.pages.map(async item=>{const src=URL.createObjectURL(new Blob([makeSvg(item,urls,false,false)],{type:'image/svg+xml;charset=utf-8'}));objectUrls.push(src);const image=new Image();image.src=src;await image.decode();return [item.id,image] as const;}));project.pages.forEach(scene=>scene.elements.filter(element=>element.type==='video'&&element.resourceId&&urls[element.resourceId]).forEach(element=>{const video=document.createElement('video');video.src=urls[element.resourceId!];video.preload='auto';video.muted=true;video.playsInline=true;nextVideos[element.id]=video;video.load();video.addEventListener('loadedmetadata',()=>{
      if(!Number.isFinite(video.duration)||video.duration<=0)return;
      const owner=project.pages.find(candidate=>candidate.elements.some(candidateClip=>candidateClip.id===element.id));
      const sourceClip=owner?.elements.find(candidateClip=>candidateClip.id===element.id);
      if(!owner||!sourceClip)return;
      const clipStart=Math.max(0,Math.min(owner.durationSeconds-.1,sourceClip.startSeconds??0));
      const sourceStart=Math.max(0,Math.min(sourceClip.sourceStartSeconds??0,Math.max(0,video.duration-.1)));
      const safeDuration=Math.max(.1,Math.min(sourceClip.durationSeconds??owner.durationSeconds,owner.durationSeconds-clipStart,video.duration-sourceStart));
      if(Math.abs(clipStart-(sourceClip.startSeconds??0))<.01&&Math.abs(sourceStart-(sourceClip.sourceStartSeconds??0))<.01&&Math.abs(safeDuration-(sourceClip.durationSeconds??owner.durationSeconds))<.01)return;
      changeProject({...project,pages:project.pages.map(candidate=>candidate.id===owner.id?{...candidate,elements:candidate.elements.map(candidateClip=>candidateClip.id===element.id?{...candidateClip,startSeconds:clipStart,sourceStartSeconds:sourceStart,durationSeconds:safeDuration}:candidateClip)}:candidate)});
    });video.addEventListener('loadeddata',()=>drawTimelinePreview(timelineTimeRef.current),{once:true});video.addEventListener('seeked',()=>drawTimelinePreview(timelineTimeRef.current));}));if(!cancelled){timelineFramesRef.current=Object.fromEntries(entries);videoElementsRef.current=nextVideos;if(timelinePreviewVisible)drawTimelinePreview(timelineTimeRef.current);}};void load().catch(()=>undefined);return()=>{cancelled=true;objectUrls.forEach(URL.revokeObjectURL);Object.values(nextVideos).forEach(video=>{video.pause();video.removeAttribute('src');video.load();});};},[project.pages,urls]);
  useEffect(()=>{if(!timelinePlaying)return;let raf=0,last=0;const started=performance.now()-timelineTimeRef.current*1000;const tick=(now:number)=>{const t=Math.min(totalSceneDuration,Math.max(0,(now-started)/1000));timelineTimeRef.current=t;drawTimelinePreview(t);if(now-last>=100||t>=totalSceneDuration){setTimelineTime(t);last=now;}if(t>=totalSceneDuration){setTimelinePlaying(false);audioPlayerRef.current?.pause();Object.values(videoElementsRef.current).forEach(video=>video.pause());return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[timelinePlaying,totalSceneDuration,project.pages,urls]);
  useEffect(()=>{if(timelinePreviewVisible)drawTimelinePreview(timelineTimeRef.current);},[timelinePreviewVisible,project.pages,urls]);
  function toggleMusicFavourite(id: string) { setFavoriteMusicIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  const mutate = (updater: (current: StudioProject) => StudioProject, addHistory = true) => {
    if (addHistory) {
      undoRef.current = [...undoRef.current.slice(-39), clone(project)];
      redoRef.current = [];
    }
    const next = updater(project);
    changeProject({ ...next, updatedAt: new Date().toISOString() });
    setDirty(true);
  };
  const replacePage = (nextPage: StudioPage, history = true) =>
    mutate((current) => ({ ...current, pages: current.pages.map((item) => item.id === nextPage.id ? nextPage : item) }), history);
  const updateElement = (id: string, changes: Partial<StudioElement>, history = true) => {
    const current = currentElement(id);
    const onlyVisibilityOrLock = Object.keys(changes).every((key) => key === 'visible' || key === 'locked');
    if (current?.locked && !onlyVisibilityOrLock) return;
    replacePage({ ...page, elements: page.elements.map((item) => item.id === id ? { ...item, ...changes } : item) }, history);
  };
  const currentElement = (id: string) => page.elements.find((item) => item.id === id);

  useEffect(() => {
    const updateFullscreen = () => setCanvasFullscreen(document.fullscreenElement === canvasViewportRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);
  useEffect(() => () => {
    if (renderedPhoto?.url) URL.revokeObjectURL(renderedPhoto.url);
    if (renderedVideo?.url) URL.revokeObjectURL(renderedVideo.url);
  }, [renderedPhoto?.url, renderedVideo?.url]);
  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const saveVersion = editVersionRef.current;
    saveTimer.current = window.setTimeout(() => {
      beginSave();
      void saveProject(project).then(() => {
        if (editVersionRef.current === saveVersion) { setDirty(false); setSaveStatus('saved'); }
        else setSaveStatus('unsaved');
      }).catch((cause) => {
        setSaveStatus(editVersionRef.current === saveVersion ? 'error' : 'unsaved');
        onNotify(cause instanceof Error ? cause.message : 'Autosave failed.');
      }).finally(endSave);
    }, 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [project, dirty, onNotify]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      else if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { if (selectedIds.length) { event.preventDefault(); deleteSelected(); } }
      else if (event.key === 'Escape') { setSelectedIds([]); setTool(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function leaveEditor() {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    const saveVersion = editVersionRef.current;
    beginSave();
    try {
      await saveProject(project);
      if (editVersionRef.current !== saveVersion) {
        setSaveStatus('unsaved');
        onNotify('A new edit was made while saving. Save it before leaving the editor.');
        return;
      }
      setDirty(false); setSaveStatus('saved');
    } catch (cause) {
      setSaveStatus('error');
      onNotify(cause instanceof Error ? cause.message : 'The latest edits could not be saved.');
      if (!window.confirm('Your latest edits could not be saved. Leave the editor anyway?')) return;
    } finally { endSave(); }
    onOpenLibrary();
  }
  async function saveProjectName() {
    if (!project.name.trim() || project.name.trim() === lastSavedName) return;
    const saveVersion = editVersionRef.current;
    const savedName = project.name;
    setNameSaving(true); beginSave();
    try {
      await saveProject(project);
      setLastSavedName(savedName);
      if (editVersionRef.current === saveVersion) { setDirty(false); setSaveStatus('saved'); }
      else setSaveStatus('unsaved');
      onNotify('Design name saved.');
    } catch (cause) {
      setSaveStatus('error');
      onNotify(cause instanceof Error ? cause.message : 'Design name could not be saved.');
    } finally { setNameSaving(false); endSave(); }
  }
  function toggleCanvasFullscreen() {
    const node = canvasViewportRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) void document.exitFullscreen();
    else if (node.requestFullscreen) void node.requestFullscreen().catch(() => onNotify('Canvas fullscreen is unavailable.'));
    else onNotify('Canvas fullscreen is unavailable.');
  }
  function drawTimelinePreview(seconds:number){
    const canvas=timelineCanvasRef.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx||!project.pages.length)return;
    if(canvas.width!==page.width)canvas.width=page.width;if(canvas.height!==page.height)canvas.height=page.height;
    let remaining=Math.max(0,seconds),index=0;while(index<project.pages.length-1&&remaining>=project.pages[index].durationSeconds){remaining-=project.pages[index].durationSeconds;index++;}
    const current=project.pages[index],image=timelineFramesRef.current[current.id];if(!image)return;
    const draw=(img:HTMLImageElement,alpha=1)=>{const scale=Math.min(canvas.width/img.width,canvas.height/img.height),w=img.width*scale,h=img.height*scale;ctx.globalAlpha=alpha;ctx.drawImage(img,(canvas.width-w)/2,(canvas.height-h)/2,w,h);ctx.globalAlpha=1;};
    const activeVideoIds=new Set<string>();
    const drawSceneVideos=(scene:StudioPage,sceneTime:number,alpha=1)=>{
      const scale=Math.min(canvas.width/scene.width,canvas.height/scene.height),offsetX=(canvas.width-scene.width*scale)/2,offsetY=(canvas.height-scene.height*scale)/2;
      scene.elements.filter(clip=>clip.type==='video'&&clip.visible).forEach(clip=>{
        const video=videoElementsRef.current[clip.id],start=clip.startSeconds??0,duration=clip.durationSeconds??scene.durationSeconds,active=sceneTime>=start&&sceneTime<start+duration;
        if(!video)return;if(!active){video.pause();return;}activeVideoIds.add(clip.id);
        const sourceTime=Math.max(0,(clip.sourceStartSeconds??0)+sceneTime-start);
        if(Number.isFinite(video.duration)&&sourceTime>=video.duration){video.pause();return;}
        if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)return;
        if(Math.abs(video.currentTime-sourceTime)>.18){try{video.currentTime=sourceTime;}catch{/* Decoder is still loading. */}}
        if(timelinePlaying&&video.paused)void video.play().catch(()=>undefined);else if(!timelinePlaying)video.pause();
        ctx.save();ctx.translate(offsetX+(clip.x+clip.width/2)*scale,offsetY+(clip.y+clip.height/2)*scale);ctx.rotate(clip.rotation*Math.PI/180);ctx.globalAlpha=clip.opacity*alpha;
        ctx.drawImage(video,-clip.width*scale/2,-clip.height*scale/2,clip.width*scale,clip.height*scale);ctx.restore();
      });
    };
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle=current.background;ctx.fillRect(0,0,canvas.width,canvas.height);draw(image);drawSceneVideos(current,remaining,1);
    const next=project.pages[index+1],fade=Math.min(current.durationSeconds,current.transitionDurationSeconds??.5);
    if(next&&current.transitionAfter==='fade'&&fade>0&&current.durationSeconds-remaining<fade){
      const progress=Math.max(0,Math.min(1,1-(current.durationSeconds-remaining)/fade)),nextImage=timelineFramesRef.current[next.id];
      if(nextImage){draw(nextImage,progress);drawSceneVideos(next,Math.min(next.durationSeconds,progress*fade),progress);}
    }
    Object.entries(videoElementsRef.current).forEach(([id,video])=>{if(!activeVideoIds.has(id))video.pause();});
  }
  function seekTimeline(seconds:number){const t=Math.max(0,Math.min(totalSceneDuration,seconds));timelineTimeRef.current=t;setTimelineTime(t);setTimelinePreviewVisible(true);drawTimelinePreview(t);const audio=audioPlayerRef.current;if(audio&&timelinePlaying){if(t<audioClipLength)audio.currentTime=Math.min(audioTrackDuration-.05,project.audioStartSeconds+t);else audio.pause();}}
  function toggleTimelinePlayback(){const audio=audioPlayerRef.current;if(timelinePlaying){setTimelinePlaying(false);audio?.pause();Object.values(videoElementsRef.current).forEach(video=>video.pause());return;}const start=timelineTimeRef.current>=totalSceneDuration?0:timelineTimeRef.current;timelineTimeRef.current=start;setTimelineTime(start);setTimelinePreviewVisible(true);drawTimelinePreview(start);if(audio&&start<audioClipLength){audio.currentTime=Math.min(audioTrackDuration-.05,project.audioStartSeconds+start);void audio.play().catch(()=>onNotify('Audio preview could not start.'));}else audio?.pause();setTimelinePlaying(true);}
  function setAudioRange(start:number,duration:number){const s=Math.max(0,Math.min(audioTrackDuration-.1,start)),max=Math.max(.1,Math.min(audioTrackDuration-s,totalSceneDuration));changeProject({...project,audioStartSeconds:s,audioDurationSeconds:Math.max(.1,Math.min(max,duration))});}
  function beginAudioRangeDrag(event:ReactPointerEvent<HTMLElement>,request:'auto'|'start'|'end'|'move'){const track=audioRangeTrackRef.current;if(!track)return;event.preventDefault();event.stopPropagation();const rect=track.getBoundingClientRect(),pos=rect.width?(event.clientX-rect.left)/rect.width*audioTrackDuration:0;let mode=request;const start=project.audioStartSeconds,end=start+audioClipLength;if(mode==='auto')mode=pos>=start&&pos<=end?'move':Math.abs(pos-start)<=Math.abs(pos-end)?'start':'end';track.setPointerCapture(event.pointerId);audioRangeDragRef.current={mode,pointerX:event.clientX,start,duration:audioClipLength};}
  function moveAudioRange(event:ReactPointerEvent<HTMLDivElement>){const drag=audioRangeDragRef.current,track=audioRangeTrackRef.current;if(!drag||!track)return;const rect=track.getBoundingClientRect();if(!rect.width)return;const delta=(event.clientX-drag.pointerX)/rect.width*audioTrackDuration;if(drag.mode==='move'){const max=Math.max(0,Math.min(audioTrackDuration-drag.duration,totalSceneDuration-drag.duration));setAudioRange(Math.max(0,Math.min(max,drag.start+delta)),drag.duration);}else if(drag.mode==='start'){const end=drag.start+drag.duration,next=Math.max(0,Math.min(end-.1,drag.start+delta));setAudioRange(next,end-next);}else{const max=Math.max(.1,Math.min(audioTrackDuration-drag.start,totalSceneDuration));setAudioRange(drag.start,Math.max(.1,Math.min(max,drag.duration+delta)));}}
  function selectTimelineVideoClip(scene:StudioPage,clip:StudioElement) {
    setTimelinePlaying(false);audioPlayerRef.current?.pause();Object.values(videoElementsRef.current).forEach(video=>video.pause());
    if(project.selectedPageId!==scene.id)mutate(current=>({...current,selectedPageId:scene.id}),false);
    setSelectedIds([clip.id]);setTool('layers');
  }
  function beginTimelineClipDrag(event:ReactPointerEvent<HTMLElement>,scene:StudioPage,clip:StudioElement,mode:'move'|'start'|'end') {
    if(clip.locked){onNotify('Unlock this video clip before changing its timeline position or trim.');return;}
    const track=timelineClipTrackRef.current;if(!track)return;event.preventDefault();event.stopPropagation();
    const rect=track.getBoundingClientRect();if(!rect.width)return;
    const startSeconds=clip.startSeconds??0,durationSeconds=Math.max(.1,Math.min(clip.durationSeconds??scene.durationSeconds,scene.durationSeconds-startSeconds));
    track.setPointerCapture(event.pointerId);
    timelineClipDragRef.current={clipId:clip.id,pageId:scene.id,pointerId:event.pointerId,pointerX:event.clientX,trackWidth:rect.width,startSeconds,durationSeconds,sourceStartSeconds:clip.sourceStartSeconds??0,previewStartSeconds:startSeconds,previewDurationSeconds:durationSeconds,previewSourceStartSeconds:clip.sourceStartSeconds??0,sceneDuration:scene.durationSeconds,mode,changed:false};
    selectTimelineVideoClip(scene,clip);
  }
  function moveTimelineClipDrag(event:ReactPointerEvent<HTMLDivElement>) {
    const drag=timelineClipDragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    const delta=(event.clientX-drag.pointerX)/drag.trackWidth*totalSceneDuration;
    let startSeconds=drag.startSeconds,durationSeconds=drag.durationSeconds;
    if(drag.mode==='move')startSeconds=Math.max(0,Math.min(drag.sceneDuration-durationSeconds,drag.startSeconds+delta));
    else if(drag.mode==='start'){const end=drag.startSeconds+drag.durationSeconds;startSeconds=Math.max(0,Math.min(end-.1,drag.startSeconds+delta));durationSeconds=end-startSeconds;}
    else durationSeconds=Math.max(.1,Math.min(drag.sceneDuration-drag.startSeconds,drag.durationSeconds+delta));
    const sourceDuration=videoElementsRef.current[drag.clipId]?.duration;
    const sourceStartSeconds=drag.mode==='start'?Math.max(0,Math.min(Number.isFinite(sourceDuration)?Math.max(0,sourceDuration-durationSeconds):Number.MAX_SAFE_INTEGER,drag.sourceStartSeconds+(startSeconds-drag.startSeconds))):Math.max(0,Math.min(Number.isFinite(sourceDuration)?Math.max(0,sourceDuration-durationSeconds):Number.MAX_SAFE_INTEGER,drag.sourceStartSeconds));
    drag.previewStartSeconds=startSeconds;drag.previewDurationSeconds=durationSeconds;drag.previewSourceStartSeconds=sourceStartSeconds;
    drag.changed=Math.abs(startSeconds-drag.startSeconds)>.04||Math.abs(durationSeconds-drag.durationSeconds)>.04;
    setTimelineClipPreview({clipId:drag.clipId,startSeconds,durationSeconds});
  }
  function endTimelineClipDrag(event:ReactPointerEvent<HTMLDivElement>) {
    const drag=timelineClipDragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    const track=timelineClipTrackRef.current;
    if(drag.changed){
      const nextStart=drag.previewStartSeconds,nextDuration=drag.previewDurationSeconds,nextSourceStart=drag.previewSourceStartSeconds;
      mutate(current=>({...current,selectedPageId:drag.pageId,pages:current.pages.map(scene=>scene.id===drag.pageId?{...scene,elements:scene.elements.map(clip=>clip.id===drag.clipId?{...clip,startSeconds:nextStart,durationSeconds:nextDuration,sourceStartSeconds:nextSourceStart}:clip)}:scene)}));
      setSelectedIds([drag.clipId]);setTool('layers');
    }
    if(track?.hasPointerCapture(event.pointerId))track.releasePointerCapture(event.pointerId);
    timelineClipDragRef.current=null;setTimelineClipPreview(null);
  }
  function endAudioRangeDrag(event:ReactPointerEvent<HTMLDivElement>){const track=audioRangeTrackRef.current;if(track?.hasPointerCapture(event.pointerId))track.releasePointerCapture(event.pointerId);audioRangeDragRef.current=null;}
  function updateAudioPlayback(){const audio=audioPlayerRef.current;if(!audio)return;setAudioPreviewTime(audio.currentTime);const t=Math.max(0,audio.currentTime-project.audioStartSeconds),fadeIn=Math.max(0,project.audioFadeInSeconds??0),fadeOut=Math.max(0,project.audioFadeOutSeconds??0);let volume=project.audioVolume/100;if(fadeIn>0&&t<fadeIn)volume*=t/fadeIn;if(fadeOut>0&&t>audioClipLength-fadeOut)volume*=Math.max(0,(audioClipLength-t)/fadeOut);audio.volume=Math.max(0,Math.min(1,volume));if(!audio.paused&&t>=audioClipLength)audio.pause();}

  async function downloadOutputs() {
    if (!renderedPhoto && !renderedVideo) return;
    setDownloadBusy(true);
    try {
      const photo = downloadTarget !== 'video' && renderedPhoto;
      const video = downloadTarget !== 'photo' && renderedVideo;
      if (photo && renderedPhoto) {
        const blob = downloadPhotoFormat === 'jpg' ? await convertImageBlob(renderedPhoto.blob, 'image/jpeg') : renderedPhoto.blob;
        downloadBlob(blob, renderedPhoto.name.replace(/\.(png|jpe?g)$/i, '') + '.' + downloadPhotoFormat);
      }
      if (video && renderedVideo) downloadBlob(renderedVideo.blob, renderedVideo.name);
      setDownloadOpen(false);
      onNotify('Selected output has been handed to your browser downloads.');
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : 'Download preparation failed.'); }
    finally { setDownloadBusy(false); }
  }
  function undo() {
    const prior = undoRef.current.pop();
    if (!prior) return;
    redoRef.current.push(clone(project));
    changeProject(prior); setSelectedIds([]); setDirty(true);
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(clone(project));
    changeProject(next); setSelectedIds([]); setDirty(true);
  }
  function selectObject(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (currentElement(id)?.locked) { setSelectedIds([id]); return; }
    const group = currentElement(id)?.groupId;
    const ids = group ? page.elements.filter((item) => item.groupId === group).map((item) => item.id) : [id];
    const nextIds = event.shiftKey ? Array.from(new Set([...selectedIds, ...ids])) : ids;
    setSelectedIds(nextIds);
    const start = pointFromEvent(event);
    const items = page.elements.filter((item) => nextIds.includes(item.id) && !item.locked);
    dragRef.current = { mode: 'move', ids: nextIds, start, items: clone(items) };
    undoRef.current = [...undoRef.current.slice(-39), clone(project)]; redoRef.current = [];
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function pointFromEvent(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const result = point.matrixTransform(matrix.inverse());
    return { x: result.x, y: result.y };
  }
  function startHandle(event: ReactPointerEvent<SVGCircleElement>, mode: 'resize' | 'rotate', handle: string, item: StudioElement) {
    if (item.locked) return;
    event.stopPropagation(); event.preventDefault();
    const point = pointFromEvent(event);
    dragRef.current = { mode, ids: [item.id], start: point, items: [clone(item)], handle,
      center: { x: item.x + item.width / 2, y: item.y + item.height / 2 } };
    undoRef.current = [...undoRef.current.slice(-39), clone(project)]; redoRef.current = [];
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    if (drag.mode === 'move') {
      // Snap the selection's bounding box as one unit so grouped/multi-selected
      // elements retain their relative spacing while moving together.
      const bounds = drag.items.reduce((current, item) => ({
        left: Math.min(current.left, item.x),
        top: Math.min(current.top, item.y),
        right: Math.max(current.right, item.x + item.width),
        bottom: Math.max(current.bottom, item.y + item.height),
      }), {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      });
      let moveX = dx;
      let moveY = dy;
      const guides: { x?: number; y?: number } = {};
      const centerX = (bounds.left + bounds.right) / 2 + moveX;
      const centerY = (bounds.top + bounds.bottom) / 2 + moveY;
      if (Math.abs(centerX - page.width / 2) < 12) {
        moveX += page.width / 2 - centerX;
        guides.x = page.width / 2;
      }
      if (Math.abs(centerY - page.height / 2) < 12) {
        moveY += page.height / 2 - centerY;
        guides.y = page.height / 2;
      }
      const moving = drag.items.map((item) => ({ ...item, x: item.x + moveX, y: item.y + moveY }));
      setSnapGuides(guides);
      replacePage({ ...page, elements: page.elements.map((item) => moving.find((next) => next.id === item.id) ?? item) }, false);
    } else if (drag.mode === 'resize') {
      const item = drag.items[0];
      const handle = drag.handle ?? '';
      let x = item.x, y = item.y, width = item.width, height = item.height;
      if (handle.includes('e')) width = Math.max(12, item.width + dx);
      if (handle.includes('s')) height = Math.max(12, item.height + dy);
      if (handle.includes('w')) { width = Math.max(12, item.width - dx); x = item.x + item.width - width; }
      if (handle.includes('n')) { height = Math.max(12, item.height - dy); y = item.y + item.height - height; }
      updateElement(item.id, { x, y, width, height }, false);
    } else if (drag.mode === 'rotate') {
      const center = drag.center!;
      const startAngle = Math.atan2(drag.start.y - center.y, drag.start.x - center.x);
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      updateElement(drag.items[0].id, { rotation: Math.round(drag.items[0].rotation + (angle - startAngle) * 180 / Math.PI) }, false);
    }
  }
  function endPointer() { dragRef.current = null; setSnapGuides({}); setDirty(true); }
  function deleteSelected() {
    const ids = new Set(selected.filter((item) => !item.locked).map((item) => item.id));
    if (!ids.size) return;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.filter((item) => !ids.has(item.id)) } : entry) }));
    setSelectedIds(selected.filter((item) => item.locked).map((item) => item.id));
  }
  function duplicateSelected() {
    const editable = selected.filter((item) => !item.locked);
    if (!editable.length) return;
    const editableIds = new Set(editable.map((item) => item.id));
    const groupMap = new Map<string, string>();
    const copies = page.elements.filter((item) => editableIds.has(item.id)).map((item) => {
      const groupId = item.groupId ? (groupMap.get(item.groupId) ?? randomId()) : undefined;
      if (item.groupId && groupId) groupMap.set(item.groupId, groupId);
      return { ...clone(item), id: randomId(), name: item.name + ' copy', x: item.x + 24, y: item.y + 24, groupId };
    });
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, ...copies] } : entry) }));
    setSelectedIds(copies.map((item) => item.id));
  }
  function groupSelected() {
    const editableIds = new Set(selected.filter((item) => !item.locked).map((item) => item.id));
    if (editableIds.size < 2) return;
    const groupId = randomId();
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.map((item) => editableIds.has(item.id) ? { ...item, groupId } : item) } : entry) }));
  }
  function ungroupSelected() {
    const editable = selected.filter((item) => !item.locked);
    const groupIds = new Set(editable.map((item) => item.groupId).filter(Boolean));
    if (!groupIds.size) return;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.map((item) => !item.locked && groupIds.has(item.groupId) ? { ...item, groupId: undefined } : item) } : entry) }));
  }
  function alignSelected(position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const editableIds = new Set(selected.filter((item) => !item.locked).map((item) => item.id));
    if (!editableIds.size) return;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id !== page.id ? entry : {
      ...entry, elements: entry.elements.map((item) => {
        if (!editableIds.has(item.id)) return item;
        if (position === 'left') return { ...item, x: 0 };
        if (position === 'center') return { ...item, x: (page.width - item.width) / 2 };
        if (position === 'right') return { ...item, x: page.width - item.width };
        if (position === 'top') return { ...item, y: 0 };
        if (position === 'middle') return { ...item, y: (page.height - item.height) / 2 };
        return { ...item, y: page.height - item.height };
      }),
    }) }));
  }
  function reorderSelected(direction: -1 | 1) {
    const indexes = page.elements.map((item, index) => selected.some((selectedItem) => selectedItem.id === item.id && !selectedItem.locked) ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) return;
    const from = direction > 0 ? Math.max(...indexes) : Math.min(...indexes);
    const to = from + direction;
    if (to < 0 || to >= page.elements.length || page.elements[to].locked) return;
    const next = [...page.elements]; [next[from], next[to]] = [next[to], next[from]];
    replacePage({ ...page, elements: next });
  }
  function addPage() {
    const next = defaultPage('Page ' + (project.pages.length + 1), page.width, page.height);
    mutate((current) => ({ ...current, pages: [...current.pages, next], selectedPageId: next.id }));
    setSelectedIds([]);
  }
  function clonePageWithNewIds(source: StudioPage, name: string): StudioPage {
    const groupMap = new Map<string, string>();
    return { ...clone(source), id: randomId(), name, elements: source.elements.map((item) => {
      const groupId = item.groupId ? (groupMap.get(item.groupId) ?? randomId()) : undefined;
      if (item.groupId && groupId) groupMap.set(item.groupId, groupId);
      return { ...clone(item), id: randomId(), groupId };
    }) };
  }
  function duplicatePage() {
    const baseName = page.name + ' — Copy';
    const known = new Set(project.pages.map((item) => item.name));
    let copyName = baseName, suffix = 2;
    while (known.has(copyName)) { copyName = baseName + ' ' + suffix++; }
    const next = clonePageWithNewIds(page, copyName);
    mutate((current) => ({ ...current, pages: [...current.pages, next], selectedPageId: next.id }));
    setSelectedIds([]);
  }
  function deletePage() {
    if (project.pages.length <= 1) return;
    const nextPages = project.pages.filter((item) => item.id !== page.id);
    mutate((current) => ({ ...current, pages: nextPages, selectedPageId: nextPages[0].id }));
    setSelectedIds([]);
  }
  function resizedPage(source: StudioPage, preset: SizePreset): StudioPage {
    const scaleX = preset.width / source.width, scaleY = preset.height / source.height, fontScale = Math.min(scaleX, scaleY);
    return { ...source, width: preset.width, height: preset.height, name: preset.label, elements: source.elements.map((item) => ({ ...item, x: item.x * scaleX, y: item.y * scaleY, width: Math.max(1, item.width * scaleX), height: Math.max(1, item.height * scaleY), fontSize: Math.max(8, Math.round(item.fontSize * fontScale)) })) };
  }
  function applyPreset(preset: SizePreset) {
    const nextPage = resizedPage(page, preset);
    mutate((current) => ({ ...current, pages: current.pages.map((item) => item.id === page.id ? nextPage : item) }));
    setSelectedIds([]);
  }
  function createSizeVariant(preset: SizePreset) {
    const variant = clonePageWithNewIds(resizedPage(page, preset), preset.label);
    mutate((current) => ({ ...current, pages: [...current.pages, variant], selectedPageId: variant.id }));
    setSelectedIds([]);
  }
  function applyCustomSize() {
    const width = Math.round(Number(customWidth)), height = Math.round(Number(customHeight));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100 || width > 6000 || height > 6000) {
      onNotify('Enter dimensions between 100 and 6000 pixels.');
      return;
    }
    applyPreset({ id: 'custom', label: 'Custom size', platform: 'Custom', width, height, group: 'Custom' });
  }

  async function addUploadedFile(file: File, kind: StudioResourceKind) {
    try {
      const resource = await saveResource(file, file.name, kind);
      await onResourceAdded(resource);
      onNotify('Resource saved to the local library.');
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : 'Resource could not be saved.'); }
  }
  async function addStarterImage(assetId: string) {
    const asset = STARTER_ARTWORK_ASSETS.find((item) => item.id === assetId);
    if (!asset) return;
    try {
      const response = await fetch(asset.sourceUrl!, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error('Image source could not be fetched.');
      const blob = await response.blob();
      const resource = await saveResource(blob, asset.name + '.jpg', 'image');
      await onResourceAdded(resource);
      const item = makeElement('image', page);
      item.name = asset.name; item.resourceId = resource.id;
      replacePage({ ...page, elements: [...page.elements, item] });
      setSelectedIds([item.id]);
      onNotify('Image added to the design.');
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : 'Starter image is unavailable.'); }
  }
  async function addLibraryImage(resource: StudioResource) {
    const item = makeElement('image', page);
    item.name = resource.name; item.resourceId = resource.id;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, item] } : entry) }));
    setSelectedIds([item.id]);
  }
  function addLibraryVideo(resource: StudioResource) {
    const item = makeElement('video', page); item.name = resource.name; item.resourceId = resource.id;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, item] } : entry) }));
    setSelectedIds([item.id]); setTool('layers'); onNotify('Video clip added to this scene. Adjust its timing in Properties.');
  }
  async function exportImage(mime: 'image/png' | 'image/jpeg' = 'image/png') {
    setExporting(true); setRenderStage('preparing'); setRenderProgress(10);
    try {
      const pageIndex = project.pages.findIndex(item => item.id === page.id);
      const pageOffset = project.pages.slice(0, Math.max(0, pageIndex)).reduce((sum, item) => sum + item.durationSeconds, 0);
      const sceneTime = timelinePreviewVisible && timelineTime >= pageOffset && timelineTime < pageOffset + page.durationSeconds ? timelineTime - pageOffset : 0;
      const blob = await renderPageBlob(page, urls, mime, sceneTime);
      setRenderStage('saving'); setRenderProgress(75);
      const extension = mime === 'image/png' ? 'png' : 'jpg';
      const filename = slug(project.name) + '-' + slug(page.name) + '.' + extension;
      const resource = await saveResource(blob, filename, 'export');
      await onResourceAdded(resource);
      if (renderedPhoto?.url) URL.revokeObjectURL(renderedPhoto.url);
      setRenderedPhoto({ blob, url: URL.createObjectURL(blob), name: filename });
      setRenderProgress(100); setRenderStage('ready');
      onNotify('Photo rendered and saved. It has not been downloaded.');
    } catch (cause) { setRenderStage('failed'); onNotify(cause instanceof Error ? cause.message : 'Photo rendering failed.'); }
    finally { setExporting(false); }
  }

  async function exportVideo() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      onNotify('This browser cannot record canvas video. Use current Chrome or Edge.');
      return;
    }
    const maxDuration = storyTarget === 'whatsapp-status' ? 90 : storyTarget === 'social-reel' ? 120 : 60;
    const totalDuration = project.pages.reduce((sum, item) => sum + item.durationSeconds, 0);
    const audioResource = resources.find((item) => item.id === selectedAudio && item.kind === 'audio');
    if (audioResource && totalDuration < 1) {
      onNotify('Add at least one second of scene duration before rendering with audio.');
      return;
    }
    if (totalDuration > maxDuration) {
      onNotify('This destination supports up to ' + maxDuration + ' seconds. Shorten the scene timeline first.');
      return;
    }

    setExporting(true); setRenderStage('preparing'); setRenderProgress(4);
    let cancelled=false;
    let recorder: MediaRecorder | null = null;
    let context: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    let mediaStream: MediaStream | null = null;
    let frameId = 0;
    let stopWatch: number | null = null;
    const frameUrls: string[] = [];

    try {
      Object.values(videoElementsRef.current).forEach(video=>video.pause());
      const frames = await Promise.all(project.pages.map(async (item) => {
        const blob = new Blob([makeSvg(item, urls, false, false)], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        frameUrls.push(url);
        const image = new Image();
        image.src = url;
        await image.decode();
        return { image, page: item, duration: Math.max(1, item.durationSeconds), transition: item.transitionAfter ?? 'cut', transitionDuration: Math.max(0.1, item.transitionDurationSeconds ?? 0.5), width: item.width, height: item.height };
      }));

      await Promise.all(Object.values(videoElementsRef.current).map(video => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('A video clip could not be decoded before export. Check the file and try again.')), 10000);
          video.addEventListener('loadeddata', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          video.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('A video clip could not be decoded. Use a browser-supported MP4 or WebM file.')); }, { once: true });
        });
      }));
      const canvas = document.createElement('canvas');
      // Render every scene letterboxed at the selected page's exact dimensions.
      canvas.width = page.width;
      canvas.height = page.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Video render canvas is unavailable.');
      mediaStream = canvas.captureStream(30);

      let audioClipStart = 0;
      let audioClipDuration = 0;
      if (audioResource) {
        context = new AudioContext();
        const audioDestination = context.createMediaStreamDestination();
        const decoded = await context.decodeAudioData(await audioResource.blob.arrayBuffer());
        audioSource = context.createBufferSource();
        audioSource.buffer = decoded;
        const gain = context.createGain();
        audioClipStart=Math.max(0,project.audioStartSeconds);
        audioClipDuration=Math.min(project.audioDurationSeconds??30,totalDuration,Math.max(0,decoded.duration-audioClipStart));
        if(audioClipDuration<.1)throw new Error('The selected audio range must contain at least 0.1 seconds within the video duration.');
        const volume=Math.max(0,Math.min(1,project.audioVolume/100)),fadeIn=Math.max(0,Math.min(audioClipDuration,project.audioFadeInSeconds??0)),fadeOut=Math.max(0,Math.min(audioClipDuration,project.audioFadeOutSeconds??0)),started=context.currentTime;
        gain.gain.setValueAtTime(fadeIn>0?0:volume,started);if(fadeIn>0)gain.gain.linearRampToValueAtTime(volume,started+fadeIn);if(fadeOut>0){const outAt=Math.max(fadeIn,audioClipDuration-fadeOut);gain.gain.setValueAtTime(volume,started+outAt);gain.gain.linearRampToValueAtTime(0,started+audioClipDuration);}
        audioSource.connect(gain);gain.connect(audioDestination);
        audioDestination.stream.getAudioTracks().forEach((track) => mediaStream?.addTrack(track));
      }

      const mime = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ].find((value) => MediaRecorder.isTypeSupported(value));
      recorder = new MediaRecorder(mediaStream, mime
        ? { mimeType: mime, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 }
        : undefined);

      const parts: Blob[] = [];
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder!.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
        recorder!.onerror = () => reject(new Error('Video recording failed.'));
        recorder!.onstop = () => {
          if (stopWatch !== null) {
            window.clearTimeout(stopWatch);
            stopWatch = null;
          }
          resolve(new Blob(parts, { type: recorder!.mimeType || 'video/webm' }));
        };
      });
      // Keep a rejection handler attached even when a setup error occurs before awaiting the recorder.
      void stopped.catch(() => undefined);

      recorder.start(250);
      setRenderStage('rendering');setCanCancelRender(true);
      cancelRenderRef.current=()=>{cancelled=true;if(recorder?.state==='recording')recorder.stop();};
      if (context && audioSource) {
        await context.resume();
        audioSource.start(0, audioClipStart, audioClipDuration);
      }

      const total = frames.reduce((sum, item) => sum + item.duration, 0);
      const started = performance.now();
      let renderFailure: Error | null = null;

      const draw = (now: number) => {
        try {
          const elapsed = (now - started) / 1000;
          setRenderProgress(Math.min(96, Math.round(8 + elapsed / total * 86)));
          let offset = elapsed;
          let selectedFrameIndex = frames.length - 1;
          let selectedOffset = 0;
          for (let index = 0; index < frames.length; index += 1) {
            if (offset <= frames[index].duration) {
              selectedFrameIndex = index;
              selectedOffset = offset;
              break;
            }
            offset -= frames[index].duration;
          }

          const selectedFrame = frames[selectedFrameIndex];
          const drawContained = (image: HTMLImageElement, alpha = 1) => {
            const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
            const width = image.width * ratio;
            const height = image.height * ratio;
            ctx.globalAlpha = alpha;
            ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
            ctx.globalAlpha = 1;
          };

          ctx.fillStyle = '#101c35';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const activeVideoIds=new Set<string>();
          const drawSceneVideos=(scene:StudioPage,sceneTime:number,alpha=1)=>{
            const scale=Math.min(canvas.width/scene.width,canvas.height/scene.height),offsetX=(canvas.width-scene.width*scale)/2,offsetY=(canvas.height-scene.height*scale)/2;
            scene.elements.filter(clip=>clip.type==='video'&&clip.visible).forEach(clip=>{
              const video=videoElementsRef.current[clip.id],clipStart=clip.startSeconds??0,clipDuration=clip.durationSeconds??scene.durationSeconds;
              if(!video)return;if(sceneTime<clipStart||sceneTime>=clipStart+clipDuration){video.pause();return;}activeVideoIds.add(clip.id);
              const sourceTime=Math.max(0,(clip.sourceStartSeconds??0)+sceneTime-clipStart);
              if(Number.isFinite(video.duration)&&sourceTime>=video.duration)return;
              if(video.readyState<HTMLMediaElement.HAVE_CURRENT_DATA)return;
              if(Math.abs(video.currentTime-sourceTime)>.18){try{video.currentTime=sourceTime;}catch{/* Wait for decoded frame. */}}
              if(video.paused)void video.play().catch(()=>undefined);
              ctx.save();ctx.translate(offsetX+(clip.x+clip.width/2)*scale,offsetY+(clip.y+clip.height/2)*scale);
              ctx.rotate(clip.rotation*Math.PI/180);ctx.globalAlpha=clip.opacity*alpha;
              ctx.drawImage(video,-clip.width*scale/2,-clip.height*scale/2,clip.width*scale,clip.height*scale);ctx.restore();
            });
          };
          drawContained(selectedFrame.image);
          drawSceneVideos(selectedFrame.page,selectedOffset,1);
          const nextFrame = frames[selectedFrameIndex + 1];
          const transitionWindow = Math.min(selectedFrame.duration, selectedFrame.transitionDuration);
          if (nextFrame && selectedFrame.transition === 'fade' && selectedFrame.duration - selectedOffset < transitionWindow) {
            const progress = Math.max(0,Math.min(1,1-(selectedFrame.duration-selectedOffset)/transitionWindow));
            drawContained(nextFrame.image,progress);
            drawSceneVideos(nextFrame.page,Math.min(nextFrame.duration,progress*transitionWindow),progress);
          }
          Object.entries(videoElementsRef.current).forEach(([id,video])=>{if(!activeVideoIds.has(id))video.pause();});

          if (elapsed >= total) {
            if (recorder?.state === 'recording') recorder.stop();
            return;
          }
          frameId = requestAnimationFrame(draw);
        } catch (cause) {
          renderFailure = cause instanceof Error ? cause : new Error('A video frame could not be rendered.');
          if (recorder?.state === 'recording') recorder.stop();
        }
      };

      // A throttled or backgrounded animation frame must not leave MediaRecorder running forever.
      stopWatch = window.setTimeout(() => {
        if (recorder?.state === 'recording') recorder.stop();
      }, total * 1000 + 8000);
      frameId = requestAnimationFrame(draw);

      const blob = await stopped;
      if(cancelled)throw new Error('Video rendering was cancelled.');
      if (renderFailure) throw renderFailure;
      if (!blob.size) throw new Error('Video export is empty.');
      setRenderStage('saving');
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const filename = slug(project.name) + '-video.' + extension;
      const resource = await saveResource(blob, filename, 'video', true);
      await onResourceAdded(resource);
      if (renderedVideo?.url) URL.revokeObjectURL(renderedVideo.url);
      setRenderedVideo({ blob, url: URL.createObjectURL(blob), name: filename, duration: total });
      setRenderProgress(100);setRenderStage('ready');setVideoPreviewOpen(true);
      onNotify('Video rendered and saved. Preview it here or download it when ready.');
    } catch (cause) {
      if (recorder?.state === 'recording') recorder.stop();
      setRenderStage(cancelled?'cancelled':'failed');
      onNotify(cause instanceof Error ? cause.message : 'Video export failed.');
    } finally {
      if (stopWatch !== null) window.clearTimeout(stopWatch);
      if (frameId) cancelAnimationFrame(frameId);
      try { audioSource?.stop(); } catch { /* The source may not have started before an export error. */ }
      mediaStream?.getTracks().forEach((track) => track.stop());
      frameUrls.forEach((url) => URL.revokeObjectURL(url));
      await context?.close().catch(() => undefined);
      Object.values(videoElementsRef.current).forEach(video=>video.pause());
      cancelRenderRef.current=null;setCanCancelRender(false);
      setExporting(false);
    }
  }
  const panelTitle: Record<Tool, string> = {
    templates: 'Templates', elements: 'Elements', text: 'Text', publishing: 'Publishing', uploads: 'Uploads', brand: 'Brand',
    audio: 'Audio', layers: 'Layers', pages: 'Pages', resize: 'Resize',
  };
  const selectedTools: Array<[Tool, string, string]> = [
    ['templates','template','Templates'], ['elements','shapes','Elements'], ['text','text','Text'], ['publishing','publish','Publishing'],
    ['uploads','image','Uploads'], ['brand','brand','Brand'], ['audio','audio','Audio'],
    ['layers','layers','Layers'], ['pages','pages','Pages'], ['resize','resize','Resize'],
  ];

  return <div className={styles.editorOverlay} role="dialog" aria-modal="true" aria-label="Creative editor">
    <header className={styles.editorTopbar}>
      <button type="button" title="Back to resources" aria-label="Back to resources" onClick={() => void leaveEditor()}><Icon name="back"/></button>
      <input className={styles.projectName} aria-label="Design name" value={project.name} onChange={(event) => changeProject({ ...project, name: event.target.value })}/>
      <button type="button" className={styles.saveNameButton} title="Save design name" aria-label="Save design name" disabled={nameSaving || !project.name.trim() || project.name.trim() === lastSavedName} onClick={() => void saveProjectName()}><Icon name="save"/></button>
      <span className={styles.saveState} role="status" aria-live="polite">{saveStatus === 'saving' ? 'Saving edits…' : saveStatus === 'unsaved' ? 'Unsaved changes' : saveStatus === 'error' ? 'Save failed · edit to retry' : 'All edits saved'}</span>
      <button type="button" title="Undo" aria-label="Undo" disabled={!undoRef.current.length} onClick={undo}><Icon name="undo"/></button>
      <button type="button" title="Redo" aria-label="Redo" disabled={!redoRef.current.length} onClick={redo}><Icon name="redo"/></button>
      <span className={styles.topSpacer}/>
      <button type="button" className={renderedPhoto ? styles.outputReady : undefined} title="Render photo" aria-label="Render photo" disabled={exporting} aria-pressed={!!renderedPhoto} onClick={() => void exportImage('image/png')}><Icon name="image"/></button>
      <button type="button" className={renderedVideo ? styles.outputReady : undefined} title="Render video" aria-label="Render video" disabled={exporting} aria-pressed={!!renderedVideo} onClick={() => void exportVideo()}><Icon name="video"/></button>
      <button type="button" title="Download rendered outputs" aria-label="Download rendered outputs" disabled={exporting || (!renderedPhoto && !renderedVideo)} onClick={() => { setDownloadTarget(renderedPhoto && renderedVideo ? 'both' : renderedPhoto ? 'photo' : 'video'); setDownloadOpen(true); }}><Icon name="download"/></button>
    </header>
    <div className={styles.editorLayout}>
      <nav className={styles.toolRail} aria-label="Editor tools">
        {selectedTools.map(([id, icon, label]) => <button key={id} type="button" title={label} aria-label={label} aria-pressed={tool === id}
          className={tool === id ? styles.toolActive : styles.toolButton} onClick={() => { setTool(tool === id ? null : id); setPanelSearch(''); }}><Icon name={icon}/></button>)}
      </nav>
      {tool && <aside className={styles.toolPanel} aria-label={panelTitle[tool]}>
        <div className={styles.toolPanelHeading}><strong>{panelTitle[tool]}</strong><button type="button" aria-label="Close tool panel" onClick={() => setTool(null)}><Icon name="close"/></button></div>
        {tool !== 'brand' && tool !== 'pages' && tool !== 'resize' && <label className={styles.panelSearch}><Icon name="search"/><input aria-label="Search tool resources" value={panelSearch} onChange={(event) => setPanelSearch(event.target.value)} placeholder="Search"/></label>}
        {tool === 'templates' && <div className={styles.templatePanelGrid}>{STARTER_TEMPLATES.filter((item) => (item.name + ' ' + item.occasion).toLowerCase().includes(panelSearch.toLowerCase())).map((item) =>
          <button type="button" key={item.id} className={styles.templateOption} onClick={() => {
            const pageFrom = pageFromTemplate(item.id); if (!pageFrom) return;
            mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? pageFrom : entry), caption: item.caption, hashtags: item.hashtags, primaryColor: item.primary, accentColor: item.accent }));
            setSelectedIds([]);
          }}><span style={{ background: item.primary }}><b style={{ color: item.accent }}>Aa</b></span><strong>{item.name}</strong></button>)}</div>}
        {tool === 'elements' && <div className={styles.toolTiles}>
          {['Rectangle','Rounded badge','Offer badge','Pill','Outline box','Circle','Ellipse','Divider','Arrow','Triangle sticker','Star sticker','Burst sticker'].filter((preset) => preset.toLowerCase().includes(panelSearch.toLowerCase())).map((preset) =>
            <button type="button" key={preset} onClick={() => {
              const kind = preset === 'Divider' ? 'line' : ['Circle','Ellipse'].includes(preset) ? 'circle' : 'rect';
              const next = makeElement(kind, page); next.name = preset;
              if (preset === 'Outline box') { next.fill = 'transparent'; next.stroke = project.accentColor; next.strokeWidth = 5; }
              if (preset === 'Arrow') { next.shapeKind = 'arrow'; next.width = page.width * .48; next.height = page.height * .18; next.fill = project.accentColor; }
              if (preset === 'Triangle sticker') { next.shapeKind = 'triangle'; next.width = page.width * .24; next.height = page.height * .2; next.fill = project.accentColor; }
              if (preset === 'Star sticker') { next.shapeKind = 'star'; next.width = page.width * .22; next.height = page.height * .22; next.fill = '#facc15'; next.stroke = '#a16207'; next.strokeWidth = 3; }
              if (preset === 'Burst sticker') { next.shapeKind = 'burst'; next.width = page.width * .28; next.height = page.height * .25; next.fill = project.accentColor; }
              if (['Offer badge','Rounded badge','Pill'].includes(preset)) { next.fill = project.accentColor; next.width = page.width * .36; next.height = page.height * .13; }
              mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, next] } : entry) }));
              setSelectedIds([next.id]);
            }}><Icon name={preset === 'Divider' ? 'minus' : ['Circle','Ellipse'].includes(preset) ? 'brand' : 'shapes'}/>{preset}</button>)}
        </div>}
        {tool === 'text' && <div className={styles.toolTiles}>
          {[
            ['Display title','MAKE EVERY RIDE COUNT',.075,'800','#ffffff'],
            ['Headline','Your next adventure starts here',.06,'800','#ffffff'],
            ['Subheading','Discover something extraordinary',.038,'600','#e5edf6'],
            ['Body text','Add your supporting message here.',.027,'400','#e5edf6'],
            ['Price / offer','₹ 99,999',.07,'800',project.accentColor],
            ['Badge text','LIMITED OFFER',.035,'800',project.accentColor],
            ['Call to action','BOOK YOUR TEST RIDE',.032,'800','#ffffff'],
            ['Fine print','Terms and conditions apply.',.018,'400','#cbd5e1'],
          ].filter(([name]) => String(name).toLowerCase().includes(panelSearch.toLowerCase())).map(([name,content,scale,weight,fill]) => <button type="button" key={String(name)} onClick={() => {
            const next = makeElement('text', page); next.name = String(name); next.text = String(content);
            next.fontSize = Math.max(16, Math.round(page.width * Number(scale))); next.fontWeight = weight as StudioElement['fontWeight'];
            next.fill = String(fill); next.width = page.width * .84; next.height = page.height * .2;
            mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, next] } : entry) }));
            setSelectedIds([next.id]);
          }}><Icon name="text"/>{String(name)}</button>)}

        </div>}
        {tool === 'publishing' && <div className={styles.toolTiles}>
          <div className={styles.toolPanelHeading}><strong>Publishing settings</strong><span>These details are included with approval requests, not drawn on the artwork.</span></div>
          <label className={styles.panelField}>Publishing caption<textarea aria-label="Publishing caption" rows={5} value={project.caption} onChange={(event) => changeProject({ ...project, caption: event.target.value })}/></label>
          <label className={styles.panelField}>Publishing hashtags<input aria-label="Publishing hashtags" value={project.hashtags} onChange={(event) => changeProject({ ...project, hashtags: event.target.value })}/></label>
        </div>}
        {tool === 'uploads' && <div className={styles.uploadPanel}>
          <label className={styles.uploadDrop}><Icon name="upload"/><span>Import media</span><input type="file" multiple accept="image/*,audio/*,video/*" onChange={(event) => {
            const files = Array.from(event.target.files ?? []); event.target.value = '';
            if (!files.length) return;
            void (async () => {
              let imported = 0;
              try {
                for (const file of files) {
                  const kind: StudioResourceKind | null = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : null;
                  if (!kind) throw new Error('Unsupported media type for "' + file.name + '". Import an image, audio or video file.');
                  const resource = await saveResource(file, file.name, kind);
                  await onResourceAdded(resource);
                  imported += 1;
                }
                onNotify(imported + ' media item' + (imported === 1 ? '' : 's') + ' imported.');
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : 'Media import failed.';
                onNotify(imported ? imported + ' of ' + files.length + ' media items imported. ' + message : message);
              }
            })();
          }}/></label>
          {resources.filter((item) => item.kind === 'image' && (item.name).toLowerCase().includes(panelSearch.toLowerCase())).map((resource) => <button type="button" key={resource.id} className={styles.libraryAsset} onClick={() => void addLibraryImage(resource)}>
            {urls[resource.id] ? <img src={urls[resource.id]} alt=""/> : <Icon name="image"/>}<span>{resource.name}</span>
          </button>)}
          {resources.filter((item) => item.kind === 'video' && item.name.toLowerCase().includes(panelSearch.toLowerCase())).map((resource) => <button type="button" key={resource.id} className={styles.libraryAsset} onClick={() => addLibraryVideo(resource)}><Icon name="video"/><span>{resource.name} · Add video clip</span></button>)}
          {STARTER_ARTWORK_ASSETS.filter((item) => item.name.toLowerCase().includes(panelSearch.toLowerCase())).map((item) => <button type="button" key={item.id} className={styles.libraryAsset} onClick={() => void addStarterImage(item.id)}><Icon name="image"/><span>{item.name}</span></button>)}
        </div>}
        {tool === 'brand' && <div className={styles.toolTiles}>
          <label className={styles.panelField}>Primary colour<input type="color" value={project.primaryColor} onChange={(event) => changeProject({ ...project, primaryColor: event.target.value })}/></label>
          <label className={styles.panelField}>Accent colour<input type="color" value={project.accentColor} onChange={(event) => changeProject({ ...project, accentColor: event.target.value })}/></label>
          <label className={styles.panelField}>Page background<input type="color" value={page.background} onChange={(event) => replacePage({ ...page, background: event.target.value })}/></label>
          <button type="button" onClick={() => setBrandAssetPickerOpen(true)}><Icon name="imageplus"/>Add logo / image</button>
        </div>}
        {tool === 'audio' && <div className={styles.audioPanel}>
          <label className={styles.uploadDrop}><Icon name="audio"/><span>Import audio</span><input type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addUploadedFile(file, 'audio'); }}/></label>
          {resources.filter((item) => item.kind === 'audio' && item.name.toLowerCase().includes(panelSearch.toLowerCase())).map((resource) => <div className={styles.audioResourceRow} key={resource.id}>
            <button type="button" className={selectedAudio === resource.id ? styles.audioSelected : styles.audioTrack} onClick={() => { setSelectedIds([]); setSelectedAudio(resource.id); changeProject({ ...project, selectedAudioId: resource.id }); }}><Icon name="audio"/><span>{resource.name}</span>{selectedAudio === resource.id && <Icon name="check"/>}</button>
            <button type="button" title={favoriteMusicIds.includes(resource.id) ? 'Remove favourite' : 'Add favourite'} aria-label={favoriteMusicIds.includes(resource.id) ? 'Remove favourite ' + resource.name : 'Favourite ' + resource.name} aria-pressed={favoriteMusicIds.includes(resource.id)} onClick={() => toggleMusicFavourite(resource.id)}>{favoriteMusicIds.includes(resource.id) ? '★' : '☆'}</button>
          </div>)}
          <div className={styles.starterMusicList}>{STARTER_MUSIC_CATALOG.filter((track) => track.name.toLowerCase().includes(panelSearch.toLowerCase()) || track.category.toLowerCase().includes(panelSearch.toLowerCase())).map((track) => <div key={track.id}><span><strong>{track.name}</strong><small>{track.creator} · {track.category}</small><small>{track.licenseLabel}{track.contentIdRegistered ? ' · Content ID registered' : ''}</small></span><div><button type="button" aria-label={favoriteMusicIds.includes(track.id) ? 'Remove favourite ' + track.name : 'Favourite ' + track.name} aria-pressed={favoriteMusicIds.includes(track.id)} onClick={() => toggleMusicFavourite(track.id)}>{favoriteMusicIds.includes(track.id) ? '★' : '☆'}</button><a href={track.sourcePage} target="_blank" rel="noreferrer">Source</a></div></div>)}</div>
          <label className={styles.panelField}>Story destination<select aria-label="Story destination" value={storyTarget} onChange={(event) => setStoryTarget(event.target.value as StoryTarget)}><option value="whatsapp-status">WhatsApp Status · 90s</option><option value="instagram-story">Instagram Story · 60s</option><option value="facebook-story">Facebook Story · 60s</option><option value="social-reel">Instagram / Facebook Reel · 120s</option></select></label>

        </div>}
        {tool === 'layers' && <div className={styles.layerList}>{[...page.elements].filter((item) => (item.name + ' ' + item.type + ' ' + (item.type === 'text' ? item.text : '')).toLowerCase().includes(panelSearch.toLowerCase())).reverse().map((item) => <div className={styles.layerRow} key={item.id} data-selected={selectedIds.includes(item.id)}>
          <button type="button" aria-label={item.name} onClick={() => setSelectedIds([item.id])}><span aria-hidden="true">{item.type === 'text' ? 'T' : item.type === 'image' ? '▧' : '◇'}</span>{item.name}</button>
          <button type="button" title={item.visible ? 'Hide layer' : 'Show layer'} aria-label={item.visible ? 'Hide layer' : 'Show layer'} aria-pressed={!item.visible} onClick={() => updateElement(item.id, { visible: !item.visible })}><Icon name={item.visible ? 'eye' : 'eye-off'}/></button>
          <button type="button" title={item.locked ? 'Unlock layer' : 'Lock layer'} aria-label={item.locked ? 'Unlock layer' : 'Lock layer'} aria-pressed={item.locked} onClick={() => updateElement(item.id, { locked: !item.locked })}><Icon name={item.locked ? 'lock' : 'unlock'}/></button>
        </div>)}</div>}
        {tool === 'pages' && <div className={styles.pageTools}>
          <button type="button" onClick={addPage}><Icon name="plus"/>Add page</button><button type="button" onClick={duplicatePage}><Icon name="copy"/>Duplicate page</button><button type="button" disabled={project.pages.length <= 1} onClick={deletePage}><Icon name="trash"/>Delete page</button>
          <label className={styles.panelField}>Selected scene duration · {page.durationSeconds}s<input aria-label="Selected scene duration" type="number" min="1" max="60" step="0.5" value={page.durationSeconds} onChange={event=>replacePage({...page,durationSeconds:Math.max(1,Math.min(60,Number(event.target.value)))})}/></label>
          {project.pages.map((item, index) => <div className={styles.pageTransitionRow} key={item.id}>
            <div className={styles.pageTitleControl}><button type="button" className={item.id === page.id ? styles.pageToolActive : styles.pageTool} onClick={() => { mutate((current) => ({ ...current, selectedPageId: item.id }), false); setSelectedIds([]); }}>{index + 1}</button>
              <input aria-label={'Page ' + (index + 1) + ' name'} value={item.name} onChange={(event) => mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) }), false)}/>
            </div>
            <select aria-label={'Transition after page ' + (index + 1)} value={item.transitionAfter ?? 'cut'} onChange={(event) => mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === item.id ? { ...entry, transitionAfter: event.target.value as 'cut' | 'fade' } : entry) }))}><option value="cut">Cut</option><option value="fade">Fade</option></select>
            {item.transitionAfter === 'fade' && <label className={styles.transitionDuration}>Fade (s)<input aria-label={'Fade duration after page ' + (index + 1)} type="number" min="0.1" max="5" step="0.1" value={item.transitionDurationSeconds ?? 0.5} onChange={(event) => mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === item.id ? { ...entry, transitionDurationSeconds: Math.max(0.1, Math.min(5, Number(event.target.value))) } : entry) }))}/></label>}
          </div>)}
        </div>}
        {tool === 'resize' && <div className={styles.resizePanel}>
          {SIZE_PRESETS.map((preset) => <div className={styles.resizePreset} key={preset.id}>
            <button type="button" className={styles.resizePresetMain} onClick={() => applyPreset(preset)}><span>{preset.platform}</span><strong>{preset.label}</strong><small>{preset.width} × {preset.height}</small></button>
            <button type="button" className={styles.resizeVariantButton} aria-label={'Create variant ' + preset.width + ' by ' + preset.height} onClick={() => createSizeVariant(preset)}><Icon name="copy"/> Variant</button>
          </div>)}
          <div className={styles.customDimensions}><input aria-label="Custom width" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} inputMode="numeric"/><span>×</span><input aria-label="Custom height" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} inputMode="numeric"/><button type="button" onClick={applyCustomSize}>Apply</button><button type="button" onClick={() => { const width = Number(customWidth), height = Number(customHeight); if (width >= 100 && height >= 100 && width <= 6000 && height <= 6000) createSizeVariant({ id: 'custom', label: 'Custom variant', platform: 'Custom', width, height, group: 'Custom' }); else onNotify('Enter dimensions between 100 and 6000 pixels.'); }}>+</button></div>
        </div>}
      </aside>}
      <main className={styles.canvasWorkspace}>
        <div className={styles.contextToolbar}>
          <button type="button" title="Fit page" aria-label="Fit page" onClick={() => setZoom(80)}><Icon name="resize"/></button>
          <button type="button" title={canvasFullscreen ? 'Exit fullscreen canvas' : 'Fullscreen canvas'} aria-label={canvasFullscreen ? 'Exit fullscreen canvas' : 'Fullscreen canvas'} aria-pressed={canvasFullscreen} onClick={toggleCanvasFullscreen}><Icon name="expand"/></button>
          <button type="button" title="Show / hide guides" aria-label="Show / hide guides" aria-pressed={showGuides} onClick={() => setShowGuides((value) => !value)}><Icon name="align"/></button>
          <span className={styles.toolbarDivider}/>
          {one && <>
            <label className={styles.colourControl}><span>{one.type === 'text' ? 'Text colour' : 'Fill'}</span><input aria-label={one.type === 'text' ? 'Text colour' : 'Element fill'} disabled={one.locked} type="color" value={one.fill} onChange={(event) => updateElement(one.id, { fill: event.target.value })}/></label>
            {one.type === 'text' && <div className={styles.colourSwatches} aria-label="Text colour swatches">{['#ffffff','#172033','#f97316','#facc15','#ef4444'].map((colour) => <button key={colour} type="button" className={styles.colourSwatch} style={{background:colour}} title={colour} aria-label={'Set text colour ' + colour} aria-pressed={one.fill.toLowerCase() === colour} disabled={one.locked} onClick={() => updateElement(one.id,{fill:colour})}/>)}</div>}
            {one.type === 'text' && <>
              <select disabled={one.locked} aria-label="Font family" value={one.fontFamily} onChange={(event) => updateElement(one.id, { fontFamily: event.target.value })}><option>Arial</option><option>Georgia</option><option>Verdana</option><option>Tahoma</option><option>Trebuchet MS</option><option>Impact</option><option>Courier New</option></select>
              <input disabled={one.locked} aria-label="Font size" type="number" min="8" max="500" value={one.fontSize} onChange={(event) => updateElement(one.id, { fontSize: Number(event.target.value) })}/>
              <label className={styles.typographyControl}><span>Spacing</span><input disabled={one.locked} aria-label="Letter spacing" type="number" min="-10" max="50" step="0.5" value={one.letterSpacing ?? 0} onChange={(event) => updateElement(one.id,{letterSpacing:Number(event.target.value)})}/></label>
              <select disabled={one.locked} aria-label="Text alignment" value={one.align} onChange={(event) => updateElement(one.id, { align: event.target.value as StudioElement['align'] })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select>
              <button type="button" title="Bold" aria-label="Bold" disabled={one.locked} aria-pressed={one.fontWeight === '800'} onClick={() => updateElement(one.id, { fontWeight: one.fontWeight === '800' ? '400' : '800' })}><b>B</b></button>
              <button type="button" title="Italic" aria-label="Italic" disabled={one.locked} aria-pressed={one.italic} onClick={() => updateElement(one.id, { italic: !one.italic })}><i>I</i></button>
            </>}
            <input disabled={one.locked} aria-label="Opacity" type="range" min="0" max="100" value={Math.round(one.opacity * 100)} onChange={(event) => updateElement(one.id, { opacity: Number(event.target.value) / 100 })}/>
            <button type="button" title="Duplicate" aria-label="Duplicate" disabled={!!one?.locked} onClick={duplicateSelected}><Icon name="copy"/></button>
            <button type="button" title="Group selected" aria-label="Group selected" disabled={selectedIds.length < 2 || !!one?.locked} onClick={groupSelected}><Icon name="group"/></button>
            <button type="button" title="Ungroup" aria-label="Ungroup" disabled={!!one?.locked} onClick={ungroupSelected}><Icon name="layers"/></button>
            <button type="button" title="Delete" aria-label="Delete selected" disabled={!!one?.locked} onClick={deleteSelected}><Icon name="trash"/></button>
          </>}
          {selected.length > 1 && <div className={styles.alignControls}>
            {(['left','center','right','top','middle','bottom'] as const).map((value) => <button type="button" key={value} title={'Align ' + value} aria-label={'Align ' + value} onClick={() => alignSelected(value)}><Icon name="align"/></button>)}
          </div>}
          <span className={styles.toolbarDivider}/>
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((v) => Math.max(20, v - 10))}><Icon name="minus"/></button>
          <span className={styles.zoomValue}>{zoom}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((v) => Math.min(200, v + 10))}><Icon name="plus"/></button>
          
        </div>
        <div ref={canvasViewportRef} className={styles.canvasViewport} onPointerUp={endPointer} onPointerCancel={endPointer}>
          <canvas ref={timelineCanvasRef} className={styles.timelinePreviewCanvas} aria-label="Timeline preview" style={{display:timelinePreviewVisible?'block':'none'}}/>
          <svg ref={svgRef} className={styles.designCanvas} style={{display:timelinePreviewVisible?'none':'block'}} viewBox={`${page.width * (1 - 100 / zoom) / 2} ${page.height * (1 - 100 / zoom) / 2} ${page.width * 100 / zoom} ${page.height * 100 / zoom}`}
            role="img" aria-label="Editable design canvas" onPointerMove={movePointer} onPointerUp={endPointer}>
            <rect x="0" y="0" width={page.width} height={page.height} fill={page.background}/>
            {page.elements.filter((item) => item.visible).map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y})`} opacity={item.opacity} tabIndex={0} role="button" aria-label={'Select ' + item.name + (item.locked ? ', locked' : '')} onFocus={() => setSelectedIds([item.id])}
              onPointerDown={(event) => { event.stopPropagation(); selectObject(event, item.id); }}>
              {elementSvg(item, item.resourceId ? urls[item.resourceId] : undefined)}
            </g>)}
            {selected.filter((item) => !item.locked).map((item) => <g key={'select-' + item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width / 2} ${item.height / 2})`} pointerEvents="none">
              <rect x="-2" y="-2" width={item.width + 4} height={item.height + 4} fill="none" stroke="#1685ff" strokeWidth={3} strokeDasharray="9 5" vectorEffect="non-scaling-stroke"/>
              <g pointerEvents="auto">{(['nw','n','ne','e','se','s','sw','w'] as const).map((handle) => {
                const x = handle.includes('w') ? 0 : handle.includes('e') ? item.width : item.width / 2;
                const y = handle.includes('n') ? 0 : handle.includes('s') ? item.height : item.height / 2;
                return <circle key={handle} cx={x} cy={y} r={9} fill="#fff" stroke="#1685ff" strokeWidth={3} vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => startHandle(event, 'resize', handle, item)}/>;
              })}
              <circle cx={item.width / 2} cy="-30" r="8" fill="#fff" stroke="#1685ff" strokeWidth={3} vectorEffect="non-scaling-stroke" onPointerDown={(event) => startHandle(event, 'rotate', 'rotate', item)}/>
              </g>
            </g>)}
            {showGuides && <g pointerEvents="none" opacity=".8"><rect x={page.width * .05} y={page.height * .05} width={page.width * .9} height={page.height * .9} fill="none" stroke="#94a3b8" strokeDasharray="8 10" strokeWidth={2}/></g>}
            {snapGuides.x && <line x1={snapGuides.x} x2={snapGuides.x} y1="0" y2={page.height} stroke="#17a5df" strokeWidth="2" strokeDasharray="10 7"/>}
            {snapGuides.y && <line y1={snapGuides.y} y2={snapGuides.y} x1="0" x2={page.width} stroke="#17a5df" strokeWidth="2" strokeDasharray="10 7"/>}
          </svg>
        </div>
        <div className={styles.timeline}>
          <div className={styles.timelinePlaybackControls}>
            <button type="button" aria-label={timelinePlaying?'Pause timeline preview':'Play timeline preview'} disabled={exporting||totalSceneDuration<=0} onClick={toggleTimelinePlayback}><Icon name={timelinePlaying?'minus':'play'}/></button>
            <input aria-label="Timeline playhead" type="range" min="0" max={Math.max(1,totalSceneDuration)} step="0.1" value={Math.min(timelineTime,totalSceneDuration)} onChange={event=>seekTimeline(Number(event.target.value))}/>
            <strong>{formatTime(timelineTime)} / {formatTime(totalSceneDuration)}</strong>
            {timelinePreviewVisible&&<button type="button" aria-label="Exit timeline preview" onClick={()=>{setTimelinePlaying(false);audioPlayerRef.current?.pause();setTimelinePreviewVisible(false);}}><Icon name="close"/></button>}
          </div>
          <div className={styles.timelinePages}>{project.pages.map((item,index)=><button type="button" key={item.id} title={item.name+' · '+item.durationSeconds+' seconds'} className={item.id===page.id?styles.timelinePageActive:styles.timelinePage} style={{width:Math.max(88,Math.min(220,item.durationSeconds*18))}} onClick={()=>{setTimelinePlaying(false);audioPlayerRef.current?.pause();setTimelinePreviewVisible(false);mutate(current=>({...current,selectedPageId:item.id}),false);setSelectedIds([]);}}><span>{index+1}</span><small>{item.name}</small><em>{item.durationSeconds}s · {item.elements.length} items</em></button>)}<button type="button" title="Add page" aria-label="Add page" onClick={addPage}><Icon name="plus"/></button></div>
          <div className={styles.videoClipLane}>
            <span className={styles.videoClipLaneLabel}><Icon name="video"/> Video clips</span>
            <div ref={timelineClipTrackRef} className={styles.videoClipTrack} onPointerMove={moveTimelineClipDrag} onPointerUp={endTimelineClipDrag} onPointerCancel={endTimelineClipDrag}>
              {project.pages.flatMap((scene,sceneIndex)=>scene.elements.filter(element=>element.type==='video').map(clip=>{
                const offset=project.pages.slice(0,sceneIndex).reduce((sum,item)=>sum+item.durationSeconds,0);
                const effectiveStart=timelineClipPreview?.clipId===clip.id?timelineClipPreview.startSeconds:(clip.startSeconds??0);
                const effectiveDuration=timelineClipPreview?.clipId===clip.id?timelineClipPreview.durationSeconds:(clip.durationSeconds??scene.durationSeconds);
                const clipStart=offset+effectiveStart;
                const clipDuration=Math.max(0,Math.min(effectiveDuration,scene.durationSeconds-effectiveStart));
                return <div key={clip.id} role="group" aria-label={'Video timeline clip '+clip.name} className={styles.videoClipItem}
                  style={{left:clipStart/Math.max(1,totalSceneDuration)*100+'%',width:Math.max(2,clipDuration/Math.max(1,totalSceneDuration)*100)+'%'}}>
                  <button type="button" className={selectedIds.includes(clip.id)?styles.videoClipActive:styles.videoClip}
                    title={clip.name+' · '+formatTime(clipStart)+' – '+formatTime(clipStart+clipDuration)}
                    aria-label={'Select timeline video clip '+clip.name}
                    onPointerDown={event=>beginTimelineClipDrag(event,scene,clip,'move')}
                    onClick={()=>selectTimelineVideoClip(scene,clip)}><Icon name="video"/><span>{clip.name}</span></button>
                  <button type="button" className={styles.videoClipTrimHandle+' '+styles.videoClipTrimStart}
                    aria-label={'Trim start of '+clip.name} title="Drag to trim clip start"
                    onPointerDown={event=>beginTimelineClipDrag(event,scene,clip,'start')}
                    onClick={()=>selectTimelineVideoClip(scene,clip)}/>
                  <button type="button" className={styles.videoClipTrimHandle+' '+styles.videoClipTrimEnd}
                    aria-label={'Trim end of '+clip.name} title="Drag to trim clip end"
                    onPointerDown={event=>beginTimelineClipDrag(event,scene,clip,'end')}
                    onClick={()=>selectTimelineVideoClip(scene,clip)}/>
                </div>;
              }))}
            </div>
          </div>
          <div className={styles.timelineTrack}>
            <span><Icon name="audio"/></span><div className={styles.audioLane}>{selectedAudioResource?selectedAudioResource.name:'No soundtrack selected'}<small>{selectedAudioResource?formatTime(audioPreviewTime)+' / '+formatTime(audioTrackDuration)+(audioPlaying?' · Playing':''):formatTime(totalSceneDuration)+' total'}</small></div>
            {renderedPhoto&&<button type="button" title="Preview rendered photo" aria-label="Preview rendered photo" onClick={()=>setPhotoPreviewOpen(true)}><Icon name="image"/></button>}
            {renderedVideo&&<button type="button" title="Preview rendered video" aria-label="Preview rendered video" onClick={()=>setVideoPreviewOpen(true)}><Icon name="video"/></button>}
            {selectedAudioResource&&<audio ref={audioPlayerRef} src={urls[selectedAudioResource.id]} preload="metadata" onLoadedMetadata={event=>{const duration=Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:125,safeStart=Math.min(project.audioStartSeconds,Math.max(0,duration-.1)),safeLength=Math.max(.1,Math.min(project.audioDurationSeconds??30,duration-safeStart,totalSceneDuration||.1));if(safeStart!==project.audioStartSeconds||safeLength!==(project.audioDurationSeconds??30))changeProject({...project,audioStartSeconds:safeStart,audioDurationSeconds:safeLength});setAudioTrackDuration(duration);setAudioPreviewTime(safeStart);event.currentTarget.currentTime=safeStart;}} onTimeUpdate={updateAudioPlayback} onPlay={()=>setAudioPlaying(true)} onPause={()=>setAudioPlaying(false)}/>}
          </div>
          <div className={styles.audioTimelineControls}>{selectedAudioResource?<><span className={styles.audioRangeTime}>{formatTime(project.audioStartSeconds)} – {formatTime(project.audioStartSeconds+audioClipLength)}</span>
            <div ref={audioRangeTrackRef} className={styles.audioRangeTrack} role="group" aria-label="Audio trim range" onPointerDown={event=>beginAudioRangeDrag(event,'auto')} onPointerMove={moveAudioRange} onPointerUp={endAudioRangeDrag} onPointerCancel={endAudioRangeDrag}>
              <span className={styles.audioRangeTrackBase}/><span className={styles.audioRangeSelection} style={{left:project.audioStartSeconds/audioTrackDuration*100+'%',width:audioClipLength/audioTrackDuration*100+'%'}} onPointerDown={event=>beginAudioRangeDrag(event,'move')}/>
              <button type="button" className={styles.audioRangeHandle} style={{left:project.audioStartSeconds/audioTrackDuration*100+'%'}} aria-label="Audio trim start" onPointerDown={event=>beginAudioRangeDrag(event,'start')}/>
              <button type="button" className={styles.audioRangeHandle} style={{left:(project.audioStartSeconds+audioClipLength)/audioTrackDuration*100+'%'}} aria-label="Audio trim end" onPointerDown={event=>beginAudioRangeDrag(event,'end')}/>
            </div><span className={styles.audioRangeDuration}>{audioClipLength.toFixed(1)}s</span></>:<span className={styles.audioRangeEmpty}>Add an audio track to trim it here.</span>}</div>
        </div>
      </main>
      {tool === 'audio' && selectedAudioResource && <aside className={styles.inspector}>
        <div className={styles.toolPanelHeading}><strong>Audio properties</strong></div>
        <div className={styles.audioInspectorTrack}><Icon name="audio"/><span>{selectedAudioResource.name}</span></div>
        <label>Start position · {formatTime(project.audioStartSeconds)}<input aria-label="Audio start position" type="number" min="0" max={Math.max(0,audioTrackDuration-.1)} step="0.1" value={Number(project.audioStartSeconds.toFixed(1))} onChange={event=>setAudioRange(Number(event.target.value),project.audioStartSeconds+audioClipLength-Number(event.target.value))}/></label>
        <label>End position · {formatTime(project.audioStartSeconds+audioClipLength)}<input aria-label="Audio end position" type="number" min={project.audioStartSeconds+.1} max={Math.min(audioTrackDuration,totalSceneDuration+project.audioStartSeconds)} step="0.1" value={Number((project.audioStartSeconds+audioClipLength).toFixed(1))} onChange={event=>setAudioRange(project.audioStartSeconds,Number(event.target.value)-project.audioStartSeconds)}/></label>
        <div className={styles.audioRangeSummary}>Duration · {audioClipLength.toFixed(1)} seconds</div>
        <label>Volume · {project.audioVolume}%<input aria-label="Audio volume" type="range" min="0" max="100" value={project.audioVolume} onChange={event=>changeProject({...project,audioVolume:Number(event.target.value)})}/></label>
        <label>Fade in · {project.audioFadeInSeconds??0}s<input aria-label="Audio fade in" type="range" min="0" max={Math.min(10,audioClipLength)} step="0.1" value={Math.min(project.audioFadeInSeconds??0,audioClipLength)} onChange={event=>changeProject({...project,audioFadeInSeconds:Number(event.target.value)})}/></label>
        <label>Fade out · {project.audioFadeOutSeconds??0}s<input aria-label="Audio fade out" type="range" min="0" max={Math.min(10,audioClipLength)} step="0.1" value={Math.min(project.audioFadeOutSeconds??0,audioClipLength)} onChange={event=>changeProject({...project,audioFadeOutSeconds:Number(event.target.value)})}/></label>
      </aside>}
      {selected.length > 0 && <aside className={styles.inspector}>
        <div className={styles.toolPanelHeading}><strong>{selected.length === 1 ? one?.name : selected.length + ' selected'}</strong><button type="button" aria-label="Close properties" onClick={() => setSelectedIds([])}><Icon name="close"/></button></div>
        {one?.locked && <div className={styles.lockNotice}>This layer is locked. Unlock it in Layers to edit.</div>}
        {one?.type === 'text' && <label>Text<textarea disabled={one.locked} value={one.text} onChange={(event) => updateElement(one.id, { text: event.target.value })}/></label>}
        {one?.type === 'image' && <label>Image fit<select disabled={one.locked} aria-label="Image fit" value={one.imageFit ?? 'cover'} onChange={(event) => updateElement(one.id, { imageFit: event.target.value as 'cover' | 'contain' })}><option value="cover">Cover / crop</option><option value="contain">Contain / fit</option></select></label>}
         {one?.type === 'video' && <><div className={styles.videoClipInspectorTitle}>Video clip · {resources.find(resource => resource.id === one.resourceId)?.name ?? one.name}</div>
           <label>Clip start · {formatTime(one.startSeconds ?? 0)}<input aria-label="Video clip start" disabled={one.locked} type="number" min="0" max={Math.max(0,page.durationSeconds-1)} step="0.1" value={Number((one.startSeconds ?? 0).toFixed(1))} onChange={event => updateElement(one.id,{startSeconds:Math.max(0,Math.min(page.durationSeconds-1,Number(event.target.value)))})}/></label>
           <label>Clip duration · {formatTime(one.durationSeconds ?? page.durationSeconds)}<input aria-label="Video clip duration" disabled={one.locked} type="number" min="0.1" max={Math.max(0.1,Math.min(page.durationSeconds-(one.startSeconds ?? 0),(videoElementsRef.current[one.id]?.duration??page.durationSeconds)-(one.sourceStartSeconds??0)))} step="0.1" value={Number((one.durationSeconds ?? page.durationSeconds).toFixed(1))} onChange={event => updateElement(one.id,{durationSeconds:Math.max(0.1,Math.min(page.durationSeconds-(one.startSeconds ?? 0),(videoElementsRef.current[one.id]?.duration??page.durationSeconds)-(one.sourceStartSeconds??0),Number(event.target.value)))})}/></label>
           <label>Source in-point · {formatTime(one.sourceStartSeconds ?? 0)}<input aria-label="Video source in point" disabled={one.locked} type="number" min="0" max={Math.max(0,(videoElementsRef.current[one.id]?.duration??86400)-(one.durationSeconds??page.durationSeconds))} step="0.1" value={Number((one.sourceStartSeconds ?? 0).toFixed(1))} onChange={event => updateElement(one.id,{sourceStartSeconds:Math.max(0,Math.min(Math.max(0,(videoElementsRef.current[one.id]?.duration??86400)-(one.durationSeconds??page.durationSeconds)),Number(event.target.value)))})}/></label></>}
        <label>X<input disabled={one?.locked} type="number" value={Math.round(one?.x ?? 0)} onChange={(event) => one && updateElement(one.id, { x: Number(event.target.value) })}/></label>
        <label>Y<input disabled={one?.locked} type="number" value={Math.round(one?.y ?? 0)} onChange={(event) => one && updateElement(one.id, { y: Number(event.target.value) })}/></label>
        <label>Width<input disabled={one?.locked} type="number" min="10" value={Math.round(one?.width ?? 0)} onChange={(event) => one && updateElement(one.id, { width: Math.max(10, Number(event.target.value)) })}/></label>
        <label>Height<input disabled={one?.locked} type="number" min="10" value={Math.round(one?.height ?? 0)} onChange={(event) => one && updateElement(one.id, { height: Math.max(10, Number(event.target.value)) })}/></label>
        <label>Rotation<input disabled={one?.locked} type="number" value={Math.round(one?.rotation ?? 0)} onChange={(event) => one && updateElement(one.id, { rotation: Number(event.target.value) })}/></label>
        <label>Opacity<input disabled={one?.locked} type="range" min="0" max="100" value={Math.round((one?.opacity ?? 1) * 100)} onChange={(event) => one && updateElement(one.id, { opacity: Number(event.target.value) / 100 })}/></label>
        <div className={styles.inspectorActions}><button type="button" onClick={() => reorderSelected(-1)}>Backward</button><button type="button" onClick={() => reorderSelected(1)}>Forward</button></div>
      </aside>}
    </div>
    <span className={styles.canvasSizeStatus} data-testid="active-page-size">{page.width} × {page.height}</span>
    {brandAssetPickerOpen && <div className={styles.previewModal} role="dialog" aria-modal="true" aria-label="Brand image picker">
      <div className={styles.previewModalCard}>
        <div className={styles.previewModalHeading}><strong>Add a brand image</strong><button type="button" aria-label="Close brand image picker" onClick={() => setBrandAssetPickerOpen(false)}><Icon name="close"/></button></div>
        <p className={styles.panelHint}>Choose an image already in your library or upload a new one. Nothing is placed on the canvas until you select it.</p>
        <div className={styles.brandAssetGrid}>
          {resources.filter(resource=>resource.kind==='image').map(resource=><button type="button" key={resource.id} className={styles.brandAssetTile} onClick={()=>{void addLibraryImage(resource);setBrandAssetPickerOpen(false);}}>
            {urls[resource.id]?<img src={urls[resource.id]} alt=""/>:<Icon name="image"/>}<span>{resource.name}</span>
          </button>)}
          <label className={styles.brandAssetUpload}><Icon name="upload"/><span>Upload new image</span>
            <input ref={logoInputRef} type="file" accept="image/jpeg,image/png" aria-label="Upload brand logo or image" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void(async()=>{try{const resource=await saveResource(file,file.name,'image');await onResourceAdded(resource);await addLibraryImage(resource);setBrandAssetPickerOpen(false);onNotify('Brand image added to the canvas and saved in the resource library.');}catch(cause){onNotify(cause instanceof Error?cause.message:'Brand image could not be added.');}})();}}/>
          </label>
          {!resources.some(resource=>resource.kind==='image')&&<span className={styles.brandAssetEmpty}>No saved images yet. Upload your first logo or image.</span>}
        </div>
      </div>
    </div>}
    {videoPreviewOpen && renderedVideo && <div className={styles.previewModal} role="dialog" aria-modal="true" aria-label="Rendered video preview"><div className={styles.previewModalCard}>
      <div className={styles.previewModalHeading}><strong>Rendered video preview</strong><button type="button" aria-label="Close video preview" onClick={() => setVideoPreviewOpen(false)}><Icon name="close"/></button></div>
      <video className={styles.outputVideo} src={renderedVideo.url} controls playsInline onLoadedMetadata={(event) => { const d=event.currentTarget.duration; if(Number.isFinite(d)) setRenderedVideo((v)=>v?{...v,duration:d}:v); }}/>
      <div className={styles.previewMeta}><span>{renderedVideo.name}</span><strong>{formatTime(renderedVideo.duration)}</strong></div>
      <button type="button" className={styles.primaryDownloadButton} onClick={() => { setVideoPreviewOpen(false); setDownloadTarget(renderedPhoto?'both':'video'); setDownloadOpen(true); }}>Download output</button>
    </div></div>}
    {photoPreviewOpen && renderedPhoto && <div className={styles.previewModal} role="dialog" aria-modal="true" aria-label="Rendered photo preview"><div className={styles.previewModalCard}>
      <div className={styles.previewModalHeading}><strong>Rendered photo preview</strong><button type="button" aria-label="Close photo preview" onClick={() => setPhotoPreviewOpen(false)}><Icon name="close"/></button></div>
      <img className={styles.outputPhoto} src={renderedPhoto.url} alt="Rendered photo output"/><div className={styles.previewMeta}><span>{renderedPhoto.name}</span><strong>Ready</strong></div>
    </div></div>}
    {downloadOpen && <div className={styles.previewModal} role="dialog" aria-modal="true" aria-label="Download rendered outputs"><div className={styles.downloadCard}>
      <div className={styles.previewModalHeading}><strong>Download outputs</strong><button type="button" aria-label="Close download dialog" onClick={() => setDownloadOpen(false)}><Icon name="close"/></button></div>
      <label>What would you like to download?<select aria-label="Output selection" value={downloadTarget} onChange={(event) => setDownloadTarget(event.target.value as 'photo'|'video'|'both')}>
        {renderedPhoto && <option value="photo">Photo only</option>}{renderedVideo && <option value="video">Video only</option>}{renderedPhoto && renderedVideo && <option value="both">Photo and video</option>}
      </select></label>
      {(downloadTarget==='photo'||downloadTarget==='both') && renderedPhoto && <label>Photo format<select aria-label="Photo format" value={downloadPhotoFormat} onChange={(event) => setDownloadPhotoFormat(event.target.value as 'png'|'jpg')}><option value="png">PNG</option><option value="jpg">JPEG</option></select></label>}
      {(downloadTarget==='video'||downloadTarget==='both') && renderedVideo && <label>Video format<select aria-label="Video format" disabled><option>{renderedVideo.name.split('.').pop()?.toUpperCase()} · Original</option></select></label>}
      <button type="button" className={styles.primaryDownloadButton} disabled={downloadBusy} onClick={() => void downloadOutputs()}><Icon name="download"/> Download selected</button>
      <p>The editor stays open. Your browser manages the final file transfer.</p>
    </div></div>}
    {exporting && <div className={styles.exportingOverlay}><div><Icon name="video"/> {renderStage==='preparing'?'Preparing':renderStage==='saving'?'Saving to library':'Rendering'} · {renderProgress}%<div className={styles.renderProgress}><div style={{width:renderProgress+'%'}}/></div>{canCancelRender&&<button type="button" onClick={()=>cancelRenderRef.current?.()}>Cancel render</button>}</div></div>}
  </div>;
}

async function getWorkspaceDirectoryName() { return persistHandleName(); }
