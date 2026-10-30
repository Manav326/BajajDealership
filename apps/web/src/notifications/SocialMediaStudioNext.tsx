import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import SocialWhatsAppWorkspace from './SocialWhatsAppWorkspace';
import { apiFetch } from './apiClient';
import { ARTWORK_TEMPLATES, STARTER_ARTWORK_ASSETS } from './artworkAssets';
import { STARTER_MUSIC_CATALOG } from './artworkMusic';
import {
  chooseWorkspaceDirectory, downloadBlob, getWorkspacePermission, listProjects, listResources,
  removeProject, removeResource, requestSavedFolderPermission, saveExport,
  saveProject, saveResource, supportsLocalDirectoryAccess,
  type StudioElement, type StudioPage, type StudioProject, type StudioResource, type StudioResourceKind,
} from './socialStudioLocalStore';
import styles from './SocialMediaStudioNext.module.css';

type Tool = 'templates' | 'elements' | 'text' | 'uploads' | 'brand' | 'audio' | 'layers' | 'pages' | 'resize';
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
  id: randomId(), name, width, height, durationSeconds: 5, background: '#15213a', elements: [],
});
const newProject = (): StudioProject => {
  const page = defaultPage();
  return {
    id: randomId(), name: 'Untitled design', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    pages: [page], selectedPageId: page.id, selectedAudioId: null, audioStartSeconds: 0, audioVolume: 80,
    caption: '', hashtags: '#LuckyBajaj #Bajaj', primaryColor: '#15213a', accentColor: '#f97316',
  };
};
const element = (type: StudioElement['type'], x = 250, y = 240): StudioElement => ({
  id: randomId(), type, name: type === 'text' ? 'Text' : type === 'image' ? 'Image' : type === 'line' ? 'Line' : 'Shape',
  x, y, width: type === 'text' ? 470 : type === 'line' ? 360 : 280, height: type === 'text' ? 120 : type === 'line' ? 8 : 180,
  rotation: 0, opacity: 1, fill: type === 'text' ? '#ffffff' : '#f97316', stroke: 'transparent', strokeWidth: 0,
  text: type === 'text' ? 'Your text here' : '', fontSize: 76, fontFamily: 'Arial', fontWeight: '700',
  italic: false, align: 'left', visible: true, locked: false,
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
    check: 'm5 12 4 4L19 6', group: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm-12 10a8 8 0 0 1 16 0M18 8a3 3 0 0 1 0 6m1 3a6 6 0 0 1 3 2',
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
  if (type === 'line') { next.width = page.width * .5; next.height = 2; }
  return next;
}

function elementSvg(item: StudioElement, url?: string) {
  const common = { opacity: item.opacity, transform: `rotate(${item.rotation} ${item.width / 2} ${item.height / 2})` };
  if (item.type === 'text') {
    return <text x={0} y={item.fontSize} fill={item.fill} textAnchor={item.align === 'left' ? 'start' : item.align === 'center' ? 'middle' : 'end'}
      fontSize={item.fontSize} fontFamily={item.fontFamily} fontWeight={item.fontWeight} fontStyle={item.italic ? 'italic' : 'normal'}
      transform={common.transform} opacity={common.opacity}>
      {item.text.split('\n').slice(0, 8).map((line, index) => <tspan key={index} x={item.align === 'left' ? 0 : item.align === 'center' ? item.width / 2 : item.width} dy={index === 0 ? 0 : item.fontSize * 1.2}>{line}</tspan>)}
    </text>;
  }
  if (item.type === 'image') return url
    ? <image href={url} x={0} y={0} width={item.width} height={item.height} preserveAspectRatio="xMidYMid slice" transform={common.transform} opacity={common.opacity} />
    : <rect x={0} y={0} width={item.width} height={item.height} fill="#94a3b8" opacity=".35" />;
  if (item.type === 'circle') return <ellipse cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} transform={common.transform} opacity={common.opacity} />;
  if (item.type === 'line') return <line x1={0} y1={item.height / 2} x2={item.width} y2={item.height / 2} stroke={item.fill} strokeWidth={Math.max(2, item.strokeWidth || item.height)} transform={common.transform} opacity={common.opacity} />;
  return <rect x={0} y={0} width={item.width} height={item.height} rx={12} fill={item.fill} stroke={item.stroke} strokeWidth={item.strokeWidth} transform={common.transform} opacity={common.opacity} />;
}

