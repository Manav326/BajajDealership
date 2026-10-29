/**
 * Browser-local music library for Story / Status video creation.
 * The catalogue links to creator-published tracks; staff must download each MP3
 * from its source page and import it here before it can be previewed or embedded.
 * Raw source tracks are never exported on their own; export creates a composed video.
 */
export const ARTWORK_MUSIC_LIMIT = 50;
export const ARTWORK_MUSIC_MAX_BYTES = 25 * 1024 * 1024;
export const MUSIC_CLIP_MIN_SECONDS = 20;
export const MUSIC_CLIP_MAX_SECONDS = 120;
export const MUSIC_CLIP_DEFAULT_SECONDS = 30;
export const MUSIC_DB_NAME = 'bajaj-social-media-artwork';
export const MUSIC_DB_VERSION = 3;

export type ArtworkMusicAsset = {
  id: string;
  name: string;
  category: string;
  creator: string;
  sourcePage: string;
  licenseLabel: string;
  contentIdRegistered?: boolean;
  durationSeconds: number;
  isStarter: boolean;
  createdAt: string;
  mimeType: string | null;
  fileData: Blob | null;
};

const ADDED_AT = '2026-10-29T00:00:00.000Z';
const LICENSE = 'Pixabay Content License · verify the individual track page before commercial use';

export const STARTER_MUSIC_CATALOG: ArtworkMusicAsset[] = [
  { id: 'starter-music-chhath', name: 'Chhath · Hindu Festive Music', category: 'Chhath Puja', creator: 'kontraa', sourcePage: 'https://pixabay.com/music/india-chhath-hindu-festive-music-427079/', licenseLabel: LICENSE, durationSeconds: 239, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-chhathi-maiya', name: 'Chhathi Maiya · Hindu Festive Music', category: 'Chhath Puja', creator: 'kontraa', sourcePage: 'https://pixabay.com/music/india-chhathi-maiya-hindu-festive-music-424836/', licenseLabel: LICENSE, durationSeconds: 239, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-bhojpuri', name: 'Bhojpuri · Regional festive feel', category: 'Bihar / Bhojpuri', creator: 'vishuaashi', sourcePage: 'https://pixabay.com/music/india-bhojpuri-166899/', licenseLabel: LICENSE, durationSeconds: 154, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-diwali-festival', name: 'Diwali Festival · India Celebration', category: 'Diwali / Dhanteras', creator: 'FASSounds', sourcePage: 'https://pixabay.com/music/india-diwali-festival-india-celebration-indian-music-246605/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 124, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-festival-of-lights', name: 'Festival of Lights · Indian Celebration', category: 'Diwali / Dhanteras', creator: 'FASSounds', sourcePage: 'https://pixabay.com/music/india-festival-of-lights-india-diwali-celebration-indian-music-246606/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 132, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-diwali-holi', name: 'Hindu Diwali Holi Music', category: 'Diwali / Holi', creator: 'ViacheslavStarostin', sourcePage: 'https://pixabay.com/music/india-hindu-diwali-holi-music-495344/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 201, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-holi', name: 'Holi · Hindu Festival Music', category: 'Holi', creator: 'lNPLUSMUSIC', sourcePage: 'https://pixabay.com/music/india-holi-hindu-festival-music-487554/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 141, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-eid', name: 'Eid Al Fitr · Eid Mubarak', category: 'Eid / Ramadan', creator: 'lNPLUSMUSIC', sourcePage: 'https://pixabay.com/music/folk-eid-al-fitr-eid-mubarak-2026-487552/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 114, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-garba', name: 'Free Soul · Instrumental Garba Song 2025', category: 'Navratri / Garba', creator: 'kalsstockmedia', sourcePage: 'https://pixabay.com/music/world-free-soul-instrumental-garba-song-2025-405946/', licenseLabel: LICENSE, durationSeconds: 138, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
  { id: 'starter-music-republic-day', name: 'Indian Flag · Republic Day Music', category: 'Independence / Republic Day', creator: 'alex-morgan', sourcePage: 'https://pixabay.com/es/music/india-indian-flag-republic-day-music-583269/', licenseLabel: LICENSE, contentIdRegistered: true, durationSeconds: 134, isStarter: true, createdAt: ADDED_AT, mimeType: null, fileData: null },
];

function openArtworkMusicDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('The music library is not available in this browser context.'));
      return;
    }
    const request = indexedDB.open(MUSIC_DB_NAME, MUSIC_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('music')) db.createObjectStore('music', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The music library could not be opened.'));
  });
}

