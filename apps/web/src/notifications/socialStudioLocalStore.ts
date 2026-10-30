import { ARTWORK_ASSET_LIMIT, ARTWORK_ASSET_MAX_BYTES, STARTER_ARTWORK_ASSETS } from './artworkAssets';
import { ARTWORK_MUSIC_LIMIT, ARTWORK_MUSIC_LIBRARY_MAX_BYTES, ARTWORK_MUSIC_MAX_BYTES, MUSIC_CLIP_MIN_SECONDS, STARTER_MUSIC_CATALOG } from './artworkMusic';

export type StudioResourceKind = 'image' | 'audio' | 'video' | 'export';
export type StudioResource = {
  id: string;
  name: string;
  kind: StudioResourceKind;
  mimeType: string;
  size: number;
  createdAt: string;
  relativePath: string | null;
  blob: Blob;
};

export type StudioElement = {
  id: string;
  type: 'text' | 'rect' | 'circle' | 'line' | 'image' | 'video';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: '400' | '600' | '700' | '800';
  italic: boolean;
  align: 'left' | 'center' | 'right';
  resourceId?: string;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  imageFit?: 'cover' | 'contain';
  startSeconds?: number;
  durationSeconds?: number;
  sourceStartSeconds?: number;
  letterSpacing?: number;
  shapeKind?: 'arrow' | 'triangle' | 'star' | 'burst';
};

export type StudioPage = {
  id: string;
  name: string;
  width: number;
  height: number;
  durationSeconds: number;
  transitionAfter?: 'cut' | 'fade';
  transitionDurationSeconds?: number;
  background: string;
  elements: StudioElement[];
};

export type StudioAudioTrack = {
  id: string;
  resourceId: string;
  timelineStartSeconds: number;
  sourceStartSeconds: number;
  durationSeconds: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
};

export type StudioProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: StudioPage[];
  selectedPageId: string;
  selectedAudioId: string | null;
  /** Missing audioTracks denotes a legacy single-soundtrack project. */
  audioTracks?: StudioAudioTrack[];
  selectedAudioTrackId?: string | null;
  audioStartSeconds: number;
  audioDurationSeconds?: number;
  audioVolume: number;
  audioFadeInSeconds?: number;
  audioFadeOutSeconds?: number;
  caption: string;
  hashtags: string;
  primaryColor: string;
  accentColor: string;
};

type DirectoryHandleLike = {
  name: string;
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
  entries: () => AsyncIterable<[string, DirectoryHandleLike | FileHandleLike]>;
  removeEntry?: (name: string) => Promise<void>;
  kind?: string;
};
type FileHandleLike = {
  name?: string;
  kind?: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: Blob | string) => Promise<void>; close: () => Promise<void> }>;
};

const DB_NAME = 'lucky-bajaj-creative-studio';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';
const PROJECTS_STORE = 'projects';
const RESOURCES_STORE = 'resources';
const ROOT_HANDLE_KEY = 'workspace-directory-handle';
const BROWSER_STORAGE_KEY = 'browser-storage-only';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not provide local project storage.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RESOURCES_STORE)) db.createObjectStore(RESOURCES_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local studio storage could not be opened.'));
  });
}

async function readValue<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => { db.close(); resolve(request.result as T | undefined); };
    request.onerror = () => { db.close(); reject(request.error ?? new Error('Local data could not be read.')); };
  });
}

async function writeValue(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    if (key === undefined) tx.objectStore(storeName).put(value);
    else tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local data could not be saved.')); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local save was cancelled.')); };
  });
}

async function listValues<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result as T[]); };
    request.onerror = () => { db.close(); reject(request.error ?? new Error('Local library could not be read.')); };
  });
}

async function deleteValue(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local item could not be deleted.')); };
  });
}