function makeSvg(page: StudioPage, resourceUrls: Record<string, string>, includeGuides = false): string {
  const content = page.elements.filter((item) => item.visible).map((item) => {
    const url = item.resourceId ? resourceUrls[item.resourceId] : undefined;
    let shape = '';
    if (item.type === 'text') {
      const lines = item.text.split('\n').slice(0, 8);
      shape = '<text x="0" y="' + item.fontSize + '" fill="' + item.fill + '" font-family="' + item.fontFamily + '" font-size="' + item.fontSize + '" font-weight="' + item.fontWeight + '" font-style="' + (item.italic ? 'italic' : 'normal') + '" text-anchor="' + (item.align === 'left' ? 'start' : item.align === 'center' ? 'middle' : 'end') + '">' + lines.map((line, i) => '<tspan x="' + (item.align === 'left' ? 0 : item.align === 'center' ? item.width / 2 : item.width) + '" dy="' + (i ? item.fontSize * 1.2 : 0) + '">' + escapeSvg(line) + '</tspan>').join('') + '</text>';
    } else if (item.type === 'image' && url) shape = '<image href="' + url + '" width="' + item.width + '" height="' + item.height + '" preserveAspectRatio="xMidYMid slice"/>';
    else if (item.type === 'circle') shape = '<ellipse cx="' + item.width / 2 + '" cy="' + item.height / 2 + '" rx="' + item.width / 2 + '" ry="' + item.height / 2 + '" fill="' + item.fill + '"/>';
    else if (item.type === 'line') shape = '<line x1="0" y1="' + item.height / 2 + '" x2="' + item.width + '" y2="' + item.height / 2 + '" stroke="' + item.fill + '" stroke-width="' + Math.max(2, item.strokeWidth || item.height) + '"/>';
    else shape = '<rect width="' + item.width + '" height="' + item.height + '" rx="12" fill="' + item.fill + '" stroke="' + item.stroke + '" stroke-width="' + item.strokeWidth + '"/>';
    return '<g transform="translate(' + item.x + ' ' + item.y + ') rotate(' + item.rotation + ' ' + item.width / 2 + ' ' + item.height / 2 + ')" opacity="' + item.opacity + '">' + shape + '</g>';
  }).join('');
  const guides = includeGuides ? '<rect x="0" y="0" width="' + page.width + '" height="' + page.height + '" fill="none" stroke="#94a3b8" stroke-dasharray="12 8"/>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + page.width + '" height="' + page.height + '" viewBox="0 0 ' + page.width + ' ' + page.height + '"><rect width="100%" height="100%" fill="' + page.background + '"/>' + content + guides + '</svg>';
}
function escapeSvg(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] ?? char)); }

async function renderPageBlob(page: StudioPage, urls: Record<string, string>, mimeType: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const svg = new Blob([makeSvg(page, urls)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svg);
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
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The design could not be exported.')), mimeType, .94));
  } finally { URL.revokeObjectURL(url); }
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
      if (!supportsLocalDirectoryAccess()) { setDirectoryName('Browser storage'); setPermission('granted'); notify('Browser-local storage is ready.'); return; }
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
  async function saveAndClose(project: StudioProject) {
    try {
      await saveProject(project);
      setActiveProject(null);
      setEditorOpen(false);
      setHubPage('projects');
      await refreshLibrary();
      notify('Design saved.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Design could not be saved.'); }
  }
  async function saveAndOpenResources(project: StudioProject) {
    try {
      await saveProject(project);
      setActiveProject(null);
      setEditorOpen(false);
      setHubPage('resources');
      await refreshLibrary();
      notify('Design saved to the resource library.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Design could not be saved.'); }
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
          <div className={styles.resourcePreview}>{resource.kind === 'image' || resource.kind === 'export' ? <img src={resourceUrls[resource.id]} alt={resource.name}/> : <Icon name={resource.kind === 'audio' ? 'audio' : 'video'}/>}</div>
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
      onProjectChange={setActiveProject} onClose={() => void saveAndClose(activeProject)} onResourceAdded={async (resource) => { await refreshLibrary(); return resource; }}
      onNotify={notify} onOpenLibrary={() => void saveAndOpenResources(activeProject)}/>}
  </div>;
}

type MetaStatus = { configured: boolean; publishingReady: boolean; code: string; message: string; missingConfigurationKeys: string[]; missingPublishingConfigurationKeys: string[]; destinations: Array<{ publicId: string; type: string; displayName: string; username: string | null; status: string }> };
type PublishRequest = { publicId: string; assetPublicId: string; status: string; destinationType: string; destinationName: string; caption: string; requestedBy: string; approvedBy: string | null; requestedAt: string; scheduledAt: string | null; approvedAt: string | null; publishStatus: string; externalPostId: string | null; errorCode: string | null };

