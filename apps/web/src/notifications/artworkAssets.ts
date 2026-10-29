/**
 * Small, browser-local asset library for Social Media Artwork Studio.
 * Starter photos retain their source URL and attribution; selecting one imports a
 * JPEG/PNG copy into IndexedDB so the editor can export offline without tainting canvas.
 */
export const ARTWORK_ASSET_LIMIT = 50;
export const ARTWORK_ASSET_MAX_BYTES = 4_500_000;
const DB_NAME = 'bajaj-social-media-artwork';
const DB_VERSION = 2;

export type ArtworkAsset = {
  id: string;
  name: string;
  category: string;
  sourceUrl: string | null;
  sourcePage: string;
  credit: string;
  mimeType: 'image/jpeg' | 'image/png';
  isStarter: boolean;
  createdAt: string;
  fileData: Blob | null;
};

export type ArtworkTemplate = {
  id: string;
  name: string;
  occasion: string;
  formatId: string;
  assetId: string;
  headline: string;
  message: string;
  callToAction: string;
  caption: string;
  hashtags: string;
  primary: string;
  accent: string;
};

const ADDED_AT = '2026-10-29T00:00:00.000Z';

export const STARTER_ARTWORK_ASSETS: ArtworkAsset[] = [
  {
    id: 'starter-diwali-diyas',
    name: 'Diwali · Diyas & warm lights',
    category: 'Diwali / Dhanteras',
    sourceUrl: 'https://images.unsplash.com/photo-1669393969283-1aaeebfc2ea2?auto=format&fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/a-ring-with-a-flame-x8O6wBxAbDk',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-chhath-puja',
    name: 'Chhath Puja · Arghya at sunrise',
    category: 'Chhath Puja',
    sourceUrl: 'https://images.pexels.com/photos/34473107/pexels-photo-34473107.jpeg?auto=compress&cs=tinysrgb&w=1600',
    sourcePage: 'https://www.pexels.com/photo/chhath-puja-ceremony-in-bihar-india-34473107/',
    credit: 'Photo by Monojit Dutta via Pexels · Pexels license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-eid-lantern',
    name: 'Eid · Crescent lantern glow',
    category: 'Eid / Ramadan',
    sourceUrl: 'https://images.pexels.com/photos/2233416/pexels-photo-2233416.jpeg?auto=compress&cs=tinysrgb&w=1600',
    sourcePage: 'https://www.pexels.com/photo/photo-of-ramadan-light-on-top-of-table-2233416/',
    credit: 'Photo by Ahmed Aqtai via Pexels · Pexels license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-holi-colours',
    name: 'Holi · Colours in the air',
    category: 'Holi',
    sourceUrl: 'https://images.unsplash.com/photo-1559760434-0981df057e83?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/people-celebrating-holi-with-colored-powder-in-the-street-pljMO_HdHFY',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-dussehra',
    name: 'Dussehra · Effigy and lights',
    category: 'Navratri / Dussehra',
    sourceUrl: 'https://images.unsplash.com/photo-1666264475119-dbfa671c37f8?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/es/fotos/una-estatua-de-una-persona-con-una-corona-y-una-antorcha-e9__S_y1k6M',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-ganesh-chaturthi',
    name: 'Ganesh Chaturthi · Festive idol',
    category: 'Ganesh Chaturthi',
    sourceUrl: 'https://images.unsplash.com/photo-1773470878052-e1826e30ba75?auto=format&fit=crop&fm=jpg&q=60&w=1600',
    sourcePage: 'https://unsplash.com/photos/lord-ganesha-idol-decorated-with-flowers-and-fruits-rT5TEQs9zXg',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-indian-tricolour',
    name: 'Indian Tricolour · National occasions',
    category: 'Independence Day / Republic Day',
    sourceUrl: 'https://images.unsplash.com/photo-1558155959-5b4c9c149470?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/india-flag-waving-during-daytime-rND1whwyxZ0',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-christmas-lights',
    name: 'Christmas · Red and gold decorations',
    category: 'Christmas',
    sourceUrl: 'https://images.unsplash.com/photo-1608930027833-0b6ab89ccfb4?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/red-and-gold-baubles-on-christmas-tree-M1w_fjB51ZA',
    credit: 'Photo via Unsplash · see source page for contributor and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-new-year',
    name: 'New Year · Fireworks celebration',
    category: 'New Year',
    sourceUrl: 'https://images.unsplash.com/photo-1512248805576-c1b31f6fcab1?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/a-happy-new-years-eve-celebration-with-fireworks-zNS6oFkwlG4',
    credit: 'Photo by NordWood Themes via Unsplash · Unsplash license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-makar-sankranti',
    name: 'Makar Sankranti · Colourful kites',
    category: 'Makar Sankranti / Uttarayan',
    sourceUrl: 'https://images.unsplash.com/photo-1641792112180-998e4a9b9843?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/a-group-of-colorful-kites-hanging-on-a-wall-gZZTHQtBZTE',
    credit: 'Photo by VD Photography via Unsplash · Unsplash license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-navratri-garba',
    name: 'Navratri · Garba celebration',
    category: 'Navratri / Garba',
    sourceUrl: 'https://images.unsplash.com/photo-1774437897284-b2f7c4638c55?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/photos/women-in-colorful-saris-dancing-on-a-street-tJbu0oQTwac',
    credit: 'Photo by Tanmay Abhay Mahajan via Unsplash · Unsplash license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
  {
    id: 'starter-road-safety',
    name: 'Road Safety · Clear road message',
    category: 'National / Awareness',
    sourceUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?fit=crop&fm=jpg&q=80&w=1600',
    sourcePage: 'https://unsplash.com/s/photos/motorcycle-road',
    credit: 'Photo via Unsplash · see source page and license',
    mimeType: 'image/jpeg', isStarter: true, createdAt: ADDED_AT, fileData: null,
  },
];

export const ARTWORK_TEMPLATES: ArtworkTemplate[] = [
  { id: 'diwali-greeting', name: 'Shubh Deepawali', occasion: 'Diwali', formatId: 'square-feed', assetId: 'starter-diwali-diyas', headline: 'शुभ दीपावली', message: 'प्रकाश, समृद्धि और खुशियों से भरा आपका पर्व हो।', callToAction: 'Warm wishes from Lucky Bajaj', caption: 'May the festival of lights bring joy, prosperity and new journeys.', hashtags: '#LuckyBajaj #Diwali #Deepawali', primary: '#28143e', accent: '#f6c35e' },
  { id: 'dhanteras-ride', name: 'Dhanteras · New beginnings', occasion: 'Dhanteras', formatId: 'instagram-portrait', assetId: 'starter-diwali-diyas', headline: 'A Bright Start to Your Next Ride', message: 'Celebrate new beginnings. Ask our team about current model availability and verified offers.', callToAction: 'Visit our showroom', caption: 'Make room for new beginnings this Dhanteras with Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #Dhanteras #NewBeginnings', primary: '#201735', accent: '#f3b54a' },
  { id: 'chhath-greeting', name: 'Chhath Puja · Sunrise', occasion: 'Chhath Puja', formatId: 'instagram-portrait', assetId: 'starter-chhath-puja', headline: 'छठ पूजा की हार्दिक शुभकामनाएँ', message: 'सूर्य देव और छठी मैया आपके परिवार में सुख, शांति और समृद्धि लाएँ।', callToAction: 'श्रद्धा और सम्मान सहित', caption: 'Wishing everyone a peaceful and blessed Chhath Puja.', hashtags: '#LuckyBajaj #ChhathPuja #Bihar', primary: '#6d2915', accent: '#ffb347' },
  { id: 'eid-mubarak', name: 'Eid Mubarak · Elegant', occasion: 'Eid', formatId: 'square-feed', assetId: 'starter-eid-lantern', headline: 'Eid Mubarak', message: 'Wishing you peace, prosperity and joyful moments with your loved ones.', callToAction: 'Warm wishes from Lucky Bajaj', caption: 'Eid Mubarak to you and your family from Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #EidMubarak #Eid', primary: '#123c3b', accent: '#e6c46a' },
  { id: 'holi-greeting', name: 'Happy Holi · Colourful', occasion: 'Holi', formatId: 'square-feed', assetId: 'starter-holi-colours', headline: 'Happy Holi!', message: 'May your days be filled with colour, happiness and safe celebrations.', callToAction: 'Celebrate responsibly', caption: 'A colourful Holi from all of us at Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #HappyHoli #CelebrateSafely', primary: '#3b174e', accent: '#ff8c42' },
  { id: 'navratri-garba', name: 'Navratri · Garba nights', occasion: 'Navratri', formatId: 'square-feed', assetId: 'starter-navratri-garba', headline: 'शुभ नवरात्रि', message: 'May these festive days bring strength, happiness and new beginnings.', callToAction: 'Best wishes to all', caption: 'Celebrating the colour, devotion and joy of Navratri.', hashtags: '#LuckyBajaj #Navratri #Garba', primary: '#451a46', accent: '#ff9b54' },
  { id: 'dussehra-greeting', name: 'Dussehra · Victory of good', occasion: 'Dussehra', formatId: 'square-feed', assetId: 'starter-dussehra', headline: 'विजयादशमी की शुभकामनाएँ', message: 'May goodness, courage and hope light the way forward.', callToAction: 'Warm wishes from Lucky Bajaj', caption: 'Wishing you and your family a joyful Dussehra.', hashtags: '#LuckyBajaj #Dussehra #Vijayadashami', primary: '#351b22', accent: '#ffb45b' },
  { id: 'ganesh-chaturthi', name: 'Ganesh Chaturthi · Blessings', occasion: 'Ganesh Chaturthi', formatId: 'square-feed', assetId: 'starter-ganesh-chaturthi', headline: 'गणेश चतुर्थी की शुभकामनाएँ', message: 'May every new beginning bring wisdom, happiness and prosperity.', callToAction: 'शुभ मंगलमय हो', caption: 'Happy Ganesh Chaturthi from Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #GaneshChaturthi #NewBeginnings', primary: '#553015', accent: '#f4bd67' },
  { id: 'independence-day', name: 'Independence Day · Tricolour', occasion: 'Independence Day', formatId: 'square-feed', assetId: 'starter-indian-tricolour', headline: 'Happy Independence Day', message: 'Honouring the spirit of freedom, unity and responsibility.', callToAction: 'Jai Hind', caption: 'Celebrating freedom and the responsibility we share.', hashtags: '#LuckyBajaj #IndependenceDay #JaiHind', primary: '#16334a', accent: '#f28c35' },
  { id: 'republic-day', name: 'Republic Day · Proud India', occasion: 'Republic Day', formatId: 'square-feed', assetId: 'starter-indian-tricolour', headline: 'Happy Republic Day', message: 'Celebrating our Constitution, diversity and shared future.', callToAction: 'Jai Hind', caption: 'Warm Republic Day wishes from Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #RepublicDay #India', primary: '#16334a', accent: '#f28c35' },
  { id: 'makar-sankranti', name: 'Makar Sankranti · Kites', occasion: 'Makar Sankranti', formatId: 'square-feed', assetId: 'starter-makar-sankranti', headline: 'Happy Makar Sankranti', message: 'May the season bring brighter days, good health and happiness.', callToAction: 'Warm wishes from Lucky Bajaj', caption: 'Wishing you a joyful Makar Sankranti.', hashtags: '#LuckyBajaj #MakarSankranti #Uttarayan', primary: '#173b65', accent: '#f5b642' },
  { id: 'christmas', name: 'Merry Christmas · Festive', occasion: 'Christmas', formatId: 'square-feed', assetId: 'starter-christmas-lights', headline: 'Merry Christmas', message: 'Wishing you a season filled with kindness, warmth and joy.', callToAction: 'Season’s greetings', caption: 'Merry Christmas from Lucky Bajaj Agency.', hashtags: '#LuckyBajaj #MerryChristmas #SeasonGreetings', primary: '#183b31', accent: '#dcaa55' },
  { id: 'new-year', name: 'Happy New Year · Fireworks', occasion: 'New Year', formatId: 'square-feed', assetId: 'starter-new-year', headline: 'Happy New Year!', message: 'Here’s to fresh starts, memorable journeys and brighter possibilities.', callToAction: 'Ride into the new year', caption: 'Wishing you safe and happy journeys in the New Year.', hashtags: '#LuckyBajaj #HappyNewYear #NewBeginnings', primary: '#101c37', accent: '#f2c66d' },
  { id: 'road-safety', name: 'Road Safety · Awareness', occasion: 'Road Safety', formatId: 'instagram-portrait', assetId: 'starter-road-safety', headline: 'Arrive Safe. Every Ride.', message: 'Wear your helmet, follow speed limits and make every journey a responsible one.', callToAction: 'Safety comes first', caption: 'A safe ride is the best ride. Let’s put road safety first.', hashtags: '#LuckyBajaj #RoadSafety #RideSafe', primary: '#14283d', accent: '#f97316' },
];

function openArtworkAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('The asset library is not available in this browser context.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The asset library could not be opened.'));
  });
}