export function supportsLocalDirectoryAccess(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function getWorkspaceDirectory(): Promise<DirectoryHandleLike | null> {
  return (await readValue<DirectoryHandleLike>(SETTINGS_STORE, ROOT_HANDLE_KEY)) ?? null;
}

export async function getWorkspacePermission(): Promise<PermissionState | 'missing'> {
  const root = await getWorkspaceDirectory();
  if (!root) return (await readValue<boolean>(SETTINGS_STORE, BROWSER_STORAGE_KEY)) ? 'granted' : 'missing';
  if (!root.queryPermission) return 'denied';
  try { return await root.queryPermission({ mode: 'readwrite' }); }
  catch { return 'denied'; }
}

export async function useBrowserStorage(): Promise<void> { await writeValue(SETTINGS_STORE, true, BROWSER_STORAGE_KEY); }

export async function chooseWorkspaceDirectory(): Promise<string> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandleLike>;
  }).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot grant folder access. Use Chrome or Edge, or use browser-local storage.');
  const root = await picker.call(window, { id: 'lucky-bajaj-studio', mode: 'readwrite' });
  if (root.requestPermission) {
    const permission = await root.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Folder access was not granted.');
  }
  await writeValue(SETTINGS_STORE, root, ROOT_HANDLE_KEY);
  await deleteValue(SETTINGS_STORE, BROWSER_STORAGE_KEY);
  await ensureWorkspaceFolders(root);
  return root.name;
}

export async function requestSavedFolderPermission(): Promise<PermissionState | 'missing'> {
  const root = await getWorkspaceDirectory();
  if (!root) return 'missing';
  const state = root.queryPermission ? await root.queryPermission({ mode: 'readwrite' }) : 'denied';
  if (state === 'granted') return state;
  if (!root.requestPermission) return 'denied';
  return root.requestPermission({ mode: 'readwrite' });
}

async function ensureWorkspaceFolders(root: DirectoryHandleLike): Promise<void> {
  for (const name of ['Projects', 'Assets', 'Assets/Images', 'Assets/Audio', 'Assets/Videos', 'Exports', 'Exports/Images', 'Exports/Videos']) {
    let current = root;
    for (const part of name.split('/')) current = await current.getDirectoryHandle(part, { create: true });
  }
}

async function directoryAt(root: DirectoryHandleLike, parts: string[], create: boolean): Promise<DirectoryHandleLike> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}

function safeFileName(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'resource';
}

async function writeLocalFile(relativePath: string, blob: Blob): Promise<void> {
  const root = await getWorkspaceDirectory();
  if (!root) return;
  const permission = root.queryPermission ? await root.queryPermission({ mode: 'readwrite' }) : 'denied';
  if (permission !== 'granted') throw new Error('The local resource folder needs permission again.');
  const parts = relativePath.split('/');
  const fileName = parts.pop();
  if (!fileName) throw new Error('Invalid local resource path.');
  const dir = await directoryAt(root, parts, true);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function saveProject(project: StudioProject): Promise<void> {
  const saved = { ...project, updatedAt: new Date().toISOString() };
  await deleteValue(SETTINGS_STORE, 'deleted-project:' + saved.id);
  await writeValue(PROJECTS_STORE, saved);
  const root = await getWorkspaceDirectory();
  if (root) {
    const filename = saved.id + '.json';
    await writeLocalFile('Projects/' + filename, new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }));
  }
}

