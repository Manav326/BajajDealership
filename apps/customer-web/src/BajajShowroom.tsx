import { useEffect, useMemo, useState } from 'react';

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
};
type Catalogue = {
  manufacturer: string;
  dealershipCode: string | null;
  dealershipName: string | null;
  priceReferenceCity: string;
  servedAt: string;
  bikes: ShowroomBike[];
};

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
function endpoint(path: string): string {
  return configuredApiBaseUrl ? new URL(path, `${configuredApiBaseUrl}/`).toString() : path;
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

export default function BajajShowroom({ onSignIn }: {
  onSignIn: (bike?: ShowroomBike, action?: ShowroomAction) => void;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ShowroomBike | null>(null);
  const [priceLocation, setPriceLocation] = useState('Bettiah, Bihar');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(endpoint('/api/v1/public/catalogue/bikes'), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message || 'The Bajaj catalogue is not available right now.');
        }
        return response.json() as Promise<Catalogue>;
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
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load Bajaj bikes.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const bikes = useMemo(() => (catalogue?.bikes ?? []).filter((bike) => {
    const matchesCategory = category === 'ALL' || bike.category === category;
    const search = query.trim().toLowerCase();
    const matchesQuery = !search || [bike.modelName, bike.family, bike.category, bike.rideCharacter]
      .some((value) => value.toLowerCase().includes(search));
    return matchesCategory && matchesQuery;
  }), [catalogue, category, query]);

  const featured = (catalogue?.bikes ?? []).find((bike) => bike.modelCode === 'BAJAJ_PULSAR_NS400Z')
    ?? catalogue?.bikes?.[0];

  const chooseAction = (bike: ShowroomBike, action: ShowroomAction) => onSignIn(bike, action);

  return (
    <main className="bajaj-showroom">
      <div className="showroom-grain" aria-hidden="true" />
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
        <div className="showroom-hero-stage" aria-label={featured ? `Bajaj ${featured.modelName}` : 'Bajaj motorcycle showcase'}>
          <div className="showroom-stage-disc" aria-hidden="true" />
          <div className="showroom-stage-ring ring-one" aria-hidden="true" />
          <div className="showroom-stage-ring ring-two" aria-hidden="true" />
          {featured && <img src={featured.heroImageUrl} alt={`Bajaj ${featured.modelName}`} fetchPriority="high" />}
          {featured && <div className="showroom-stage-label"><span>FEATURED MACHINE</span><strong>{featured.modelName}</strong><small>{featured.engineCc} cc · {featured.maxPower}</small></div>}
          <span className="showroom-stage-index" aria-hidden="true">B / 01</span>
        </div>
        <a className="showroom-scroll-cue" href="#collection"><span /> SCROLL TO DISCOVER</a>
      </section>

      <section className="showroom-marquee" aria-label="Bajaj range">
        <div className="showroom-marquee-track" aria-hidden="true">
          {Array.from({ length: 2 }).flatMap((_, index) => ['FREEDOM', 'PULSAR', 'DOMINAR', 'AVENGER', 'PLATINA', 'CT'].map((name) =>
            <span key={`${index}-${name}`}>{name}<i>✳</i></span>))}
        </div>
      </section>

      <section id="collection" className="showroom-collection">
        <div className="showroom-section-top">
          <div><div className="showroom-eyebrow">THE COLLECTION / {catalogue?.bikes.length ?? '—'} MACHINES</div>
            <h2>Find your <em>kind of ride.</em></h2>
            <p>From daily commutes to sport-minded weekends: explore the Bajaj range, model by model.</p></div>
          <div className="showroom-toolbar-fields">
            <div className="showroom-search-wrap"><span aria-hidden="true">⌕</span>
              <label className="sr-only" htmlFor="bajaj-model-search">Search Bajaj models</label>
              <input id="bajaj-model-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Bajaj bikes" />
            </div>
            <label className="showroom-price-city"><span>ON-ROAD QUOTE CITY</span>
              <input value={priceLocation} onChange={(event) => setPriceLocation(event.target.value)} maxLength={80} aria-label="City for on-road quote" />
            </label>
          </div>
        </div>
        <div className="showroom-filter-row" role="group" aria-label="Filter motorcycles">
          {categories.map((item) => <button key={item.value} type="button"
            className={category === item.value ? 'showroom-filter active' : 'showroom-filter'}
            onClick={() => setCategory(item.value)}>{item.label}</button>)}
        </div>

        {loading && <div className="showroom-load-state"><span className="showroom-loader" /><strong>Setting the stage…</strong><p>Loading the live Bajaj catalogue and dealership availability.</p></div>}
        {!loading && error && <div className="showroom-error" role="alert"><strong>The showroom could not load.</strong><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Retry catalogue ↻</button></div>}
        {!loading && !error && bikes.length === 0 && <div className="showroom-empty">No Bajaj motorcycles match that search. Try another model or category.</div>}

        {!loading && !error && <div className="showroom-bike-grid">
          {bikes.map((bike, index) => (
            <article className={index === 0 ? 'showroom-bike-card featured-card' : 'showroom-bike-card'} key={bike.modelCode}
              style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}>
              <div className="showroom-card-visual">
                <span className="showroom-card-brand">BAJAJ <i>·</i> {bike.family.toUpperCase()}</span>
                <span className="showroom-card-number">{String(index + 1).padStart(2, '0')}</span>
                <img src={bike.heroImageUrl} alt={`Bajaj ${bike.modelName} motorcycle`} loading="lazy" decoding="async"
                  onError={(event) => { event.currentTarget.dataset.failed = 'true'; }} />
                <span className="showroom-card-engine">{bike.engineCc} <small>CC</small></span>
                <button type="button" className="showroom-card-view" onClick={() => setSelected(bike)} aria-label={`View ${bike.modelName} details`}>↗</button>
              </div>
              <div className="showroom-card-content">
                <div className="showroom-card-overline">{bike.rideCharacter}</div>
                <h3>{bike.modelName}</h3>
                <div className="showroom-card-specs"><span><small>POWER</small><b>{bike.maxPower}</b></span><span><small>TORQUE</small><b>{bike.maxTorque}</b></span></div>
                <div className="showroom-card-price"><div><small>EX-SHOWROOM · {bike.priceCity.toUpperCase()}</small><strong>{money(bike.exShowroomPrice)}</strong></div>
                  <span className={bike.availableUnits > 0 ? 'showroom-stock in-stock' : 'showroom-stock'}>{bike.availableUnits > 0 ? 'In stock' : bike.expectedUnits > 0 ? 'Arriving' : 'Check availability'}</span></div>
                <p className="showroom-onroad-note">On-road in {priceLocation || 'your city'} <strong>Request a quote ↗</strong></p>
                <div className="showroom-card-actions"><button type="button" className="showroom-card-secondary" onClick={() => setSelected(bike)}>Explore specs</button>
                  <button type="button" className="showroom-card-primary" onClick={() => chooseAction(bike, 'TEST_RIDE')}>Test ride <span>↗</span></button></div>
              </div>
            </article>
          ))}
        </div>}
        <p className="showroom-pricing-disclaimer">Prices shown are the Bajaj Auto reference ex-showroom prices for New Delhi captured on the date displayed for each model. They are not an on-road quotation. Registration, insurance, location and current offer terms affect the final price; confirm with Lucky Bajaj before purchase.</p>
      </section>

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

      <footer className="showroom-footer"><a className="showroom-brand" href="#top"><span className="showroom-brand-mark">B</span><span><strong>LUCKY BAJAJ</strong><small>THE RIDE STARTS HERE</small></span></a>
        <p>Catalogue and reference prices are subject to official updates and dealer confirmation.</p><button type="button" onClick={() => onSignIn()}>Customer sign in ↗</button></footer>

      {selected && <div className="showroom-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <section className="showroom-bike-modal" role="dialog" aria-modal="true" aria-labelledby="showroom-modal-title">
          <button className="showroom-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close bike details">×</button>
          <div className="showroom-modal-image"><img src={selected.heroImageUrl} alt={`Bajaj ${selected.modelName}`} /></div>
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
            <p className="showroom-modal-stock">{selected.availableUnits > 0 ? `${selected.availableUnits} physical unit(s) currently marked available in dealership inventory.` : 'Exact physical availability must be confirmed with the dealership; the catalogue record does not imply a bike is in stock.'}</p>
            <p className="showroom-modal-stock">On-road price for {priceLocation || 'your location'}: request a current, location-specific quote.</p>
            <div className="showroom-modal-actions"><button type="button" className="showroom-card-secondary" onClick={() => chooseAction(selected, 'PURCHASE')}>Enquire / purchase</button><button type="button" className="showroom-card-primary" onClick={() => chooseAction(selected, 'TEST_RIDE')}>Book a test ride ↗</button></div>
            <a className="showroom-source-link" href={selected.officialModelUrl} target="_blank" rel="noreferrer">View official Bajaj range ↗</a>
          </div>
        </section>
      </div>}
    </main>
  );
}