function StudioEditor({ project, resources, urls, onProjectChange, onClose, onResourceAdded, onNotify, onOpenLibrary }: {
  project: StudioProject; resources: StudioResource[]; urls: Record<string, string>;
  onProjectChange: (project: StudioProject) => void; onClose: () => void;
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
  const [storyTarget, setStoryTarget] = useState<StoryTarget>('whatsapp-status');
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [panelSearch, setPanelSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize' | 'rotate'; ids: string[]; start: { x: number; y: number }; items: StudioElement[]; handle?: string; center?: { x: number; y: number } } | null>(null);
  const undoRef = useRef<StudioProject[]>([]);
  const redoRef = useRef<StudioProject[]>([]);
  const saveTimer = useRef<number | null>(null);
  const page = project.pages.find((item) => item.id === project.selectedPageId) ?? project.pages[0];
  const changeProject = (next: StudioProject) => { onProjectChange(next); setDirty(true); };
  const selected = page.elements.filter((item) => selectedIds.includes(item.id));
  const one = selected.length === 1 ? selected[0] : null;

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
  const updateElement = (id: string, changes: Partial<StudioElement>, history = true) =>
    replacePage({ ...page, elements: page.elements.map((item) => item.id === id ? { ...item, ...changes } : item) }, history);
  const currentElement = (id: string) => page.elements.find((item) => item.id === id);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaving(true);
      void saveProject(project).then(() => setSaving(false)).catch((cause) => { setSaving(false); onNotify(cause instanceof Error ? cause.message : 'Autosave failed.'); });
      setDirty(false);
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
  function addObject(type: StudioElement['type']) {
    const item = makeElement(type, page);
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, item] } : entry) }));
    setSelectedIds([item.id]); setTool('elements');
  }
  function selectObject(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (currentElement(id)?.locked) { setSelectedIds([id]); return; }
    const group = currentElement(id)?.groupId;
    const ids = group ? page.elements.filter((item) => item.groupId === group).map((item) => item.id) : [id];
    const nextIds = event.shiftKey ? Array.from(new Set([...selectedIds, ...ids])) : ids;
    setSelectedIds(nextIds);
    const start = pointFromEvent(event);
    const items = page.elements.filter((item) => nextIds.includes(item.id));
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
      const moving = drag.items.map((item) => {
        let x = item.x + dx, y = item.y + dy;
        const centerX = x + item.width / 2, centerY = y + item.height / 2;
        const guides: { x?: number; y?: number } = {};
        if (Math.abs(centerX - page.width / 2) < 12) { x = page.width / 2 - item.width / 2; guides.x = page.width / 2; }
        if (Math.abs(centerY - page.height / 2) < 12) { y = page.height / 2 - item.height / 2; guides.y = page.height / 2; }
        return { ...item, x, y };
      });
      const guides = moving.reduce((acc, item) => {
        if (Math.abs(item.x + item.width / 2 - page.width / 2) < 1) acc.x = page.width / 2;
        if (Math.abs(item.y + item.height / 2 - page.height / 2) < 1) acc.y = page.height / 2;
        return acc;
      }, {} as { x?: number; y?: number });
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
    const ids = new Set(selectedIds);
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.filter((item) => !ids.has(item.id)) } : entry) }));
    setSelectedIds([]);
  }
  function duplicateSelected() {
    if (!selectedIds.length) return;
    const copies = page.elements.filter((item) => selectedIds.includes(item.id)).map((item) => ({ ...clone(item), id: randomId(), name: item.name + ' copy', x: item.x + 24, y: item.y + 24, groupId: undefined }));
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, ...copies] } : entry) }));
    setSelectedIds(copies.map((item) => item.id));
  }
  function groupSelected() {
    if (selectedIds.length < 2) return;
    const groupId = randomId();
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.map((item) => selectedIds.includes(item.id) ? { ...item, groupId } : item) } : entry) }));
  }
  function ungroupSelected() {
    const groupIds = new Set(selected.map((item) => item.groupId).filter(Boolean));
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: entry.elements.map((item) => groupIds.has(item.groupId) ? { ...item, groupId: undefined } : item) } : entry) }));
  }
  function alignSelected(position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    if (!selected.length) return;
    mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id !== page.id ? entry : {
      ...entry, elements: entry.elements.map((item) => {
        if (!selectedIds.includes(item.id)) return item;
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
    const indexes = page.elements.map((item, index) => selectedIds.includes(item.id) ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) return;
    const from = direction > 0 ? Math.max(...indexes) : Math.min(...indexes);
    const to = from + direction;
    if (to < 0 || to >= page.elements.length) return;
    const next = [...page.elements]; [next[from], next[to]] = [next[to], next[from]];
    replacePage({ ...page, elements: next });
  }
  function addPage() {
    const next = defaultPage('Page ' + (project.pages.length + 1), page.width, page.height);
    mutate((current) => ({ ...current, pages: [...current.pages, next], selectedPageId: next.id }));
    setSelectedIds([]);
  }
  function duplicatePage() {
    const next = { ...clone(page), id: randomId(), name: 'Page ' + (project.pages.length + 1), elements: page.elements.map((item) => ({ ...clone(item), id: randomId(), groupId: item.groupId ? randomId() : undefined })) };
    mutate((current) => ({ ...current, pages: [...current.pages, next], selectedPageId: next.id }));
    setSelectedIds([]);
  }
  function deletePage() {
    if (project.pages.length <= 1) return;
    const nextPages = project.pages.filter((item) => item.id !== page.id);
    mutate((current) => ({ ...current, pages: nextPages, selectedPageId: nextPages[0].id }));
    setSelectedIds([]);
  }
  function applyPreset(preset: SizePreset) {
    mutate((current) => {
      const newPage = { ...page, width: preset.width, height: preset.height, name: preset.label };
      return { ...current, pages: current.pages.map((item) => item.id === page.id ? newPage : item) };
    });
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
    const resource = await saveResource(file, file.name, kind);
    await onResourceAdded(resource);
    onNotify('Resource saved to the local library.');
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
  async function exportImage(mime: 'image/png' | 'image/jpeg') {
    setExporting(true);
    try {
      const blob = await renderPageBlob(page, urls, mime);
      const extension = mime === 'image/png' ? 'png' : 'jpg';
      const filename = slug(project.name) + '-' + slug(page.name) + '.' + extension;
      await saveExport(blob, filename, 'image');
      const resource = await saveResource(blob, filename, 'export');
      await onResourceAdded(resource);
      downloadBlob(blob, filename);
      onNotify('Export saved to the resource library and downloaded.');
    } catch (cause) { onNotify(cause instanceof Error ? cause.message : 'Image export failed.'); }
    finally { setExporting(false); }
  }

  async function exportVideo() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      onNotify('This browser cannot record canvas video. Use current Chrome or Edge.');
      return;
    }
    const maxDuration = storyTarget === 'whatsapp-status' ? 90 : storyTarget === 'social-reel' ? 120 : 60;
    const totalDuration = project.pages.reduce((sum, item) => sum + item.durationSeconds, 0);
    if (totalDuration > maxDuration) { onNotify('This destination supports up to ' + maxDuration + ' seconds. Shorten the scene timeline first.'); return; }
    setExporting(true);
    let recorder: MediaRecorder | null = null;
    let context: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    let frameId = 0;
      try {
      const frames = await Promise.all(project.pages.map(async (item) => {
        const blob = new Blob([makeSvg(item, urls)], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const image = new Image(); image.src = url; await image.decode();
        return { image, url, duration: Math.max(1, item.durationSeconds) };
      }));
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Video render canvas is unavailable.');
      const stream = canvas.captureStream(30);
      const audioResource = resources.find((item) => item.id === selectedAudio);
      if (audioResource) {
        context = new AudioContext();
        const audioDestination = context.createMediaStreamDestination();
        const decoded = await context.decodeAudioData(await audioResource.blob.arrayBuffer());
        audioSource = context.createBufferSource();
        audioSource.buffer = decoded;
        const gain = context.createGain(); gain.gain.value = Math.max(0, Math.min(1, project.audioVolume / 100));
        audioSource.connect(gain); gain.connect(audioDestination); gain.connect(context.destination);
        audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
      const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'].find((value) => MediaRecorder.isTypeSupported(value));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 } : undefined);
      const parts: Blob[] = [];
      const stopped = new Promise<Blob>((resolve, reject) => {
        recorder!.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
        recorder!.onerror = () => reject(new Error('Video recording failed.'));
        recorder!.onstop = () => resolve(new Blob(parts, { type: recorder!.mimeType || 'video/webm' }));
      });
      recorder.start(250);
      if (context && audioSource) { await context.resume(); audioSource.start(0, Math.max(0, project.audioStartSeconds)); }
      const total = frames.reduce((sum, item) => sum + item.duration, 0);
      const started = performance.now();
      const draw = (now: number) => {
        const elapsed = (now - started) / 1000;
        let offset = elapsed;
        let selectedFrame = frames[frames.length - 1];
        for (const item of frames) { if (offset <= item.duration) { selectedFrame = item; break; } offset -= item.duration; }
        ctx!.fillStyle = '#101c35'; ctx!.fillRect(0, 0, canvas.width, canvas.height);
        const ratio = Math.min(canvas.width / selectedFrame.image.width, canvas.height / selectedFrame.image.height);
        const width = selectedFrame.image.width * ratio, height = selectedFrame.image.height * ratio;
        ctx!.drawImage(selectedFrame.image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        if (elapsed >= total) { recorder?.stop(); return; }
        frameId = requestAnimationFrame(draw);
      };
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        const activeRecorder = recorder!;
        const stopWatch = window.setTimeout(finish, total * 1000 + 8000);
        const originalStop = activeRecorder.onstop;
        activeRecorder.onstop = (event) => { if (originalStop) originalStop.call(activeRecorder, event); window.clearTimeout(stopWatch); finish(); };
        frameId = requestAnimationFrame(draw);
      });
      const blob = await stopped;
      if (!blob.size) throw new Error('Video export is empty.');
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const filename = slug(project.name) + '-video.' + extension;
      await saveExport(blob, filename, 'video');
      await saveResource(blob, filename, 'video');
      downloadBlob(blob, filename);
      onNotify('Video saved and downloaded (' + extension.toUpperCase() + ').');
      frames.forEach((item) => URL.revokeObjectURL(item.url));
      stream.getTracks().forEach((track) => track.stop());
    } catch (cause) {
      if (recorder?.state === 'recording') recorder.stop();
      onNotify(cause instanceof Error ? cause.message : 'Video export failed.');
    } finally {
      if (frameId) cancelAnimationFrame(frameId);
      audioSource?.stop();
      await context?.close().catch(() => undefined);
      setExporting(false);
    }
  }

  const panelTitle: Record<Tool, string> = {
    templates: 'Templates', elements: 'Elements', text: 'Text', uploads: 'Uploads', brand: 'Brand',
    audio: 'Audio', layers: 'Layers', pages: 'Pages', resize: 'Resize',
  };
  const selectedTools: Array<[Tool, string, string]> = [
    ['templates','template','Templates'], ['elements','shapes','Elements'], ['text','text','Text'],
    ['uploads','image','Uploads'], ['brand','brand','Brand'], ['audio','audio','Audio'],
    ['layers','layers','Layers'], ['pages','pages','Pages'], ['resize','resize','Resize'],
  ];

  return <div className={styles.editorOverlay} role="dialog" aria-modal="true" aria-label="Creative editor">
    <header className={styles.editorTopbar}>
      <button type="button" title="Back to resources" aria-label="Back to resources" onClick={onOpenLibrary}><Icon name="back"/></button>
      <input className={styles.projectName} aria-label="Design name" value={project.name} onChange={(event) => changeProject({ ...project, name: event.target.value })}/>
      <span className={styles.saveState} title={saving ? 'Saving' : 'Saved'}><Icon name="save"/></span>
      <button type="button" title="Undo" aria-label="Undo" disabled={!undoRef.current.length} onClick={undo}><Icon name="undo"/></button>
      <button type="button" title="Redo" aria-label="Redo" disabled={!redoRef.current.length} onClick={redo}><Icon name="redo"/></button>
      <span className={styles.topSpacer}/>
      <button type="button" title="Export PNG" aria-label="Export PNG" disabled={exporting} onClick={() => void exportImage('image/png')}><Icon name="image"/></button>
      <button type="button" title="Export JPEG" aria-label="Export JPEG" disabled={exporting} onClick={() => void exportImage('image/jpeg')}><Icon name="download"/></button>
      <button type="button" title="Export video" aria-label="Export video" disabled={exporting} onClick={() => void exportVideo()}><Icon name="video"/></button>
      <button type="button" className={styles.doneButton} onClick={onClose} title="Save and close" aria-label="Save and close"><Icon name="check"/></button>
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
          {(['rect','circle','line'] as const).map((type) => <button type="button" key={type} onClick={() => addObject(type)}><Icon name={type === 'rect' ? 'shapes' : type === 'circle' ? 'brand' : 'minus'}/>{type}</button>)}
        </div>}
        {tool === 'text' && <div className={styles.toolTiles}>
          <button type="button" onClick={() => addObject('text')}><Icon name="text"/>Add heading</button>
          <button type="button" onClick={() => { const next = makeElement('text', page); next.fontSize = 36; next.text = 'Subheading'; next.name = 'Subheading'; mutate((current) => ({ ...current, pages: current.pages.map((entry) => entry.id === page.id ? { ...entry, elements: [...entry.elements, next] } : entry) })); setSelectedIds([next.id]); }}><Icon name="text"/>Add subheading</button>
          <label className={styles.panelField}>Caption<textarea value={project.caption} onChange={(event) => changeProject({ ...project, caption: event.target.value })}/></label>
          <label className={styles.panelField}>Hashtags<input value={project.hashtags} onChange={(event) => changeProject({ ...project, hashtags: event.target.value })}/></label>
        </div>}
        {tool === 'uploads' && <div className={styles.uploadPanel}>
          <label className={styles.uploadDrop}><Icon name="upload"/><span>Import media</span><input type="file" multiple accept="image/*,audio/*,video/*" onChange={(event) => {
            const files = Array.from(event.target.files ?? []); event.target.value = '';
            void (async () => { for (const file of files) { const kind: StudioResourceKind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'export'; const resource = await saveResource(file, file.name, kind); await onResourceAdded(resource); } onNotify('Media imported.'); })();
          }}/></label>
          {resources.filter((item) => item.kind === 'image' && (item.name).toLowerCase().includes(panelSearch.toLowerCase())).map((resource) => <button type="button" key={resource.id} className={styles.libraryAsset} onClick={() => void addLibraryImage(resource)}>
            {urls[resource.id] ? <img src={urls[resource.id]} alt=""/> : <Icon name="image"/>}<span>{resource.name}</span>
          </button>)}
          {STARTER_ARTWORK_ASSETS.filter((item) => item.name.toLowerCase().includes(panelSearch.toLowerCase())).map((item) => <button type="button" key={item.id} className={styles.libraryAsset} onClick={() => void addStarterImage(item.id)}><Icon name="image"/><span>{item.name}</span></button>)}
        </div>}
        {tool === 'brand' && <div className={styles.toolTiles}>
          <label className={styles.panelField}>Primary colour<input type="color" value={project.primaryColor} onChange={(event) => changeProject({ ...project, primaryColor: event.target.value })}/></label>
          <label className={styles.panelField}>Accent colour<input type="color" value={project.accentColor} onChange={(event) => changeProject({ ...project, accentColor: event.target.value })}/></label>
          <label className={styles.panelField}>Page background<input type="color" value={page.background} onChange={(event) => replacePage({ ...page, background: event.target.value })}/></label>
          <button type="button" onClick={() => addObject('image')}><Icon name="image"/>Add logo / image</button>
        </div>}
        {tool === 'audio' && <div className={styles.audioPanel}>
          <label className={styles.uploadDrop}><Icon name="audio"/><span>Import audio</span><input type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void addUploadedFile(file, 'audio'); }}/></label>
          {resources.filter((item) => item.kind === 'audio').map((resource) => <button key={resource.id} type="button" className={selectedAudio === resource.id ? styles.audioSelected : styles.audioTrack} onClick={() => { setSelectedAudio(resource.id); changeProject({ ...project, selectedAudioId: resource.id }); }}>
            <Icon name="audio"/><span>{resource.name}</span>{selectedAudio === resource.id && <Icon name="check"/>}
          </button>)}
          <div className={styles.starterMusicList}>{STARTER_MUSIC_CATALOG.filter((track) => track.name.toLowerCase().includes(panelSearch.toLowerCase()) || track.category.toLowerCase().includes(panelSearch.toLowerCase())).map((track) => <div key={track.id}><span><strong>{track.name}</strong><small>{track.creator} · {track.category}</small></span><a href={track.sourcePage} target="_blank" rel="noreferrer">Source</a></div>)}</div>
          <label className={styles.panelField}>Start <input type="number" min="0" step=".5" value={project.audioStartSeconds} onChange={(event) => changeProject({ ...project, audioStartSeconds: Math.max(0, Number(event.target.value)) })}/></label>
          <label className={styles.panelField}>Volume <input type="range" min="0" max="100" value={project.audioVolume} onChange={(event) => changeProject({ ...project, audioVolume: Number(event.target.value) })}/></label>
          <label className={styles.panelField}>Story destination<select aria-label="Story destination" value={storyTarget} onChange={(event) => setStoryTarget(event.target.value as StoryTarget)}><option value="whatsapp-status">WhatsApp Status · 90s</option><option value="instagram-story">Instagram Story · 60s</option><option value="facebook-story">Facebook Story · 60s</option><option value="social-reel">Instagram / Facebook Reel · 120s</option></select></label>
          <label className={styles.panelField}>Scene duration <input type="number" min="1" max="60" value={page.durationSeconds} onChange={(event) => replacePage({ ...page, durationSeconds: Math.max(1, Math.min(60, Number(event.target.value))) })}/></label>
        </div>}
        {tool === 'layers' && <div className={styles.layerList}>{[...page.elements].reverse().map((item) => <div className={styles.layerRow} key={item.id} data-selected={selectedIds.includes(item.id)}>
          <button type="button" onClick={() => setSelectedIds([item.id])}><span>{item.type === 'text' ? 'T' : item.type === 'image' ? '▧' : '◇'}</span>{item.name}</button>
          <button type="button" title={item.visible ? 'Hide layer' : 'Show layer'} aria-label={item.visible ? 'Hide layer' : 'Show layer'} onClick={() => updateElement(item.id, { visible: !item.visible })}><Icon name="eye"/></button>
          <button type="button" title={item.locked ? 'Unlock' : 'Lock'} aria-label={item.locked ? 'Unlock' : 'Lock'} onClick={() => updateElement(item.id, { locked: !item.locked })}><Icon name="lock"/></button>
        </div>)}</div>}
        {tool === 'pages' && <div className={styles.pageTools}>
          <button type="button" onClick={addPage}><Icon name="plus"/>Add page</button><button type="button" onClick={duplicatePage}><Icon name="copy"/>Duplicate page</button><button type="button" disabled={project.pages.length <= 1} onClick={deletePage}><Icon name="trash"/>Delete page</button>
          {project.pages.map((item, index) => <button type="button" key={item.id} className={item.id === page.id ? styles.pageToolActive : styles.pageTool} onClick={() => { mutate((current) => ({ ...current, selectedPageId: item.id }), false); setSelectedIds([]); }}>{index + 1} · {item.name}</button>)}
        </div>}
        {tool === 'resize' && <div className={styles.resizePanel}>
          {SIZE_PRESETS.map((preset) => <button type="button" key={preset.id} onClick={() => applyPreset(preset)}><span>{preset.platform}</span><strong>{preset.label}</strong><small>{preset.width} × {preset.height}</small></button>)}
          <div className={styles.customDimensions}><input aria-label="Custom width" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} inputMode="numeric"/><span>×</span><input aria-label="Custom height" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} inputMode="numeric"/><button type="button" onClick={applyCustomSize}>Apply</button></div>
        </div>}
      </aside>}
      <main className={styles.canvasWorkspace}>
        <div className={styles.contextToolbar}>
          <button type="button" title="Fit page" aria-label="Fit page" onClick={() => setZoom(80)}><Icon name="resize"/></button>
          <button type="button" title="Show / hide guides" aria-label="Show / hide guides" aria-pressed={showGuides} onClick={() => setShowGuides((value) => !value)}><Icon name="align"/></button>
          <span className={styles.toolbarDivider}/>
          {one && <>
            <input aria-label="Element fill" type="color" value={one.fill} onChange={(event) => updateElement(one.id, { fill: event.target.value })}/>
            {one.type === 'text' && <>
              <select aria-label="Font family" value={one.fontFamily} onChange={(event) => updateElement(one.id, { fontFamily: event.target.value })}><option>Arial</option><option>Georgia</option><option>Verdana</option><option>Tahoma</option><option>Trebuchet MS</option><option>Impact</option><option>Courier New</option></select>
              <input aria-label="Font size" type="number" min="8" max="500" value={one.fontSize} onChange={(event) => updateElement(one.id, { fontSize: Number(event.target.value) })}/>
              <select aria-label="Text alignment" value={one.align} onChange={(event) => updateElement(one.id, { align: event.target.value as StudioElement['align'] })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select>
              <button type="button" title="Bold" aria-label="Bold" aria-pressed={one.fontWeight === '800'} onClick={() => updateElement(one.id, { fontWeight: one.fontWeight === '800' ? '400' : '800' })}><b>B</b></button>
              <button type="button" title="Italic" aria-label="Italic" aria-pressed={one.italic} onClick={() => updateElement(one.id, { italic: !one.italic })}><i>I</i></button>
            </>}
            <input aria-label="Opacity" type="range" min="0" max="100" value={Math.round(one.opacity * 100)} onChange={(event) => updateElement(one.id, { opacity: Number(event.target.value) / 100 })}/>
            <button type="button" title="Duplicate" aria-label="Duplicate" onClick={duplicateSelected}><Icon name="copy"/></button>
            <button type="button" title="Group selected" aria-label="Group selected" disabled={selectedIds.length < 2} onClick={groupSelected}><Icon name="group"/></button>
            <button type="button" title="Ungroup" aria-label="Ungroup" onClick={ungroupSelected}><Icon name="layers"/></button>
            <button type="button" title="Delete" aria-label="Delete selected" onClick={deleteSelected}><Icon name="trash"/></button>
          </>}
          {selected.length > 1 && <div className={styles.alignControls}>
            {(['left','center','right','top','middle','bottom'] as const).map((value) => <button type="button" key={value} title={'Align ' + value} aria-label={'Align ' + value} onClick={() => alignSelected(value)}><Icon name="align"/></button>)}
          </div>}
          <span className={styles.toolbarDivider}/>
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((v) => Math.max(20, v - 10))}><Icon name="minus"/></button>
          <span className={styles.zoomValue}>{zoom}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((v) => Math.min(200, v + 10))}><Icon name="plus"/></button>
          <button type="button" title="Open resource library" aria-label="Open resource library" onClick={onOpenLibrary}><Icon name="folder"/></button>
        </div>
        <div className={styles.canvasViewport} onPointerUp={endPointer} onPointerCancel={endPointer}>
          <svg ref={svgRef} className={styles.designCanvas} viewBox={`${page.width * (1 - 100 / zoom) / 2} ${page.height * (1 - 100 / zoom) / 2} ${page.width * 100 / zoom} ${page.height * 100 / zoom}`}
            role="img" aria-label="Editable design canvas" onPointerMove={movePointer} onPointerUp={endPointer}>
            <rect x="0" y="0" width={page.width} height={page.height} fill={page.background}/>
            {page.elements.filter((item) => item.visible).map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y})`} opacity={item.opacity}
              onPointerDown={(event) => { event.stopPropagation(); selectObject(event, item.id); }}>
              {elementSvg(item, item.resourceId ? urls[item.resourceId] : undefined)}
            </g>)}
            {selected.map((item) => <g key={'select-' + item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width / 2} ${item.height / 2})`} pointerEvents="none">
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
          <div className={styles.timelinePages}>{project.pages.map((item, index) => <button type="button" key={item.id} className={item.id === page.id ? styles.timelinePageActive : styles.timelinePage}
            onClick={() => { mutate((current) => ({ ...current, selectedPageId: item.id }), false); setSelectedIds([]); }}><span>{index + 1}</span><small>{item.name}</small></button>)}
            <button type="button" title="Add page" aria-label="Add page" onClick={addPage}><Icon name="plus"/></button></div>
          <div className={styles.timelineTrack}><span><Icon name="audio"/></span><div className={styles.audioLane}>{selectedAudio ? resources.find((item) => item.id === selectedAudio)?.name : 'No audio selected'} <small>{project.pages.reduce((sum, item) => sum + item.durationSeconds, 0)}s</small></div>
            <button type="button" title="Video export" aria-label="Video export" disabled={exporting} onClick={() => void exportVideo()}><Icon name="play"/></button></div>
        </div>
      </main>
      {selected.length > 0 && <aside className={styles.inspector}>
        <div className={styles.toolPanelHeading}><strong>{selected.length === 1 ? one?.name : selected.length + ' selected'}</strong><button type="button" aria-label="Close properties" onClick={() => setSelectedIds([])}><Icon name="close"/></button></div>
        {one?.type === 'text' && <label>Text<textarea value={one.text} onChange={(event) => updateElement(one.id, { text: event.target.value })}/></label>}
        <label>X<input type="number" value={Math.round(one?.x ?? 0)} onChange={(event) => one && updateElement(one.id, { x: Number(event.target.value) })}/></label>
        <label>Y<input type="number" value={Math.round(one?.y ?? 0)} onChange={(event) => one && updateElement(one.id, { y: Number(event.target.value) })}/></label>
        <label>Width<input type="number" min="10" value={Math.round(one?.width ?? 0)} onChange={(event) => one && updateElement(one.id, { width: Math.max(10, Number(event.target.value)) })}/></label>
        <label>Height<input type="number" min="10" value={Math.round(one?.height ?? 0)} onChange={(event) => one && updateElement(one.id, { height: Math.max(10, Number(event.target.value)) })}/></label>
        <label>Rotation<input type="number" value={Math.round(one?.rotation ?? 0)} onChange={(event) => one && updateElement(one.id, { rotation: Number(event.target.value) })}/></label>
        <label>Opacity<input type="range" min="0" max="100" value={Math.round((one?.opacity ?? 1) * 100)} onChange={(event) => one && updateElement(one.id, { opacity: Number(event.target.value) / 100 })}/></label>
        <div className={styles.inspectorActions}><button type="button" onClick={() => reorderSelected(-1)}>Backward</button><button type="button" onClick={() => reorderSelected(1)}>Forward</button></div>
      </aside>}
    </div>
    <div className={styles.editorFooter}><button type="button" onClick={() => setCaptionOpen((value) => !value)} aria-expanded={captionOpen}>Caption / hashtags</button>
      <span>{page.width} × {page.height}</span><span>{saving ? 'Saving…' : ' '}</span><button type="button" onClick={onClose}><Icon name="check"/> Done</button></div>
    {captionOpen && <div className={styles.captionPopover}><label>Caption<textarea value={project.caption} onChange={(event) => changeProject({ ...project, caption: event.target.value })}/></label><label>Hashtags<input value={project.hashtags} onChange={(event) => changeProject({ ...project, hashtags: event.target.value })}/></label></div>}
    {exporting && <div className={styles.exportingOverlay}><div><Icon name="video"/> Rendering…</div></div>}
  </div>;
}

async function getWorkspaceDirectoryName() {
  const { getWorkspaceDirectory } = await import('./socialStudioLocalStore');
  return (await getWorkspaceDirectory())?.name ?? null;
}