export async function loadArtworkAssets(): Promise<ArtworkAsset[]> {
  const db = await openArtworkAssetDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    const request = store.getAll();
    let result: ArtworkAsset[] = [];
    request.onsuccess = () => {
      const existing = request.result as ArtworkAsset[];
      const existingIds = new Set(existing.map((asset) => asset.id));
      const additions: ArtworkAsset[] = [];
      for (const asset of STARTER_ARTWORK_ASSETS) {
        if (existingIds.has(asset.id) || existing.length + additions.length >= ARTWORK_ASSET_LIMIT) continue;
        store.add(asset);
        additions.push(asset);
      }
      result = [...existing, ...additions].sort((a, b) => {
        if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The asset library could not be loaded.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('The asset library load was cancelled.')); };
  });
}

export async function addArtworkAsset(asset: ArtworkAsset): Promise<void> {
  const db = await openArtworkAssetDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    let limitError: Error | null = null;
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      if (countRequest.result >= ARTWORK_ASSET_LIMIT) {
        limitError = new Error('The asset library is full. Remove an uploaded asset before adding another (maximum 50).');
        transaction.abort();
        return;
      }
      store.add(asset);
    };
    countRequest.onerror = () => transaction.abort();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(limitError ?? transaction.error ?? new Error('The image could not be added to the asset library.')); };
    transaction.onabort = () => { db.close(); reject(limitError ?? transaction.error ?? new Error('The image could not be added to the asset library.')); };
  });
}

