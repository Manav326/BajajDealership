import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

export type ShowroomAction = 'TEST_RIDE' | 'PURCHASE';

export type ShowroomBike = {
  manufacturer: string;
  modelCode: string;
  modelName: string;
  family: string;
  category: string;
  engineCc: number;
  maxPower: string;
  maxTorque: string;
  gearbox: string | null;
  braking: string | null;
  frontSuspension: string | null;
  rearSuspension: string | null;
  fuelTankLitres: number | null;
  groundClearanceMm: number | null;
  kerbWeightKg: number | null;
  rideCharacter: string;
  highlights: string[];
  heroImageUrl: string;
  officialModelUrl: string;
  officialSpecsUrl: string;
  exShowroomPrice: number | null;
  priceCity: string;
  priceSourceUrl: string;
  priceVerifiedAt: string | null;
  inventoryModelPublicId: string | null;
  availableUnits: number;
  expectedUnits: number;
  reservedUnits: number;
  availabilityStatus: 'IN_STOCK' | 'EXPECTED' | 'OUT_OF_STOCK';
  expectedAvailableOn: string | null;
};
type Catalogue = {
  manufacturer: string;
  dealershipCode: string | null;
  dealershipName: string | null;
  priceReferenceCity: string;
  servedAt: string;
  bikes: ShowroomBike[];
};
type OnRoadQuote = {
  quoteType: 'ESTIMATE'; modelCode: string; modelName: string; city: string; state: string;
  calculatedFor: string; effectiveFrom: string; effectiveTo: string | null;
  breakdown: { label: string; amount: number; calculation: string }[];
  estimatedOnRoadTotal: number; sourceUrl: string; note: string | null; disclaimer: string;
};
type ShowroomPromotion = {
  publicId: string; modelCode: string | null; modelName: string | null; title: string; summary: string;
  terms: string | null; startsOn: string; endsOn: string | null; sourceUrl: string; published: boolean; disclaimer: string;
};
function splitPriceLocation(raw: string): { city: string; state: string } | null {
  const comma = raw.lastIndexOf(',');
  if (comma < 1) return null;
  const city = raw.slice(0, comma).trim();
  const state = raw.slice(comma + 1).trim();
  return city && state ? { city, state } : null;
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const renderApiFallback = window.location.hostname === 'lucky-bajaj-customer-web.onrender.com'
  ? 'https://lucky-bajaj-api.onrender.com' : '';
// Vite variables are baked into a static build. Keep a Render-specific fallback for
// dashboards that were configured manually instead of being created from render.yaml.
const apiBaseUrl = /^https?:\/\//i.test(configuredApiBaseUrl) ? configuredApiBaseUrl : renderApiFallback;
function endpoint(path: string): string {
  return apiBaseUrl ? new URL(path, `${apiBaseUrl}/`).toString() : path;
}
function catalogueAssetUrl(path: string): string {
  if (!path || /^(?:data:|blob:|https?:\/\/)/i.test(path)) return path;
  return apiBaseUrl ? new URL(path, `${apiBaseUrl}/`).toString() : path;
}
const money = (value: number | null | undefined) => value == null
  ? 'Ask for price'
  : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
  : 'Not verified yet';
const categories = [
  { value: 'ALL', label: 'All Bajaj bikes' },
  { value: 'SPORT', label: 'Performance' },
  { value: 'STREET', label: 'Street' },
  { value: 'COMMUTER', label: 'Commuter' },
  { value: 'TOURING', label: 'Touring' },
  { value: 'CRUISER', label: 'Cruiser' },
  { value: 'RUGGED', label: 'Rugged' },
];

export default function BajajShowroom({
  onSignIn = () => {},
  onNavigate = () => {},
  mode = 'landing',
  requesting = false,
  onCustomerRequest,
}: {
  onSignIn?: (bike?: ShowroomBike, action?: ShowroomAction, preferredAt?: string | null) => void;
  onNavigate?: (route: 'privacy' | 'terms') => void;
  mode?: 'landing' | 'portal';
  requesting?: boolean;
  onCustomerRequest?: (bike: ShowroomBike, action: ShowroomAction, preferredAt: string | null) => void;
}) {
  const Wrapper = mode === 'portal' ? 'div' : 'main';
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [heroSelectionCode, setHeroSelectionCode] = useState('BAJAJ_PULSAR_NS400Z');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  const [promotions, setPromotions] = useState<ShowroomPromotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ShowroomBike | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousModalFocusRef = useRef<HTMLElement | null>(null);
  const [preferredRideAt, setPreferredRideAt] = useState('');
  const [actionError, setActionError] = useState('');
  const [priceLocation, setPriceLocation] = useState('Bettiah, Bihar');
  const [onRoadQuote, setOnRoadQuote] = useState<OnRoadQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteLocationKey, setQuoteLocationKey] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [compareModelCodes, setCompareModelCodes] = useState<string[]>([]);
  const [compareNotice, setCompareNotice] = useState('');
  const [sharedOfferPublicId, setSharedOfferPublicId] = useState('');

  const updateLocationParams = useCallback((changes: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(window.history.state, '', nextUrl);
  }, []);

  const closeDetails = useCallback(() => {
    setSelected(null);
    setPreferredRideAt('');
    setActionError('');
    setOnRoadQuote(null);
    setQuoteError('');
    setQuoteLocationKey('');
    updateLocationParams({ bike: null });
  }, [updateLocationParams]);

  const openDetails = useCallback((bike: ShowroomBike) => {
    setSelected(bike);
    setPreferredRideAt('');
    setActionError('');
    setOnRoadQuote(null);
    setQuoteError('');
    setQuoteLocationKey('');
    updateLocationParams({ bike: bike.modelCode });
  }, [updateLocationParams]);

  const toggleCompare = useCallback((bike: ShowroomBike) => {
    const alreadySelected = compareModelCodes.includes(bike.modelCode);
    if (!alreadySelected && compareModelCodes.length >= 3) {
      setCompareNotice('Compare up to three bikes at once. Remove one before adding another.');
      return;
    }
    const next = alreadySelected
      ? compareModelCodes.filter((code) => code !== bike.modelCode)
      : [...compareModelCodes, bike.modelCode];
    setCompareModelCodes(next);
    setCompareNotice(next.length === 1
      ? 'Select one more bike to compare specifications side by side.'
      : next.length >= 2 ? `${next.length} bikes selected for comparison.` : '');
    updateLocationParams({ compare: next.length ? next.join(',') : null });
  }, [compareModelCodes, updateLocationParams]);

  const clearComparison = useCallback(() => {
    setCompareModelCodes([]);
    setCompareNotice('');
    updateLocationParams({ compare: null });
  }, [updateLocationParams]);

  useEffect(() => {
    if (!selected) return;
    previousModalFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function keepModalKeyboardAccessible(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetails();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('.showroom-bike-modal');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (currentIndex === -1 || currentIndex === focusable.length - 1)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', keepModalKeyboardAccessible);
    return () => {
      document.removeEventListener('keydown', keepModalKeyboardAccessible);
      const previous = previousModalFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [selected, closeDetails]);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    setLoading(true);
    setError('');
    // Render's free API may need time to wake up after inactivity. Bound the wait so
    // the page can recover to a visible retry state instead of spinning forever.
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);
    fetch(endpoint('/api/v1/public/catalogue/bikes'), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.text();
        let payload: unknown = null;
        if (body) {
          try { payload = JSON.parse(body); } catch { payload = body; }
        }
        if (!response.ok) {
          const message = typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message) : null;
          throw new Error(message || 'The Bajaj catalogue is not available right now.');
        }
        if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')
          || typeof payload !== 'object' || payload === null) {
          throw new Error('The catalogue service returned an unexpected response. Please retry in a moment.');
        }
        return payload as Catalogue;
      })
      .then((result) => {
        if (result.manufacturer !== 'BAJAJ' || !Array.isArray(result.bikes)
          || result.bikes.some((bike) => bike.manufacturer !== 'BAJAJ')) {
          throw new Error('The catalogue returned an unexpected manufacturer. Please try again.');
        }
        setCatalogue(result);
        setError('');
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError' && !timedOut) return;
        setError(timedOut
          ? 'The catalogue service is taking longer than expected. Please retry.'
          : cause instanceof Error ? cause.message : 'Unable to load Bajaj bikes.');
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        setLoading(false);
      });
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [catalogueAttempt]);

  useEffect(() => {
    if (mode === 'portal') {
      setPromotions([]);
      setPromotionsLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(endpoint('/api/v1/public/catalogue/promotions'), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { promotions: [] as ShowroomPromotion[] };
        const result = await response.json() as { promotions?: ShowroomPromotion[] };
        if (!Array.isArray(result.promotions)) return { promotions: [] as ShowroomPromotion[] };
        return { promotions: result.promotions.filter((item) =>
          item.published === true && typeof item.title === 'string' && typeof item.summary === 'string'
          && typeof item.sourceUrl === 'string') };
      })
      .then((result) => setPromotions(result.promotions))
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setPromotions([]);
      })
      .finally(() => setPromotionsLoading(false));
    return () => controller.abort();
  }, [mode]);

  useEffect(() => {
    const syncFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedBikeCode = params.get('bike');
      setSelected(requestedBikeCode
        ? (catalogue?.bikes ?? []).find((bike) => bike.modelCode === requestedBikeCode) ?? null
        : null);
      const requestedCompare = (params.get('compare') ?? '').split(',').filter(Boolean);
      const validCodes = (catalogue?.bikes ?? []).map((bike) => bike.modelCode);
      setCompareModelCodes([...new Set(requestedCompare)].filter((code) => validCodes.includes(code)).slice(0, 3));
      setSharedOfferPublicId(params.get('offer') ?? '');
    };
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, [catalogue, mode]);

  useEffect(() => {
    if (mode !== 'landing' || promotionsLoading || !sharedOfferPublicId) return;
    const promotion = promotions.find((item) => item.publicId === sharedOfferPublicId);
    if (!promotion) return;
    document.getElementById(`showroom-offer-${promotion.publicId}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [mode, promotions, promotionsLoading, sharedOfferPublicId]);

  const bikes = useMemo(() => (catalogue?.bikes ?? []).filter((bike) => {
    const matchesCategory = category === 'ALL' || bike.category === category;
    const search = query.trim().toLowerCase();
    const matchesQuery = !search || [bike.modelName, bike.family, bike.category, bike.rideCharacter]
      .some((value) => value.toLowerCase().includes(search));
    return matchesCategory && matchesQuery;
  }), [catalogue, category, query]);

  // Keep the orbital stage small: only the first seven image-ready catalogue bikes
  // are mounted in the hero, rather than rendering the full catalogue above the fold.
  const heroBikes = useMemo(() => {
    const available = (catalogue?.bikes ?? []).filter((bike) => Boolean(bike.heroImageUrl));
    const preferred = available.find((bike) => bike.modelCode === 'BAJAJ_PULSAR_NS400Z');
    const ordered = preferred
      ? [preferred, ...available.filter((bike) => bike.modelCode !== preferred.modelCode)]
      : available;
    return ordered.slice(0, 7);
  }, [catalogue]);
  const heroSelectedIndex = Math.max(0, heroBikes.findIndex((bike) => bike.modelCode === heroSelectionCode));
  const activeHeroBike = heroBikes[heroSelectedIndex] ?? (catalogue?.bikes ?? []).find((bike) => bike.modelCode === 'BAJAJ_PULSAR_NS400Z')
    ?? catalogue?.bikes?.[0];
  const featured = activeHeroBike;

  // Low-frequency state updates only; CSS handles interpolation between positions.
  // Automatic movement pauses in hidden tabs and respects reduced-motion preferences.
  useEffect(() => {
    if (heroBikes.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rotate = () => {
      if (document.visibilityState !== 'visible') return;
      setHeroSelectionCode((current) => {
        const currentIndex = heroBikes.findIndex((bike) => bike.modelCode === current);
        return heroBikes[(Math.max(0, currentIndex) + 1) % heroBikes.length].modelCode;
      });
    };
    const timer = window.setInterval(rotate, 5600);
    document.addEventListener('visibilitychange', rotate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', rotate);
    };
  }, [heroBikes, heroSelectionCode]);

  const comparedBikes = useMemo(
    () => compareModelCodes.map((code) => catalogue?.bikes.find((bike) => bike.modelCode === code))
      .filter((bike): bike is ShowroomBike => Boolean(bike)),
    [catalogue, compareModelCodes],
  );
  const comparisonRows: Array<{ label: string; value: (bike: ShowroomBike) => string }> = [
    { label: 'Engine', value: (bike) => `${bike.engineCc} cc` },
    { label: 'Max power', value: (bike) => bike.maxPower || 'Not published' },
    { label: 'Max torque', value: (bike) => bike.maxTorque || 'Not published' },
    { label: 'Gearbox', value: (bike) => bike.gearbox || 'Not published' },
    { label: 'Brakes', value: (bike) => bike.braking || 'Not published' },
    { label: 'Front suspension', value: (bike) => bike.frontSuspension || 'Not published' },
    { label: 'Rear suspension', value: (bike) => bike.rearSuspension || 'Not published' },
    { label: 'Fuel tank', value: (bike) => bike.fuelTankLitres == null ? 'Not published' : `${bike.fuelTankLitres} L` },
    { label: 'Ground clearance', value: (bike) => bike.groundClearanceMm == null ? 'Not published' : `${bike.groundClearanceMm} mm` },
    { label: 'Kerb weight', value: (bike) => bike.kerbWeightKg == null ? 'Not published' : `${bike.kerbWeightKg} kg` },
    { label: 'Ex-showroom reference', value: (bike) => `${money(bike.exShowroomPrice)} · ${bike.priceCity || 'Price city not stated'}` },
    { label: 'Price checked', value: (bike) => dateLabel(bike.priceVerifiedAt) },
    { label: 'Dealership availability', value: (bike) => bike.availabilityStatus === 'IN_STOCK'
      ? `${bike.availableUnits} unit(s) marked available`
      : bike.availabilityStatus === 'EXPECTED'
        ? (bike.expectedAvailableOn ? `Expected ${dateLabel(bike.expectedAvailableOn)}` : 'Expected; date not confirmed')
        : 'Out of stock' },
  ];

  async function loadOnRoadQuote(bike: ShowroomBike) {
    const location = splitPriceLocation(priceLocation);
    if (!location) {
      setOnRoadQuote(null);
      setQuoteError('Enter the location as City, State before checking an estimate.');
      return;
    }
    setQuoteLoading(true);
    setQuoteError('');
    setOnRoadQuote(null);
    try {
      const params = new URLSearchParams({
        modelCode: bike.modelCode,
        city: location.city,
        state: location.state,
      });
      const response = await fetch(endpoint(`/api/v1/public/catalogue/quotes?${params.toString()}`), {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null) as OnRoadQuote | { message?: string; detail?: string } | null;
      if (!response.ok) {
        const message = payload && 'message' in payload ? payload.message
          : payload && 'detail' in payload ? payload.detail : null;
        throw new Error(message || 'No configured estimate is available. Please request a dealer quote.');
      }
      if (!payload || !('estimatedOnRoadTotal' in payload) || payload.quoteType !== 'ESTIMATE') {
        throw new Error('The pricing service returned an unexpected response.');
      }
      setOnRoadQuote(payload);
      setQuoteLocationKey(`${location.city.toLocaleLowerCase()}|${location.state.toLocaleLowerCase()}`);
    } catch (cause) {
      setQuoteError(cause instanceof Error ? cause.message : 'The location estimate could not be loaded.');
    } finally {
      setQuoteLoading(false);
    }
  }

  const chooseAction = (bike: ShowroomBike, action: ShowroomAction) => {
    setActionError('');
    let preferredAt: string | null = null;
    if (action === 'TEST_RIDE' && preferredRideAt) {
      const requestedDate = new Date(preferredRideAt);
      const now = Date.now();
      if (Number.isNaN(requestedDate.getTime()) || requestedDate.getTime() <= now) {
        setActionError('Choose a future preferred date and time, or leave this optional field blank.');
        return;
      }
      if (requestedDate.getTime() > now + 180 * 24 * 60 * 60 * 1000) {
        setActionError('Choose a preferred time within the next six months.');
        return;
      }
      preferredAt = requestedDate.toISOString();
    }
    if (mode === 'portal') {
      if (!onCustomerRequest) {
        setActionError('Customer bike requests are unavailable right now. Please try again later.');
        return;
      }
      onCustomerRequest(bike, action, preferredAt);
      return;
    }
    onSignIn(bike, action, preferredAt);
  };

  const minRideDateTime = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);

  return (
    <Wrapper className={mode === 'portal' ? 'bajaj-showroom bajaj-showroom-embedded' : 'bajaj-showroom'}>
      <div className="showroom-grain" aria-hidden="true" />
      {mode === 'landing' && <>
      <header className="showroom-nav">
        <a className="showroom-brand" href="#top" aria-label="Lucky Bajaj home">
          <span className="showroom-brand-mark">B</span>
          <span><strong>LUCKY BAJAJ</strong><small>AUTHORISED DEALER EXPERIENCE</small></span>
        </a>
        <button className="showroom-menu-toggle" type="button" aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((value) => !value)} aria-label="Toggle navigation">☰</button>
        <nav className={mobileMenuOpen ? 'showroom-links showroom-links-open' : 'showroom-links'} aria-label="Showroom navigation">
          <a href="#collection" onClick={() => setMobileMenuOpen(false)}>Motorcycles</a>
          <a href="#experience" onClick={() => setMobileMenuOpen(false)}>The experience</a>
          <a href="#offers" onClick={() => setMobileMenuOpen(false)}>Offers</a>
          <button type="button" className="showroom-login" onClick={() => onSignIn()}>My account <span>↗</span></button>
        </nav>
      </header>

      <section id="top" className="showroom-hero">
        <div className="showroom-hero-glow glow-red" aria-hidden="true" />
        <div className="showroom-hero-glow glow-teal" aria-hidden="true" />
        <div className="showroom-hero-copy">
          <div className="showroom-overline"><span /> THE BAJAJ LINE-UP · LUCKY BAJAJ</div>
          <h1>Make every<br /><em>ride</em> a statement.</h1>
          <p>Find the Bajaj that feels like you. Explore the details, discover your next ride and bring the showroom experience closer to home.</p>
          <div className="showroom-hero-actions">
            <a className="showroom-primary-action" href="#collection">Explore the line-up <span>↘</span></a>
            <button className="showroom-quiet-action" type="button" onClick={() => onSignIn()}>Sign in to your account <span>↗</span></button>
          </div>
          <div className="showroom-hero-proof"><span>01 <i> / </i>BAJAJ ONLY</span><span>02 <i> / </i>REAL INVENTORY</span><span>03 <i> / </i>YOUR NEXT RIDE</span></div>
        </div>
        <div className="showroom-hero-stage showroom-orbital-stage" aria-label="Interactive 3D-style Bajaj motorcycle orbit">
          <div className="showroom-stage-disc" aria-hidden="true" />
          <div className="showroom-stage-ring ring-one" aria-hidden="true" />
          <div className="showroom-stage-ring ring-two" aria-hidden="true" />
          <div className="showroom-orbit-track" aria-hidden="true" />
          {heroBikes.map((bike, index) => {
            const angle = ((index - heroSelectedIndex) / Math.max(heroBikes.length, 1)) * Math.PI * 2;
            const depth = Math.cos(angle);
            const x = Math.sin(angle) * 190;
            const y = Math.sin(angle * 2) * 14;
            const scale = 0.64 + ((depth + 1) / 2) * 0.36;
            const style = {
              '--orbit-x': `${x}px`,
              '--orbit-y': `${y}px`,
              '--orbit-depth': `${depth * 105}px`,
              '--orbit-scale': scale,
              '--orbit-depth-order': Math.round((depth + 1) * 10),
            } as CSSProperties;
            const isActive = bike.modelCode === activeHeroBike?.modelCode;
            return <button
              key={bike.modelCode}
              type="button"
              className={`showroom-orbit-bike${isActive ? ' is-active' : ''}`}
              style={style}
              aria-label={`Bring ${bike.modelName} to the front`}
              aria-pressed={isActive}
              onClick={() => setHeroSelectionCode(bike.modelCode)}
            >
              <img src={catalogueAssetUrl(bike.heroImageUrl)} alt="" loading={isActive ? 'eager' : 'lazy'}
                fetchPriority={isActive ? 'high' : 'auto'} decoding="async"
                onError={(event) => { event.currentTarget.dataset.failed = 'true'; }} />
              <span>{bike.modelName}</span>
            </button>;
          })}
          {featured && <div className="showroom-stage-label" aria-live="polite"><span>FEATURED MACHINE</span><strong>{featured.modelName}</strong><small>{featured.engineCc} cc · {featured.maxPower}</small></div>}
          <span className="showroom-stage-index" aria-hidden="true">B / {String(heroSelectedIndex + 1).padStart(2, '0')}</span>
          {heroBikes.length > 1 && <div className="showroom-orbit-controls" aria-label="Choose a motorcycle">
            {heroBikes.map((bike) => <button key={bike.modelCode} type="button"
              className={bike.modelCode === activeHeroBike?.modelCode ? 'is-active' : ''}
              aria-label={`Show ${bike.modelName} in front`}
              aria-pressed={bike.modelCode === activeHeroBike?.modelCode}
              onClick={() => setHeroSelectionCode(bike.modelCode)} />)}
          </div>}
        </div>
        <a className="showroom-scroll-cue" href="#collection"><span /> SCROLL TO DISCOVER</a>
      </section>

      <section className="showroom-marquee" aria-label="Bajaj range">
        <div className="showroom-marquee-track" aria-hidden="true">
          {Array.from({ length: 2 }).flatMap((_, index) => ['FREEDOM', 'PULSAR', 'DOMINAR', 'AVENGER', 'PLATINA', 'CT'].map((name) =>
            <span key={`${index}-${name}`}>{name}<i>✳</i></span>))}
        </div>
      </section>

      <section id="offers" className="showroom-offers" aria-labelledby="showroom-offers-title">
        <div className="showroom-offers-heading">
          <div><div className="showroom-eyebrow">CURRENT DEALER INFORMATION</div><h2 id="showroom-offers-title">Offers worth <em>checking.</em></h2>
            <p>Only active announcements published by Lucky Bajaj with a source link appear here.</p></div>
          <span className="showroom-offers-count">{promotions.length.toString().padStart(2, '0')} LIVE</span>
        </div>
        {promotionsLoading
          ? <p className="showroom-offers-empty" role="status">Checking current dealer announcements…</p>
          : promotions.length === 0
            ? <div className="showroom-offers-empty">
                <p>No public offers are currently published. Contact Lucky Bajaj for current availability and dealer-confirmed terms.</p>
                <article className="showroom-offer-card showroom-official-site-card">
                  <div className="showroom-offer-card-overline"><span>BAJAJ AUTO</span><span>OFFICIAL WEBSITE</span></div>
                  <h3>Explore the official Bajaj range</h3>
                  <p>Review manufacturer-published model information, then confirm local availability and any applicable benefits directly with Lucky Bajaj.</p>
                  <a href="https://www.bajajauto.com/" target="_blank" rel="noreferrer">Open official Bajaj Auto website ↗</a>
                  <small>This is not a dealer quote, discount, loan approval, guaranteed EMI or confirmed offer.</small>
                </article>
              </div>
            : <div className="showroom-offers-grid">
              {promotions.map((promotion) => <article key={promotion.publicId}
                id={`showroom-offer-${promotion.publicId}`}
                className={sharedOfferPublicId === promotion.publicId
                  ? 'showroom-offer-card showroom-offer-card-highlighted' : 'showroom-offer-card'}>
                <div className="showroom-offer-card-overline"><span>LUCKY BAJAJ</span><span>{promotion.modelName || 'BAJAJ RANGE'}</span></div>
                <h3>{promotion.title}</h3>
                <p>{promotion.summary}</p>
                {promotion.terms && <details><summary>Terms and exclusions</summary><p>{promotion.terms}</p></details>}
                <div className="showroom-offer-dates">Valid from {dateLabel(promotion.startsOn)}{promotion.endsOn ? ` to ${dateLabel(promotion.endsOn)}` : ''}</div>
                <a href={promotion.sourceUrl} target="_blank" rel="noreferrer">Review source ↗</a>
                <a className="showroom-offer-share"
                  href={`?offer=${encodeURIComponent(promotion.publicId)}#showroom-offer-${encodeURIComponent(promotion.publicId)}`}>
                  Share offer link ↗
                </a>
                <small>{promotion.disclaimer}</small>
              </article>)}
            </div>}
      </section>
      </>}

      <section id="collection" className="showroom-collection">
        <div className="showroom-section-top">
          <div><div className="showroom-eyebrow">{mode === 'portal' ? 'LUCKY BAJAJ / LIVE CATALOGUE' : `THE COLLECTION / ${catalogue?.bikes.length ?? '—'} MACHINES`}</div>
            <h2>{mode === 'portal' ? <>Explore the Bajaj <em>range.</em></> : <>Find your <em>kind of ride.</em></>}</h2>
            <p>{mode === 'portal' ? 'Browse the same live motorcycle catalogue shown on our public landing page, with the same specifications, reference prices and stock status.' : 'From daily commutes to sport-minded weekends: explore the Bajaj range, model by model.'}</p></div>
          <div className="showroom-toolbar-fields">
            <div className="showroom-search-wrap"><span aria-hidden="true">⌕</span>
              <label className="sr-only" htmlFor="bajaj-model-search">Search Bajaj models</label>
              <input id="bajaj-model-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Bajaj bikes" />
            </div>
            <label className="showroom-price-city"><span>CITY, STATE FOR ON-ROAD ESTIMATE</span>
              <input value={priceLocation} onChange={(event) => { setPriceLocation(event.target.value); setOnRoadQuote(null); setQuoteError(''); setQuoteLocationKey(''); }} maxLength={160} aria-label="City and state for on-road estimate" />
            </label>
          </div>
        </div>
        <div className="showroom-filter-row" role="group" aria-label="Filter motorcycles">
          {categories.map((item) => <button key={item.value} type="button"
            className={category === item.value ? 'showroom-filter active' : 'showroom-filter'}
            onClick={() => setCategory(item.value)}>{item.label}</button>)}
        </div>

        {!loading && comparedBikes.length > 0 && <section className="showroom-comparison-panel" aria-labelledby="showroom-comparison-title">
          <div className="showroom-comparison-header">
            <div>
              <div className="showroom-eyebrow">SIDE-BY-SIDE SPECIFICATIONS</div>
              <h3 id="showroom-comparison-title">Compare your shortlist</h3>
              <p role="status" aria-live="polite">{compareNotice || (comparedBikes.length < 2
                ? 'Select one more bike to compare specifications side by side.'
                : `${comparedBikes.length} bikes selected for comparison.`)}</p>
            </div>
            <button type="button" className="showroom-compare-clear" onClick={clearComparison}>Clear comparison</button>
          </div>
          {comparedBikes.length < 2
            ? <p className="showroom-comparison-hint">Choose at least two Bajaj motorcycles. Your selection is kept in the URL so you can share this comparison.</p>
            : <div className="showroom-comparison-table-wrap" role="region" aria-label="Bike comparison table" tabIndex={0}>
              <table className="showroom-comparison-table">
                <caption className="sr-only">Comparison of selected Bajaj motorcycle specifications and dealership availability</caption>
                <thead><tr><th scope="col">Specification</th>{comparedBikes.map((bike) => <th scope="col" key={bike.modelCode}>
                  <span>{bike.modelName}</span>
                  <div className="showroom-comparison-column-actions">
                    <button type="button" onClick={() => openDetails(bike)} aria-label={`View ${bike.modelName} details`}>View details</button>
                    <button type="button" onClick={() => toggleCompare(bike)} aria-label={`Remove ${bike.modelName} from comparison`}>Remove</button>
                  </div>
                </th>)}</tr></thead>
                <tbody>{comparisonRows.map((row) => <tr key={row.label}>
                  <th scope="row">{row.label}</th>{comparedBikes.map((bike) => <td key={bike.modelCode}>{row.value(bike)}</td>)}
                </tr>)}</tbody>
              </table>
            </div>}
        </section>}

        {loading && <div className="showroom-load-state"><span className="showroom-loader" /><strong>Setting the stage…</strong><p>Loading the live Bajaj catalogue and dealership availability.</p></div>}
        {!loading && error && <div className="showroom-error" role="alert"><strong>The showroom could not load.</strong><p>{error}</p><button type="button" onClick={() => setCatalogueAttempt((attempt) => attempt + 1)}>Retry catalogue ↻</button></div>}
        {!loading && !error && catalogue?.bikes.length === 0 && <div className="showroom-empty">
          <strong>The Bajaj catalogue is not published for this dealership yet.</strong>
          <p>Please contact Lucky Bajaj or try again shortly.</p>
          <button type="button" onClick={() => setCatalogueAttempt((attempt) => attempt + 1)}>Refresh catalogue ↻</button>
        </div>}
        {!loading && !error && (catalogue?.bikes.length ?? 0) > 0 && bikes.length === 0 && <div className="showroom-empty">
          No Bajaj motorcycles match those filters. Try another model or category.
          <button type="button" onClick={() => { setCategory('ALL'); setQuery(''); }}>Clear filters</button>
        </div>}

        {!loading && !error && <div className="showroom-bike-grid">
          {bikes.map((bike, index) => (
            <article className={index === 0 ? 'showroom-bike-card featured-card' : 'showroom-bike-card'} key={bike.modelCode}
              style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}>
              <div className="showroom-card-visual">
                <span className="showroom-card-brand">BAJAJ <i>·</i> {bike.family.toUpperCase()}</span>
                <span className="showroom-card-number">{String(index + 1).padStart(2, '0')}</span>
                <img src={catalogueAssetUrl(bike.heroImageUrl)} alt={`Bajaj ${bike.modelName} motorcycle`} loading="lazy" decoding="async"
                  onError={(event) => { event.currentTarget.dataset.failed = 'true'; }} />
                <span className="showroom-card-engine">{bike.engineCc} <small>CC</small></span>
                <button type="button" className="showroom-card-view" onClick={() => openDetails(bike)} aria-label={`View ${bike.modelName} details`}>↗</button>
              </div>
              <div className="showroom-card-content">
                <div className="showroom-card-overline">{bike.rideCharacter}</div>
                <h3>{bike.modelName}</h3>
                <div className="showroom-card-specs"><span><small>POWER</small><b>{bike.maxPower}</b></span><span><small>TORQUE</small><b>{bike.maxTorque}</b></span></div>
                <div className="showroom-card-price"><div><small>EX-SHOWROOM · {bike.priceCity.toUpperCase()}</small><strong>{money(bike.exShowroomPrice)}</strong></div>
                  <span className={bike.availabilityStatus === 'IN_STOCK' ? 'showroom-stock in-stock' : 'showroom-stock'}>{bike.availabilityStatus === 'IN_STOCK' ? 'In stock' : bike.availabilityStatus === 'EXPECTED' ? 'Expected' : 'Out of stock'}</span></div>
                {bike.availabilityStatus !== 'IN_STOCK' && <p className="showroom-availability-note">{bike.availabilityStatus === 'EXPECTED' ? (bike.expectedAvailableOn ? `Expected availability: ${dateLabel(bike.expectedAvailableOn)}` : 'Expected availability date not confirmed') : 'Currently out of stock — ask Lucky Bajaj about the next delivery.'}</p>}
                <button type="button" className="showroom-onroad-note" onClick={() => openDetails(bike)}>On-road in {priceLocation || 'your city'} <strong>Check estimate ↗</strong></button>
                <div className="showroom-card-actions"><button type="button" className="showroom-card-secondary" onClick={() => openDetails(bike)}>Explore specs</button>
                  <button type="button" className="showroom-card-primary" onClick={() => openDetails(bike)}>Test ride <span>↗</span></button></div>
                <button type="button" className="showroom-compare-toggle" aria-pressed={compareModelCodes.includes(bike.modelCode)}
                  aria-label={`${compareModelCodes.includes(bike.modelCode) ? 'Remove' : 'Add'} ${bike.modelName} ${compareModelCodes.includes(bike.modelCode) ? 'from' : 'to'} comparison`}
                  onClick={() => toggleCompare(bike)}>
                  {compareModelCodes.includes(bike.modelCode) ? '✓ In comparison · Remove' : '+ Compare bike'}
                </button>
              </div>
            </article>
          ))}
        </div>}
        <p className="showroom-pricing-disclaimer">Prices shown are the Bajaj Auto reference ex-showroom prices for New Delhi captured on the date displayed for each model. They are not an on-road quotation. Registration, insurance, location and current offer terms affect the final price; confirm with Lucky Bajaj before purchase.</p>
      </section>

      {mode === 'landing' && <>
      <section id="experience" className="showroom-experience">
        <div className="showroom-experience-art"><span className="experience-orbit orbit-a" /><span className="experience-orbit orbit-b" />
          <div className="experience-card"><small>YOUR NEXT CHAPTER</small><strong>Not just a bike.<br /><em>Your kind of freedom.</em></strong><span>LUCKY BAJAJ · DISCOVER MORE</span></div>
        </div>
        <div className="showroom-experience-copy"><div className="showroom-eyebrow">THE RIDE CONTINUES</div><h2>From first look<br />to <em>first ride.</em></h2>
          <p>Explore anonymously. When you are ready, sign in and carry your selected Bajaj model into your test-ride or purchase journey.</p>
          <button type="button" className="showroom-primary-action" onClick={() => onSignIn()}>Open customer account <span>↗</span></button>
          <div className="showroom-experience-steps"><span><b>01</b> Find your model</span><span><b>02</b> Request a test ride</span><span><b>03</b> Make it yours</span></div></div>
      </section>

      <section id="offers" className="showroom-offers">
        <div className="showroom-offer-copy"><div className="showroom-eyebrow">YOUR DEALERSHIP, CLOSER</div><h2>Good rides.<br /><em>Better journeys.</em></h2><p>Ask our team about current Bajaj offers, financing eligibility, on-road pricing and service support. Offers are confirmed against the selected model and your location.</p>
          <button type="button" className="showroom-primary-action" onClick={() => onSignIn()}>Connect with Lucky Bajaj <span>↗</span></button></div>
        <div className="showroom-offer-panel"><span className="offer-light" /><small>LUCKY BAJAJ / CUSTOMER EXPERIENCE</small><strong>THE NEXT<br />RIDE IS YOURS.</strong><span className="offer-panel-rule" /><span>Browse the Bajaj range. Choose with confidence.</span></div>
      </section>

      <footer className="showroom-footer showroom-footer--composed">
        <a className="showroom-brand" href="#top" aria-label="Return to Lucky Bajaj showroom top">
          <span className="showroom-brand-mark">B</span>
          <span><strong>LUCKY BAJAJ</strong><small>THE RIDE STARTS HERE</small></span>
        </a>
        <p>Catalogue and reference prices are subject to official updates and dealer confirmation. Stock, offers and requests must be confirmed by the dealership.</p>
        <nav className="showroom-footer-links" aria-label="Legal information">
          <button type="button" onClick={() => onNavigate('privacy')}>Privacy policy</button>
          <button type="button" onClick={() => onNavigate('terms')}>Terms &amp; conditions</button>
        </nav>
        <a className="quantaedge-attribution" href="https://qe.thinkwithsujeet.in/" target="_blank" rel="noreferrer"
          aria-label="Developed by QuantaEdge — Smarter Decisions. Greater Growth.">
          <span>Developed by</span>
          <img src="/branding/quantaedge-logo.svg" alt="QuantaEdge — Smarter Decisions. Greater Growth." loading="lazy" />
        </a>
        <button type="button" className="showroom-footer-signin" onClick={() => onSignIn()}>Customer sign in ↗</button>
      </footer>
      </>}

      {selected && <div className="showroom-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
        <section className="showroom-bike-modal" role="dialog" aria-modal="true" aria-labelledby="showroom-modal-title">
          <button ref={closeButtonRef} className="showroom-modal-close" type="button" onClick={closeDetails} aria-label="Close bike details">×</button>
          <div className="showroom-modal-image"><img src={catalogueAssetUrl(selected.heroImageUrl)} alt={`Bajaj ${selected.modelName}`}
            onError={(event) => {
              event.currentTarget.dataset.failed = 'true';
              event.currentTarget.parentElement?.setAttribute('data-image-failed', 'true');
            }} /></div>
          <div className="showroom-modal-copy"><div className="showroom-eyebrow">BAJAJ / {selected.family.toUpperCase()}</div><h2 id="showroom-modal-title">{selected.modelName}</h2>
            <p>{selected.rideCharacter}. Explore the key details before requesting a test ride or purchase discussion.</p>
            <div className="showroom-modal-price"><small>EX-SHOWROOM · {selected.priceCity}</small><strong>{money(selected.exShowroomPrice)}</strong><span>Reference price checked {dateLabel(selected.priceVerifiedAt)}</span></div>
            <div className="showroom-modal-spec-grid"><div><small>ENGINE</small><strong>{selected.engineCc} cc</strong></div><div><small>MAX POWER</small><strong>{selected.maxPower}</strong></div><div><small>MAX TORQUE</small><strong>{selected.maxTorque}</strong></div>
              {selected.gearbox && <div><small>GEARBOX</small><strong>{selected.gearbox}</strong></div>}
              {selected.braking && <div><small>BRAKES</small><strong>{selected.braking}</strong></div>}
              {selected.groundClearanceMm && <div><small>GROUND CLEARANCE</small><strong>{selected.groundClearanceMm} mm</strong></div>}
              {selected.fuelTankLitres && <div><small>FUEL TANK</small><strong>{selected.fuelTankLitres} L</strong></div>}
            </div>
            <ul className="showroom-highlight-list">{selected.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
            <p className="showroom-modal-stock">{selected.availableUnits > 0 ? `${selected.availableUnits} physical unit(s) currently marked available in dealership inventory.` : selected.availabilityStatus === 'EXPECTED' ? `Expected availability: ${selected.expectedAvailableOn ? dateLabel(selected.expectedAvailableOn) : 'date not confirmed'}.` : 'Currently out of stock; contact Lucky Bajaj to confirm availability.'}</p>
            <div className="showroom-quote-panel">
              <div className="showroom-quote-heading"><strong>On-road estimate</strong><span>{priceLocation || 'Enter City, State'}</span></div>
              <p>Only shown when Lucky Bajaj has saved a sourced profile for this model and location. This is an estimate, not a guaranteed offer.</p>
              <button type="button" className="showroom-card-secondary" disabled={quoteLoading} onClick={() => void loadOnRoadQuote(selected)}>
                {quoteLoading ? 'Calculating…' : 'Check configured estimate'}
              </button>
              {quoteError && <p className="showroom-ride-time-error" role="alert">{quoteError}</p>}
              {onRoadQuote && onRoadQuote.modelCode === selected.modelCode && quoteLocationKey === (splitPriceLocation(priceLocation) ? `${splitPriceLocation(priceLocation)!.city.toLocaleLowerCase()}|${splitPriceLocation(priceLocation)!.state.toLocaleLowerCase()}` : '') &&
                <div className="showroom-quote-result">
                  <small>Estimate valid from {dateLabel(onRoadQuote.effectiveFrom)}{onRoadQuote.effectiveTo ? ` to ${dateLabel(onRoadQuote.effectiveTo)}` : ''}</small>
                  {onRoadQuote.breakdown.map((line) => <div className="showroom-quote-line" key={line.label}><span>{line.label}</span><strong>{money(line.amount)}</strong></div>)}
                  <div className="showroom-quote-total"><span>Estimated on-road total</span><strong>{money(onRoadQuote.estimatedOnRoadTotal)}</strong></div>
                  <a href={onRoadQuote.sourceUrl} target="_blank" rel="noreferrer">Pricing source ↗</a>
                  {onRoadQuote.note && <p>{onRoadQuote.note}</p>}
                  <p className="showroom-quote-disclaimer">{onRoadQuote.disclaimer}</p>
                </div>}
            </div>
            <label className="showroom-preferred-time">
              <span>Preferred test-ride date &amp; time <small>Optional</small></span>
              <input type="datetime-local" value={preferredRideAt} min={minRideDateTime}
                onChange={(event) => { setPreferredRideAt(event.target.value); setActionError(''); }}
                aria-describedby="showroom-ride-time-note" />
            </label>
            <p id="showroom-ride-time-note" className="showroom-ride-time-note">
              This is a preference, not a confirmed appointment. Lucky Bajaj will contact you to confirm the bike and available slot.
            </p>
            {actionError && <p className="showroom-ride-time-error" role="alert">{actionError}</p>}
            <div className="showroom-modal-actions"><button type="button" className="showroom-card-secondary" disabled={requesting} onClick={() => chooseAction(selected, 'PURCHASE')}>Enquire / purchase</button><button type="button" className="showroom-card-primary" disabled={requesting} onClick={() => chooseAction(selected, 'TEST_RIDE')}>{requesting ? 'Sending…' : 'Request test ride ↗'}</button></div>
            <a className="showroom-source-link" href={selected.officialModelUrl} target="_blank" rel="noreferrer">View official Bajaj range ↗</a>
          </div>
        </section>
      </div>}
    </Wrapper>
  );
}