export async function loadArtworkMusicAssets(): Promise<ArtworkMusicAsset[]> {
  const db = await openArtworkMusicDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('music', 'readwrite');
    const store = transaction.objectStore('music');
    const request = store.getAll();
    let result: ArtworkMusicAsset[] = [];
    request.onsuccess = () => {
      const existing = request.result as ArtworkMusicAsset[];
      const existingById = new Map(existing.map((asset) => [asset.id, asset]));
      const starterAssets: ArtworkMusicAsset[] = [];
      const additions: ArtworkMusicAsset[] = [];
      for (const asset of STARTER_MUSIC_CATALOG) {
        const prior = existingById.get(asset.id);
        if (prior) {
          // Refresh curated attribution/licence metadata without overwriting a user's imported audio.
          const refreshed: ArtworkMusicAsset = {
            ...asset,
            fileData: prior.fileData,
            mimeType: prior.mimeType ?? asset.mimeType,
            durationSeconds: prior.fileData ? prior.durationSeconds : asset.durationSeconds,
          };
          store.put(refreshed);
          starterAssets.push(refreshed);
          continue;
        }
        if (existing.length + additions.length >= ARTWORK_MUSIC_LIMIT) continue;
        store.add(asset);
        additions.push(asset);
      }
      const starterIds = new Set(STARTER_MUSIC_CATALOG.map((asset) => asset.id));
      const customAssets = existing.filter((asset) => !starterIds.has(asset.id));
      result = [...starterAssets, ...customAssets, ...additions].sort((a, b) => {
        if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The music library could not be loaded.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Loading the music library was cancelled.')); };
  });
}

export async function addArtworkMusicAsset(asset: ArtworkMusicAsset): Promise<void> {
  const db = await openArtworkMusicDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('music', 'readwrite');
    const store = transaction.objectStore('music');
    let limitError: Error | null = null;
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      if (countRequest.result >= ARTWORK_MUSIC_LIMIT) {
        limitError = new Error('The music library is full. Remove a user-uploaded track before adding another (maximum 50).');
        transaction.abort();
        return;
      }
      store.add(asset);
    };
    countRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(limitError ?? transaction.error ?? new Error('The music track could not be added.')); };
    transaction.onabort = () => { db.close(); reject(limitError ?? transaction.error ?? new Error('The music track could not be added.')); };
  });
}

export async function updateArtworkMusicAsset(asset: ArtworkMusicAsset): Promise<void> {
  const db = await openArtworkMusicDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('music', 'readwrite');
    transaction.objectStore('music').put(asset);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The music track could not be saved.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Saving the music track was cancelled.')); };
  });
}

export async function removeArtworkMusicAsset(id: string): Promise<void> {
  const db = await openArtworkMusicDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('music', 'readwrite');
    const store = transaction.objectStore('music');
    const request = store.get(id);
    request.onsuccess = () => {
      const asset = request.result as ArtworkMusicAsset | undefined;
      if (!asset) return;
      if (asset.isStarter) {
        transaction.abort();
        return;
      }
      store.delete(id);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The music track could not be removed.')); };
    transaction.onabort = () => { db.close(); reject(new Error('Starter tracks are protected; only uploaded tracks can be removed.')); };
  });
}