export async function updateArtworkAsset(asset: ArtworkAsset): Promise<void> {
  const db = await openArtworkAssetDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    transaction.objectStore('assets').put(asset);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The asset could not be saved.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('The asset update was cancelled.')); };
  });
}

export async function removeArtworkAsset(id: string): Promise<void> {
  const db = await openArtworkAssetDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    const store = transaction.objectStore('assets');
    const request = store.get(id);
    request.onsuccess = () => {
      const asset = request.result as ArtworkAsset | undefined;
      if (!asset) return;
      if (asset.isStarter) {
        transaction.abort();
        return;
      }
      store.delete(id);
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('The asset could not be removed.')); };
    transaction.onabort = () => { db.close(); reject(new Error('Starter assets are protected; only uploaded assets can be removed.')); };
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The image could not be read.'));
    reader.onerror = () => reject(reader.error ?? new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

export async function resolveArtworkAssetSource(asset: ArtworkAsset): Promise<string> {
  if (asset.fileData) return blobToDataUrl(asset.fileData);
  if (!asset.sourceUrl) throw new Error('This asset has no stored image file.');

  let response: Response;
  try {
    response = await fetch(asset.sourceUrl, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
  } catch {
    throw new Error('This online image could not be imported. Check your connection and try again.');
  }
  if (!response.ok) throw new Error('The source image could not be downloaded (' + response.status + ').');
  const blob = await response.blob();
  const mimeType = (blob.type || asset.mimeType).split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png'].includes(mimeType)) {
    throw new Error('The source returned a format other than JPEG or PNG.');
  }
  if (blob.size < 1 || blob.size > ARTWORK_ASSET_MAX_BYTES) {
    throw new Error('Images must be no larger than 4.5 MB to fit in the asset library.');
  }
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width * bitmap.height <= 20_000_000;
    bitmap.close();
    if (!valid) throw new Error('This image is too large to use safely.');
  }
  const cached: ArtworkAsset = { ...asset, sourceUrl: asset.sourceUrl, mimeType: mimeType as ArtworkAsset['mimeType'], fileData: blob };
  await updateArtworkAsset(cached);
  return blobToDataUrl(blob);
}