export async function listProjects(): Promise<StudioProject[]> {
  const indexed = await listValues<StudioProject>(PROJECTS_STORE);
  const byId = new Map<string, StudioProject>();
  for (const item of indexed) {
    if (!(await readValue<boolean>(SETTINGS_STORE, 'deleted-project:' + item.id))) byId.set(item.id, item);
  }
  const root = await getWorkspaceDirectory();
  if (root?.entries) {
    try {
      const folder = await root.getDirectoryHandle('Projects');
      for await (const [name, handle] of folder.entries()) {
        if (!name.toLowerCase().endsWith('.json') || handle.kind === 'directory' || !('getFile' in handle)) continue;
        try {
          const file = await (handle as FileHandleLike).getFile();
          const parsed = JSON.parse(await file.text()) as StudioProject;
          if (parsed?.id && Array.isArray(parsed.pages) && !(await readValue<boolean>(SETTINGS_STORE, 'deleted-project:' + parsed.id))) {
            const indexed = byId.get(parsed.id);
            const diskUpdatedAt = Date.parse(parsed.updatedAt ?? '');
            const indexedUpdatedAt = Date.parse(indexed?.updatedAt ?? '');
            // A failed folder write can leave an older file beside a newer IndexedDB
            // autosave. Reconcile to the newest valid project instead of clobbering it.
            if (!indexed || (Number.isFinite(diskUpdatedAt) && (!Number.isFinite(indexedUpdatedAt) || diskUpdatedAt > indexedUpdatedAt))) {
              byId.set(parsed.id, parsed);
              await writeValue(PROJECTS_STORE, parsed);
            }
          }
        } catch { /* Ignore incomplete or externally edited project files. */ }
      }
    } catch { /* An unavailable Projects folder does not hide IndexedDB projects. */ }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function removeProject(id: string): Promise<void> {
  const project = await readValue<StudioProject>(PROJECTS_STORE, id);
  await writeValue(SETTINGS_STORE, true, 'deleted-project:' + id);
  await deleteValue(PROJECTS_STORE, id);
  const root = await getWorkspaceDirectory();
  if (root && project) {
    try { const dir = await directoryAt(root, ['Projects'], false); await dir.removeEntry?.(project.id + '.json'); }
    catch { /* The indexed project is removed; a stale local copy can be cleaned manually. */ }
  }
}

async function validateImageBlob(blob: Blob): Promise<void> {
  if (!['image/jpeg', 'image/png'].includes(blob.type)) throw new Error('Only JPEG and PNG images are supported.');
  if (blob.size > ARTWORK_ASSET_MAX_BYTES) throw new Error('Images are limited to 4.5 MB each.');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) throw new Error('Images must be 20 megapixels or smaller.'); }
    finally { bitmap.close(); }
  }
}
async function validateAudioBlob(blob: Blob): Promise<void> {
  if (blob.size > ARTWORK_MUSIC_MAX_BYTES) throw new Error('Audio files are limited to 25 MB each.');
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio(); audio.preload = 'metadata';
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('Audio duration could not be read. Use a supported audio file.'));
      audio.src = url;
    });
    if (!Number.isFinite(duration) || duration < MUSIC_CLIP_MIN_SECONDS) throw new Error('Audio tracks must be at least 0.1 seconds long.');
  } finally { URL.revokeObjectURL(url); }
}
export async function saveResource(blob: Blob, name: string, kind: StudioResourceKind, exported = false): Promise<StudioResource> {
  if (!blob.size) throw new Error('The selected file is empty.');
  const existing = await listValues<StudioResource>(RESOURCES_STORE);
  if (kind === 'image') {
    if (existing.filter((item) => item.kind === 'image').length + STARTER_ARTWORK_ASSETS.length >= ARTWORK_ASSET_LIMIT) throw new Error('The image library is full. The maximum is 50 including starter images.');
    await validateImageBlob(blob);
  }
  if (kind === 'audio') {
    const audio = existing.filter((item) => item.kind === 'audio');
    if (audio.length + STARTER_MUSIC_CATALOG.length >= ARTWORK_MUSIC_LIMIT) throw new Error('The music library is full. The maximum is 50 including curated entries.');
    if (audio.reduce((sum, item) => sum + item.size, 0) + blob.size > ARTWORK_MUSIC_LIBRARY_MAX_BYTES) throw new Error('The music library total is limited to 250 MB.');
    await validateAudioBlob(blob);
  }
  const id = globalThis.crypto?.randomUUID?.() ?? 'resource-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const safeName = safeFileName(name.replace(/\.[^.]+$/, ''));
  const folder = kind === 'image' ? 'Images' : kind === 'audio' ? 'Audio' : kind === 'video' ? 'Videos' : 'Images';
  const rootFolder = kind === 'export' ? 'Exports/Images' : kind === 'video' && exported ? 'Exports/Videos' : 'Assets/' + folder;
  const relativePath = rootFolder + '/' + id + '__' + safeName + (extension ? '.' + safeFileName(extension) : '');
  await deleteValue(SETTINGS_STORE, 'deleted-resource:' + id);
  const resource: StudioResource = {
    id, name: name.slice(0, 140), kind, mimeType: blob.type || 'application/octet-stream',
    size: blob.size, createdAt: new Date().toISOString(), relativePath, blob,
  };
  await writeValue(RESOURCES_STORE, resource);
  await writeLocalFile(relativePath, blob);
  return resource;
}

export async function listResources(): Promise<StudioResource[]> {
  const indexed = await listValues<StudioResource>(RESOURCES_STORE);
  const byId = new Map<string, StudioResource>();
  for (const item of indexed) {
    if (!(await readValue<boolean>(SETTINGS_STORE, 'deleted-resource:' + item.id))) byId.set(item.id, item);
  }
  const root = await getWorkspaceDirectory();
  if (root?.entries) {
    const locations: Array<[string[], StudioResourceKind]> = [
      [['Assets', 'Images'], 'image'], [['Assets', 'Audio'], 'audio'], [['Assets', 'Videos'], 'video'],
      [['Exports', 'Images'], 'export'], [['Exports', 'Videos'], 'video'],
    ];
    for (const [parts, kind] of locations) {
      try {
        const folder = await directoryAt(root, parts, false);
        for await (const [name, handle] of folder.entries()) {
          if (handle.kind === 'directory' || !('getFile' in handle)) continue;
          const id = name.split('__')[0];
          if (!id || byId.has(id) || await readValue<boolean>(SETTINGS_STORE, 'deleted-resource:' + id)) continue;
          try {
            const blob = await (handle as FileHandleLike).getFile();
            const resource: StudioResource = { id, name: name.includes('__') ? name.slice(name.indexOf('__') + 2) : name,
              kind, mimeType: blob.type || 'application/octet-stream', size: blob.size,
              createdAt: new Date(blob.lastModified).toISOString(), relativePath: parts.join('/') + '/' + name, blob };
            byId.set(id, resource); await writeValue(RESOURCES_STORE, resource);
          } catch { /* Skip unreadable resources and continue indexing the library. */ }
        }
      } catch { /* Optional resource folders may not exist yet. */ }
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readResource(id: string): Promise<StudioResource | undefined> {
  return readValue<StudioResource>(RESOURCES_STORE, id);
}

export async function removeResource(id: string): Promise<void> {
  const resource = await readValue<StudioResource>(RESOURCES_STORE, id);
  await writeValue(SETTINGS_STORE, true, 'deleted-resource:' + id);
  await deleteValue(RESOURCES_STORE, id);
  const root = await getWorkspaceDirectory();
  if (root && resource?.relativePath) {
    try { const parts = resource.relativePath.split('/'); const filename = parts.pop(); if (filename) await directoryAt(root, parts, false).then((folder) => folder.removeEntry?.(filename)); }
    catch { /* A stale file can be cleaned manually if the folder is unavailable. */ }
  }
}

export async function saveExport(blob: Blob, name: string, kind: 'image' | 'video'): Promise<void> {
  const root = await getWorkspaceDirectory();
  if (!root) return;
  const directory = kind === 'image' ? 'Exports/Images' : 'Exports/Videos';
  await writeLocalFile(directory + '/' + safeFileName(name), blob);
}

export async function persistHandleName(): Promise<string | null> {
  const root = await getWorkspaceDirectory();
  return root?.name ?? ((await readValue<boolean>(SETTINGS_STORE, BROWSER_STORAGE_KEY)) ? 'Browser storage' : null);
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(name);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}
