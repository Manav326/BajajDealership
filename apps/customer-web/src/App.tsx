import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import BajajShowroom, { type ShowroomAction, type ShowroomBike } from './BajajShowroom';
import GoogleSignInButton, { type CustomerGoogleSession } from './auth/GoogleSignInButton';

type CustomerProfile = {
  publicId: string; customerCode: string; fullName: string; phone: string | null; alternatePhone: string | null;
  email: string | null; preferredLanguage: 'hi' | 'en' | 'hinglish'; profilePhotoAvailable: boolean;
  dealershipCode: string; dealershipName: string;
};
type CustomerAddress = {
  publicId: string; label: 'HOME' | 'WORK' | 'OTHER'; recipientName: string; phone: string;
  addressLine1: string; addressLine2: string | null; landmark: string | null; locality: string | null;
  city: string; district: string | null; state: string; postalCode: string; country: string;
  isDefaultDelivery: boolean; createdAt: string; updatedAt: string;
};
type AddressForm = {
  label: 'HOME' | 'WORK' | 'OTHER'; recipientName: string; phone: string; addressLine1: string;
  addressLine2: string; landmark: string; locality: string; city: string; district: string;
  state: string; postalCode: string; country: string; isDefaultDelivery: boolean;
};
type MotorcyclePurchase = {
  publicId: string; invoiceNumber: string; modelName: string; variantName: string | null; colourName: string | null;
  modelYear: number | null; invoiceTotal: number; paidAmount: number; creditedAmount: number; balanceDue: number;
  invoiceIssuedAt: string | null; deliveredAt: string; deliveredToName: string;
};
type PortalSession = { accessToken: string; expiresAt: string; customer: CustomerProfile };
type Vehicle = {
  publicId: string; modelName: string; variantName: string | null; colourName: string | null;
  modelYear: number | null; chassisNumber: string; engineNumber: string; ownershipStartedAt: string;
};
type ServiceHistory = {
  jobCardPublicId: string; jobCardCode: string; status: string; customerConcern: string;
  modelName: string; variantName: string | null; colourName: string | null; chassisNumber: string;
  checkedInAt: string; completedAt: string | null; deliveredAt: string | null;
  invoiceNumber: string | null; invoiceStatus: string | null; invoiceIssuedAt: string | null;
  invoiceTotal: number; paidAmount: number; balanceDue: number; invoiceNotice: string;
};
type Appointment = {
  publicId: string; appointmentCode: string; vehiclePublicId: string; modelName: string;
  variantName: string | null; colourName: string | null; chassisNumber: string;
  scheduledFor: string; slotMinutes: number; customerConcern: string; customerLanguage: string;
  source: string; status: string; statusReason: string | null; checkedInAt: string | null;
  createdAt: string; updatedAt: string;
};
type CustomerNotification = {
  recipientPublicId: string; campaignPublicId: string; title: string; summary: string;
  contentDocumentJson: string; senderName: string; status: string; createdAt: string; readAt: string | null;
};
type NotificationPage = {
  items: CustomerNotification[]; page: number; pageSize: number; total: number; unreadCount: number;
};

type CustomerSalesRequest = {
  publicId: string; requestCode: string; requestType: 'TEST_RIDE' | 'PURCHASE';
  modelCode: string; modelName: string; preferredAt: string | null; notes: string | null;
  status: 'REQUESTED' | 'CONVERTED' | 'CANCELLED'; createdAt: string; updatedAt: string;
  convertedEnquiryPublicId: string | null; customerPublicId: string; customerCode: string;
  customerName: string; customerPhone: string | null; customerEmail: string | null;
  enquiryCode: string | null; enquiryStatus: string | null;
  testRideCode: string | null; testRideStatus: string | null; testRideScheduledStart: string | null;
  bookingCode: string | null; bookingStatus: string | null;
  invoiceNumber: string | null; invoiceStatus: string | null; invoiceTotal: number | null;
  paidAmount: number; creditedAmount: number | null; balanceDue: number | null; deliveredAt: string | null;
};

type PendingShowroomIntent = {
  source?: 'PUBLIC_SHOWROOM' | 'CUSTOMER_PORTAL';
  action: ShowroomAction; modelCode: string; modelName: string; selectedAt: string; idempotencyKey: string;
  preferredAt?: string | null;
};
type RetailPart = {
  publicId: string; skuCode: string; partName: string; description: string | null; unitOfMeasure: string;
  retailPrice: number | null; fitmentModelCodes: string[]; imageUrl: string | null;
  quantityAvailable: number; available: boolean; availabilityStatus: 'AVAILABLE' | 'OUT_OF_STOCK' | 'CHECK_WITH_DEALER';
  fitmentVerified: boolean; category: string; partNumber: string | null; sourceUrl: string | null;
  sourceVerifiedAt: string | null; sourceDataStatus: string;
};
type RetailPartFilters = {
  categories: string[];
  motorcycleModels: Array<{ modelCode: string; modelName: string; family: string; category: string }>;
};
type RetailOrderLine = {
  partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantity: number; unitPrice: number; lineTotal: number;
};
type RetailOrder = {
  publicId: string; orderCode: string; status: string; paymentMethod: string; paymentStatus: string;
  orderTotal: number; fulfillmentMethod: 'PICKUP' | 'DELIVERY'; deliveryAddress: string | null;
  deliveryFee: number; deliveryQuoteStatus: string; deliveryQuoteNote: string | null; deliveryQuotedAt: string | null;
  customerNote: string | null; createdAt: string; updatedAt: string;
  cancelledAt: string | null; fulfilledAt: string | null; returnedAt: string | null;
  returnReason: string | null; restockedOnReturn: boolean | null; customerName: string;
  customerCode: string; customerPhone: string | null; lines: RetailOrderLine[];
};
type CartLine = { partPublicId: string; quantity: string };

type AuthMode = 'login' | 'activate';
type PublicLegalRoute = 'privacy' | 'terms';
type CustomerRoute = 'showroom' | 'signin' | 'signup' | 'portal' | PublicLegalRoute;
type LoginIdentifierMode = 'customerCode' | 'username';
type PortalTab = 'home' | 'profile' | 'purchases' | 'bikes' | 'vehicles' | 'service' | 'appointments' | 'notifications' | 'requests' | 'parts';

const emptyAddressForm: AddressForm = {
  label: 'HOME', recipientName: '', phone: '', addressLine1: '', addressLine2: '', landmark: '',
  locality: '', city: '', district: '', state: '', postalCode: '', country: 'India', isDefaultDelivery: false,
};
function formatAddress(address: CustomerAddress): string {
  return [address.addressLine1, address.addressLine2, address.landmark ? 'Near ' + address.landmark : null,
    address.locality, address.city, address.district, address.state, address.postalCode, address.country]
    .filter((part): part is string => Boolean(part && part.trim())).join(', ');
}
const SESSION_KEY = 'qe_customer_portal_token';

function routeFromLocation(): CustomerRoute {
  const requestedView = new URLSearchParams(window.location.search).get('view');
  if (requestedView === 'signin') return 'signin';
  if (requestedView === 'signup') return 'signup';
  if (requestedView === 'privacy' || requestedView === 'terms') return requestedView;
  if (requestedView === 'portal') {
    return window.sessionStorage.getItem(SESSION_KEY) ? 'portal' : 'signin';
  }
  return 'showroom';
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const renderApiFallback = window.location.hostname === 'lucky-bajaj-customer-web.onrender.com'
  ? 'https://lucky-bajaj-api.onrender.com' : '';
const apiBaseUrl = /^https?:\/\//i.test(configuredApiBaseUrl) ? configuredApiBaseUrl : renderApiFallback;

function apiRequestUrl(path: string): string {
  // Empty locally so the Vite/Docker proxy continues to handle /api routes.
  return apiBaseUrl ? new URL(path, `${apiBaseUrl}/`).toString() : path;
}


async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  // Let the browser generate the multipart boundary for photo uploads.
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiRequestUrl(path), { ...options, headers });
  const body = await response.text();
  let data: unknown = null;
  if (body) {
    try { data = JSON.parse(body); } catch { data = body; }
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data
      ? String((data as { message: unknown }).message)
      : typeof data === 'string' && data ? data : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

function money(value: number | null | undefined) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function dateOnly(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}
function pretty(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}
function toLocalDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const PRIVACY_SECTIONS = [
  {
    title: 'Information used by the customer website',
    paragraphs: [
      'Depending on the features you use, this may include your name and contact details, customer code or username, dealership association, linked motorcycle and vehicle identifiers, service history, appointment requests, sales or test-ride enquiries, spare-parts orders and customer notifications.',
      'Information may be supplied by you, recorded by authorised Lucky Bajaj Agency staff, or created when you use a customer-portal feature.',
    ],
  },
  {
    title: 'How the information is used',
    paragraphs: [
      'The website uses these records to verify your access, show the customer information linked to your account, handle vehicle and service enquiries, manage appointments and spare-parts requests, send relevant updates, protect the service and maintain operational records.',
    ],
  },
  {
    title: 'Access and service providers',
    paragraphs: [
      'Your customer records are intended for Lucky Bajaj Agency workflows and are available to dealership staff according to their access permissions. QuantaEdge provides the software that operates this customer website. When you choose Google sign-in, Google processes the sign-in interaction and provides the verified identity information used by the login flow.',
      'Links to Bajaj Auto or other third-party websites open services operated by those parties and are governed by their own policies.',
    ],
  },
  {
    title: 'Sessions and record retention',
    paragraphs: [
      'The browser keeps the customer portal session token in session storage so it can be used during the current browser session. Customer, vehicle, service and transaction-related records are stored by the application on behalf of the dealership and are retained as needed for customer service, operational records and applicable legal obligations.',
    ],
  },
  {
    title: 'Your questions and requests',
    paragraphs: [
      'For a question about your information or to request access or correction, contact Lucky Bajaj Agency through the dealership channel that manages your customer or service record. Please do not send your password, sign-in code or Google authentication credentials when asking for help.',
    ],
  },
  {
    title: 'Updates',
    paragraphs: [
      'This notice describes the customer website and its currently implemented features. It may be updated when the service or applicable requirements change. Check this page for the latest version.',
    ],
  },
];

const TERMS_SECTIONS = [
  {
    title: 'Catalogue, specifications and prices',
    paragraphs: [
      'Motorcycle specifications, images, offers and reference prices are provided to help you explore the Bajaj range. Manufacturer sources, verification dates and price notes are shown where available. Reference prices and location-based on-road estimates are not a final dealer quotation; the dealership must confirm the applicable model, variant, location, charges, offer terms and current price.',
    ],
  },
  {
    title: 'Enquiries and test rides',
    paragraphs: [
      'Submitting a purchase enquiry or test-ride request sends a request to Lucky Bajaj Agency. It does not reserve a physical motorcycle, confirm stock, book a test-ride slot or complete a sale. The dealership will review availability and confirm the next steps.',
    ],
  },
  {
    title: 'Customer portal and service records',
    paragraphs: [
      'Use the account assigned or activated for you and keep your sign-in details private. The portal displays customer and vehicle records linked to your authenticated account. If a record appears incorrect, ask the dealership to review its source record.',
    ],
  },
  {
    title: 'Spare parts and fulfilment',
    paragraphs: [
      'Parts availability, pricing, delivery charges and fulfilment arrangements are subject to dealership confirmation. If a delivery quote is presented, review and accept it before the order can proceed through the applicable fulfilment flow. A request or status displayed by the website is not, by itself, proof that an external payment has been collected or verified.',
    ],
  },
  {
    title: 'External links and availability',
    paragraphs: [
      'Links to manufacturer information and other external sites are provided for convenience; the destination site controls its own content and terms. Catalogue content and website features can change as dealership records and official sources are updated.',
    ],
  },
  {
    title: 'Questions',
    paragraphs: [
      'For help with a request, vehicle record, service appointment or order, contact Lucky Bajaj Agency through the dealership channel handling that request. These terms do not remove rights that apply under relevant law.',
    ],
  },
];

function CustomerLegalLinks({ onNavigate }: { onNavigate: (route: PublicLegalRoute) => void }) {
  return (
    <nav className="customer-legal-links" aria-label="Policies and legal information">
      <button type="button" onClick={() => onNavigate('privacy')}>Privacy policy</button>
      <button type="button" onClick={() => onNavigate('terms')}>Terms &amp; conditions</button>
    </nav>
  );
}

function QuantaEdgeAttribution() {
  return (
    <a className="quantaedge-attribution" href="https://qe.thinkwithsujeet.in/" target="_blank" rel="noreferrer"
      aria-label="Developed by QuantaEdge — Smarter Decisions. Greater Growth.">
      <span>Developed by</span>
      <img src="/branding/quantaedge-logo.svg" alt="QuantaEdge — Smarter Decisions. Greater Growth." loading="lazy" />
    </a>
  );
}

function CustomerLegalFooter({ onNavigate }: { onNavigate: (route: PublicLegalRoute) => void }) {
  return (
    <footer className="public-footer customer-legal-footer">
      <span className="customer-footer-copyright">© {new Date().getFullYear()} Lucky Bajaj Agency</span>
      <CustomerLegalLinks onNavigate={onNavigate} />
      <QuantaEdgeAttribution />
    </footer>
  );
}

function CustomerLegalPage({ kind, onNavigate }: {
  kind: PublicLegalRoute;
  onNavigate: (route: CustomerRoute) => void;
}) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;
  return (
    <main className="public-legal-screen">
      <header className="public-legal-header">
        <a className="public-legal-brand" href="/" onClick={(event) => {
          event.preventDefault();
          onNavigate('showroom');
        }} aria-label="Return to Lucky Bajaj showroom">
          <span className="showroom-brand-mark">B</span>
          <span><strong>LUCKY BAJAJ</strong><small>AUTHORISED DEALER EXPERIENCE</small></span>
        </a>
        <button type="button" className="public-legal-back" onClick={() => onNavigate('showroom')}>← Back to showroom</button>
      </header>
      <article className="public-legal-content">
        <span className="public-legal-eyebrow">LUCKY BAJAJ AGENCY · CUSTOMER WEBSITE</span>
        <h1>{isPrivacy ? 'Privacy policy' : 'Terms & conditions'}</h1>
        <p className="public-legal-updated">Customer website information · Updated 29 October 2026</p>
        <p className="public-legal-intro">{isPrivacy
          ? 'This page explains the customer information used when you browse the Lucky Bajaj showroom or use its customer portal. Lucky Bajaj Agency operates the dealership workflows; QuantaEdge provides the software.'
          : 'These terms explain the limits of the public catalogue and the request-based customer features provided through the Lucky Bajaj website.'}</p>
        {sections.map((section) => (
          <section className="public-legal-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <div className="public-legal-actions">
          <button type="button" className="showroom-primary-action" onClick={() => onNavigate('showroom')}>Return to showroom <span>↗</span></button>
          <button type="button" className="public-legal-signin" onClick={() => onNavigate('signin')}>Customer sign in</button>
        </div>
      </article>
      <CustomerLegalFooter onNavigate={onNavigate} />
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(SESSION_KEY) ?? '');
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [profileForm, setProfileForm] = useState({ fullName: '', phone: '', alternatePhone: '', email: '', preferredLanguage: 'hi' as CustomerProfile['preferredLanguage'] });
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([]);
  const [addressForm, setAddressForm] = useState<AddressForm | null>(null);
  const [editingAddressId, setEditingAddressId] = useState('');
  const [addressSaving, setAddressSaving] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [motorcyclePurchases, setMotorcyclePurchases] = useState<MotorcyclePurchase[]>([]);
  const [selectedDeliveryAddressId, setSelectedDeliveryAddressId] = useState('');
  const [route, setRoute] = useState<CustomerRoute>(routeFromLocation);
  const [authMode, setAuthMode] = useState<AuthMode>(() => new URLSearchParams(window.location.search).get('view') === 'signup' ? 'activate' : 'login');
  const [loginIdentifierMode, setLoginIdentifierMode] = useState<LoginIdentifierMode>('customerCode');
  const [tab, setTab] = useState<PortalTab>('home');
  const [loadingSession, setLoadingSession] = useState(Boolean(window.sessionStorage.getItem(SESSION_KEY)));
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [history, setHistory] = useState<ServiceHistory[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [salesRequests, setSalesRequests] = useState<CustomerSalesRequest[]>([]);
  const [retailParts, setRetailParts] = useState<RetailPart[]>([]);
  const [retailPartFilters, setRetailPartFilters] = useState<RetailPartFilters>({ categories: [], motorcycleModels: [] });
  const [partSearch, setPartSearch] = useState('');
  const [partCategoryFilter, setPartCategoryFilter] = useState('ALL');
  const [partModelFilter, setPartModelFilter] = useState('');
  const [partBikeTypeFilter, setPartBikeTypeFilter] = useState('');
  const [partAvailabilityFilter, setPartAvailabilityFilter] = useState('ALL');
  const [partMinPrice, setPartMinPrice] = useState('');
  const [partMaxPrice, setPartMaxPrice] = useState('');
  const [partSort, setPartSort] = useState('CATEGORY');
  const [retailOrders, setRetailOrders] = useState<RetailOrder[]>([]);
  const [retailCart, setRetailCart] = useState<CartLine[]>([]);
  const [fitmentModelCode, setFitmentModelCode] = useState('');
  const [partsOrderNote, setPartsOrderNote] = useState('');
  const [retailFulfillmentMethod, setRetailFulfillmentMethod] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [retailDeliveryAddress, setRetailDeliveryAddress] = useState('');
  const [partsOrderKey, setPartsOrderKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `retail-${Date.now()}`);
  const [notificationPage, setNotificationPage] = useState<NotificationPage>({
    items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0,
  });
  const [loginForm, setLoginForm] = useState({ dealershipCode: '', username: '', customerCode: '', password: '' });
  const [activationForm, setActivationForm] = useState({ activationToken: '', username: '', password: '', confirmPassword: '' });
  const [appointmentForm, setAppointmentForm] = useState({
    vehiclePublicId: '', scheduledFor: toLocalDateTime(new Date(Date.now() + 86_400_000)),
    slotMinutes: '60', customerConcern: '', customerLanguage: 'hi',
  });
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});

  const navigateCustomerRoute = useCallback((nextRoute: CustomerRoute, replace = false) => {
    const url = new URL(window.location.href);
    if (nextRoute === 'showroom') url.searchParams.delete('view');
    else {
      url.searchParams.set('view', nextRoute);
      // Keep auth and legal URLs canonical even when the customer entered from a showroom anchor.
      url.hash = '';
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      if (replace) window.history.replaceState(window.history.state, '', nextUrl);
      else window.history.pushState(window.history.state, '', nextUrl);
    }
    setRoute(nextRoute);
    setAuthMode(nextRoute === 'signup' ? 'activate' : 'login');
  }, []);

  const clearSession = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_KEY);
    setToken('');
    setCustomer(null);
    setProfileForm({ fullName: '', phone: '', alternatePhone: '', email: '', preferredLanguage: 'hi' });
    setCustomerAddresses([]); setAddressForm(null); setEditingAddressId(''); setProfilePhotoUrl('');
    setMotorcyclePurchases([]); setSelectedDeliveryAddressId('');
    setVehicles([]);
    setHistory([]);
    setAppointments([]);
    setSalesRequests([]);
    setRetailParts([]);
    setRetailPartFilters({ categories: [], motorcycleModels: [] });
    setPartSearch('');
    setPartCategoryFilter('ALL');
    setPartModelFilter('');
    setPartBikeTypeFilter('');
    setPartAvailabilityFilter('ALL');
    setPartMinPrice('');
    setPartMaxPrice('');
    setRetailOrders([]);
    setRetailCart([]);
    setRetailFulfillmentMethod('PICKUP');
    setRetailDeliveryAddress('');
    setNotificationPage({ items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0 });
    setTab('home');
    navigateCustomerRoute('signin', true);
  }, [navigateCustomerRoute]);

  const loadPortalData = useCallback(async (sessionToken: string) => {
    setLoadingData(true);
    // Keep action-specific recovery feedback visible while a saved showroom intent is unresolved.
    if (!window.sessionStorage.getItem('qe_bajaj_pending_intent')) setError('');
    try {
      const [profile, ownedVehicles, serviceHistory, customerAppointments, customerNotifications, customerRequests, parts, orders, partFilters, addresses, bikePurchases] = await Promise.all([
        api<CustomerProfile>('/api/v1/customer/auth/me', sessionToken),
        api<Vehicle[]>('/api/v1/customer/vehicles', sessionToken),
        api<ServiceHistory[]>('/api/v1/customer/service-history', sessionToken),
        api<Appointment[]>('/api/v1/customer/appointments', sessionToken),
        api<NotificationPage>('/api/v1/customer/notifications?page=0&pageSize=50', sessionToken),
        api<CustomerSalesRequest[]>('/api/v1/customer/sales-requests', sessionToken),
        api<RetailPart[]>('/api/v1/customer/parts', sessionToken),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', sessionToken),
        api<RetailPartFilters>('/api/v1/customer/parts/filters', sessionToken),
        api<CustomerAddress[]>('/api/v1/customer/addresses', sessionToken),
        api<MotorcyclePurchase[]>('/api/v1/customer/purchase-history/motorcycles', sessionToken),
      ]);
      setCustomer(profile);
      setProfileForm({ fullName: profile.fullName ?? '', phone: profile.phone ?? '', alternatePhone: profile.alternatePhone ?? '',
        email: profile.email ?? '', preferredLanguage: profile.preferredLanguage ?? 'hi' });
      const savedAddresses = Array.isArray(addresses) ? addresses : [];
      setCustomerAddresses(savedAddresses);
      setMotorcyclePurchases(Array.isArray(bikePurchases) ? bikePurchases : []);
      setSelectedDeliveryAddressId((current) => current && savedAddresses.some((address) => address.publicId === current)
        ? current : savedAddresses.find((address) => address.isDefaultDelivery)?.publicId ?? '');
      setVehicles(ownedVehicles);
      setHistory(serviceHistory);
      setAppointments(customerAppointments);
      setSalesRequests(customerRequests);
      setRetailParts(Array.isArray(parts) ? parts : []);
      setRetailOrders(Array.isArray(orders) ? orders : []);
      setRetailPartFilters({
        categories: Array.isArray(partFilters?.categories) ? partFilters.categories : [],
        motorcycleModels: Array.isArray(partFilters?.motorcycleModels) ? partFilters.motorcycleModels : [],
      });
      setNotificationPage(customerNotifications);
      const defaultAddress = savedAddresses.find((address) => address.isDefaultDelivery);
      if (defaultAddress) setRetailDeliveryAddress((current) => current.trim() ? current : formatAddress(defaultAddress));
      setAppointmentForm((current) => ({
        ...current,
        vehiclePublicId: current.vehiclePublicId && ownedVehicles.some((vehicle) => vehicle.publicId === current.vehiclePublicId)
          ? current.vehiclePublicId : ownedVehicles[0]?.publicId ?? '',
      }));
    } catch (cause) {
      if (cause instanceof Error && /session|unauthorized|sign in|customer profile is no longer active/i.test(cause.message)) {
        clearSession();
      }
      setError(cause instanceof Error ? cause.message : 'Your customer portal data could not be loaded.');
    } finally {
      setLoadingData(false);
    }
  }, [clearSession]);

  const resumePendingShowroomIntent = useCallback(async (sessionToken: string): Promise<boolean | null> => {
    const raw = window.sessionStorage.getItem('qe_bajaj_pending_intent');
    if (!raw) return null;
    let intent: PendingShowroomIntent;
    try {
      const parsed = JSON.parse(raw) as Partial<PendingShowroomIntent>;
      if ((parsed.action !== 'TEST_RIDE' && parsed.action !== 'PURCHASE')
        || typeof parsed.modelCode !== 'string' || typeof parsed.modelName !== 'string'
        || typeof parsed.idempotencyKey !== 'string'
        || (parsed.preferredAt != null && (typeof parsed.preferredAt !== 'string'
          || !Number.isFinite(Date.parse(parsed.preferredAt))))) {
        throw new Error('The saved showroom selection is incomplete. Please select the Bajaj model again.');
      }
      intent = parsed as PendingShowroomIntent;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved showroom selection could not be read.');
      setTab('requests');
      return false;
    }
    try {
      await api<CustomerSalesRequest>('/api/v1/customer/sales-requests', sessionToken, {
        method: 'POST',
        body: JSON.stringify({
          requestType: intent.action,
          modelCode: intent.modelCode,
          preferredAt: intent.action === 'TEST_RIDE' ? intent.preferredAt ?? null : null,
          notes: intent.source === 'CUSTOMER_PORTAL'
            ? 'Request started from the customer portal bike catalogue.'
            : 'Request started from the public Bajaj showroom.',
          idempotencyKey: intent.idempotencyKey,
        }),
      });
      // Keep the original idempotency key until the request can be confirmed in the refreshed list.
      // A failed GET after a successful POST must remain safely retryable without creating duplicates.
      const current = await api<CustomerSalesRequest[]>('/api/v1/customer/sales-requests', sessionToken);
      window.sessionStorage.removeItem('qe_bajaj_pending_intent');
      setSalesRequests(current);
      setTab('requests');
      setSuccess(intent.action === 'TEST_RIDE'
        ? intent.preferredAt
          ? `Your test-ride request for ${intent.modelName}, with preferred time ${new Date(intent.preferredAt).toLocaleString('en-IN')}, was sent to Lucky Bajaj. The team must confirm the bike and slot.`
          : `Your test-ride request for ${intent.modelName} was sent to Lucky Bajaj. The team will confirm the bike and time.`
        : `Your purchase enquiry for ${intent.modelName} was sent to Lucky Bajaj. The team will confirm availability and the next steps.`);
      return true;
    } catch (cause) {
      setTab('requests');
      setError(cause instanceof Error
        ? `${cause.message} Your selected bike is saved; retry the request from this screen.`
        : 'The request could not be submitted. Your selected bike remains saved.');
      return false;
    }
  }, []);

  async function submitPortalBikeIntent(bike: ShowroomBike, action: ShowroomAction, preferredAt: string | null) {
    if (!token || saving) return;
    const intent: PendingShowroomIntent = {
      source: 'CUSTOMER_PORTAL',
      action,
      modelCode: bike.modelCode,
      modelName: bike.modelName,
      selectedAt: new Date().toISOString(),
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `portal-bike-${Date.now()}-${bike.modelCode}`,
      preferredAt: action === 'TEST_RIDE' ? preferredAt : null,
    };
    window.sessionStorage.setItem('qe_bajaj_pending_intent', JSON.stringify(intent));
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await resumePendingShowroomIntent(token);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    // Keep a canonical, reload-safe URL for each public/auth/portal screen.
    navigateCustomerRoute(routeFromLocation(), true);
    const syncRouteFromHistory = () => navigateCustomerRoute(routeFromLocation(), true);
    window.addEventListener('popstate', syncRouteFromHistory);
    return () => window.removeEventListener('popstate', syncRouteFromHistory);
  }, [navigateCustomerRoute]);

  useEffect(() => {
    if (!token || route === 'privacy' || route === 'terms') {
      if (!token) setLoadingSession(false);
      return;
    }
    let cancelled = false;
    api<CustomerProfile>('/api/v1/customer/auth/me', token)
      .then((profile) => {
        if (!cancelled) {
          setCustomer(profile);
          navigateCustomerRoute('portal', true);
          void loadPortalData(token);
        }
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => { if (!cancelled) setLoadingSession(false); });
    return () => { cancelled = true; };
  }, [token, clearSession, loadPortalData, navigateCustomerRoute, route]);

  // Photo bytes are fetched only through the authenticated session; initials remain a fallback.
  useEffect(() => {
    if (!token || route !== 'portal') { setProfilePhotoUrl(''); return; }
    let active = true;
    let objectUrl = '';
    setProfilePhotoUrl('');
    fetch(apiRequestUrl('/api/v1/customer/profile/photo'), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        if (active) { objectUrl = url; setProfilePhotoUrl(url); } else URL.revokeObjectURL(url);
      }).catch(() => { /* Keep initials visible if there is no photo. */ });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [token, route, photoRefreshKey]);

  const acceptGoogleSession = useCallback(async (session: CustomerGoogleSession) => {
    window.sessionStorage.setItem(SESSION_KEY, session.accessToken);
    setError('');
    setSuccess('');
    // Submit a saved showroom intent before the token effect refreshes portal data.
    // This prevents a slower initial GET from replacing the newly created request with a stale list.
    const resumed = await resumePendingShowroomIntent(session.accessToken);
    setCustomer(session.customer);
    setToken(session.accessToken);
    navigateCustomerRoute('portal', true);
    if (resumed === null) setSuccess('Google sign-in verified. Welcome to your Lucky Bajaj customer portal.');
  }, [resumePendingShowroomIntent, navigateCustomerRoute]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const dealershipCode = loginForm.dealershipCode.trim().toUpperCase();
      // Existing customer-code login remains the default; username is an explicit alternative.
      const useUsername = loginIdentifierMode === 'username';
      const session = await api<PortalSession>(
        useUsername ? '/api/v1/customer/auth/username-login' : '/api/v1/customer/auth/login',
        undefined,
        {
          method: 'POST',
          body: JSON.stringify(useUsername
            ? { dealershipCode, username: loginForm.username.trim(), password: loginForm.password }
            : { dealershipCode, customerCode: loginForm.customerCode.trim().toUpperCase(), password: loginForm.password }),
        });
      window.sessionStorage.setItem(SESSION_KEY, session.accessToken);
      setLoginForm((current) => ({ ...current, password: '' }));
      const resumed = await resumePendingShowroomIntent(session.accessToken);
      setCustomer(session.customer);
      setToken(session.accessToken);
      navigateCustomerRoute('portal', true);
      if (resumed === null) setSuccess('You are signed in securely.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally { setSaving(false); }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    if (activationForm.password !== activationForm.confirmPassword) {
      setError('The two passwords do not match.');
      setSaving(false);
      return;
    }
    try {
      const session = await api<PortalSession>('/api/v1/customer/auth/activate-with-username', undefined, {
        method: 'POST',
        body: JSON.stringify({
          activationToken: activationForm.activationToken.trim(),
          username: activationForm.username.trim(),
          password: activationForm.password,
        }),
      });
      window.sessionStorage.setItem(SESSION_KEY, session.accessToken);
      setActivationForm({ activationToken: '', username: '', password: '', confirmPassword: '' });
      const resumed = await resumePendingShowroomIntent(session.accessToken);
      setCustomer(session.customer);
      setToken(session.accessToken);
      navigateCustomerRoute('portal', true);
      if (resumed === null) setSuccess('Your customer account is active. Welcome to Lucky Bajaj.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account activation failed.');
    } finally { setSaving(false); }
  }

  function updateRetailCart(part: RetailPart, delta: number) {
    if (!part.available) return;
    setRetailCart((current) => {
      const existing = current.find((line) => line.partPublicId === part.publicId);
      const quantity = Math.max(0, Number(existing?.quantity ?? 0) + delta);
      if (quantity > Number(part.quantityAvailable)) return current;
      if (quantity === 0) return current.filter((line) => line.partPublicId !== part.publicId);
      if (existing) return current.map((line) => line.partPublicId === part.publicId
        ? { ...line, quantity: String(quantity) } : line);
      return [...current, { partPublicId: part.publicId, quantity: String(quantity) }];
    });
  }

  async function placeRetailOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!retailCart.length) {
      setError('Add at least one available spare part to your cart.');
      return;
    }
    if (retailFulfillmentMethod === 'DELIVERY' && !retailDeliveryAddress.trim()) {
      setError('Enter the delivery address before requesting delivery.');
      return;
    }
    const fitmentRequired = retailCart
      .map((line) => retailParts.find((part) => part.publicId === line.partPublicId))
      .filter((part): part is RetailPart => Boolean(part && part.fitmentVerified && part.fitmentModelCodes.length > 0));
    if (fitmentRequired.length > 0 && !fitmentModelCode) {
      setError('Choose the motorcycle model for the part(s) in your cart before placing the order.');
      return;
    }
    const incompatible = fitmentRequired.find((part) => !part.fitmentModelCodes.includes(fitmentModelCode));
    if (incompatible) {
      setError(`${incompatible.partName} is not verified for the selected motorcycle model. Remove it or change the model.`);
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const order = await api<RetailOrder>('/api/v1/customer/parts/orders', token, {
        method: 'POST',
        body: JSON.stringify({
          lines: retailCart.map((line) => ({ partPublicId: line.partPublicId, quantity: Number(line.quantity) })),
          fitmentModelCode: fitmentModelCode || null,
          customerNote: partsOrderNote.trim() || null,
          fulfillmentMethod: retailFulfillmentMethod,
          deliveryAddress: retailFulfillmentMethod === 'DELIVERY' ? retailDeliveryAddress.trim() : null,
          idempotencyKey: partsOrderKey,
        }),
      });
      const [parts, orders] = await Promise.all([
        api<RetailPart[]>('/api/v1/customer/parts', token),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', token),
      ]);
      setRetailParts(Array.isArray(parts) ? parts : []);
      setRetailOrders(Array.isArray(orders) ? orders : []);
      setRetailCart([]);
      setPartsOrderNote('');
      setRetailFulfillmentMethod('PICKUP');
      setRetailDeliveryAddress('');
      setPartsOrderKey(globalThis.crypto?.randomUUID?.() ?? `retail-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setSuccess(order.fulfillmentMethod === 'DELIVERY'
        ? `Delivery request ${order.orderCode} saved. Lucky Bajaj must quote delivery before you accept it; no online payment has been taken.`
        : `Pickup order ${order.orderCode} placed. Pay at dealership pickup; no online payment has been taken.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The spare-parts order could not be placed.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelRetailOrder(order: RetailOrder) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api<RetailOrder>(`/api/v1/customer/parts/orders/${order.publicId}/cancel`, token, { method: 'POST' });
      const [parts, orders] = await Promise.all([
        api<RetailPart[]>('/api/v1/customer/parts', token),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', token),
      ]);
      setRetailParts(Array.isArray(parts) ? parts : []);
      setRetailOrders(Array.isArray(orders) ? orders : []);
      setSuccess(`Order ${order.orderCode} was cancelled and its stock reservation released.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be cancelled.');
    } finally {
      setSaving(false);
    }
  }

  async function respondToDeliveryQuote(order: RetailOrder, accept: boolean) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api<RetailOrder>(`/api/v1/customer/parts/orders/${order.publicId}/delivery-quote-response`, token, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      const [parts, orders] = await Promise.all([
        api<RetailPart[]>('/api/v1/customer/parts', token),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', token),
      ]);
      setRetailParts(Array.isArray(parts) ? parts : []);
      setRetailOrders(Array.isArray(orders) ? orders : []);
      setSuccess(accept
        ? `Delivery quote for ${order.orderCode} accepted. Lucky Bajaj can now arrange delivery; payment is still due on delivery.`
        : `Delivery quote declined. Order ${order.orderCode} was cancelled and its stock reservation released.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your delivery quote response could not be saved.');
    } finally {
      setSaving(false);
    }
  }
  async function retrySavedShowroomRequest() {
    if (!token) {
      setError('Sign in again before retrying the saved showroom request.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const resumed = await resumePendingShowroomIntent(token);
      if (resumed === null) setError('There is no saved showroom request to retry.');
    } finally {
      setSaving(false);
    }
  }

  function discardSavedShowroomRequest() {
    window.sessionStorage.removeItem('qe_bajaj_pending_intent');
    setError('');
    setSuccess('Saved showroom selection cleared. Choose a motorcycle again from the public showroom.');
  }

  async function cancelCustomerSalesRequest(request: CustomerSalesRequest) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api<CustomerSalesRequest>(`/api/v1/customer/sales-requests/${request.publicId}/cancel`, token, { method: 'POST' });
      const refreshed = await api<CustomerSalesRequest[]>('/api/v1/customer/sales-requests', token);
      setSalesRequests(refreshed);
      setSuccess(`Request ${request.requestCode} was cancelled.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request could not be cancelled.');
    } finally {
      setSaving(false);
    }
  }

  async function updateNotification(item: CustomerNotification, action: 'read' | 'unread' | 'dismiss') {
    setError(''); setSuccess('');
    try {
      await api<unknown>(
        `/api/v1/customer/notifications/${item.recipientPublicId}/${action}`, token, { method: 'POST' });
      const refreshed = await api<NotificationPage>(
        '/api/v1/customer/notifications?page=0&pageSize=50', token);
      setNotificationPage(refreshed);
      setSuccess(action === 'dismiss'
        ? 'Notification dismissed from your inbox.'
        : action === 'read' ? 'Notification marked as read.' : 'Notification marked as unread.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification could not be updated.');
    }
  }

  function renderNotificationContent(raw: string) {
    let blocks: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(raw) as { blocks?: unknown };
      if (Array.isArray(parsed.blocks)) {
        blocks = parsed.blocks.filter((block): block is Record<string, unknown> =>
          typeof block === 'object' && block !== null && 'type' in block);
      }
    } catch {
      return <p className="notification-content-text">This update contains a message from the dealership.</p>;
    }
    return <div className="notification-content-blocks">
      {blocks.map((block, index) => {
        const type = String(block.type ?? '');
        const textField = (key: string) => typeof block[key] === 'string' ? String(block[key]) : '';
        if (type === 'hero') return <div className="notification-content-hero" key={index}>
          {textField('eyebrow') && <span>{textField('eyebrow')}</span>}
          {textField('title') && <strong>{textField('title')}</strong>}
          {textField('subtitle') && <p>{textField('subtitle')}</p>}
        </div>;
        if (type === 'richText') return textField('text') ? <p className="notification-content-text" key={index}>{textField('text')}</p> : null;
        if (type === 'serviceCard' || type === 'vehicleCard') return <div className="notification-content-card" key={index}>
          {textField('title') && <strong>{textField('title')}</strong>}
          {textField('description') && <p>{textField('description')}</p>}
        </div>;
        if (type === 'highlight') return <div className="notification-content-highlight" key={index}>
          <span>{textField('label')}</span><strong>{textField('value')}</strong>{textField('description') && <p>{textField('description')}</p>}
        </div>;
        if (type === 'badge') return <span className="notification-content-badge" key={index}>{textField('text') || 'Dealership update'}</span>;
        if (type === 'icon') return <div className="notification-content-card" key={index}>
          <strong>{[textField('icon'), textField('title')].filter(Boolean).join(' ')}</strong>
          {textField('text') && <p>{textField('text')}</p>}
        </div>;
        if (type === 'image') return <div className="notification-content-image-note" key={index}>{textField('caption') || textField('alt') || 'Image included in dealership update'}</div>;
        if (type === 'footer') return textField('text') ? <p className="notification-content-footer" key={index}>{textField('text')}</p> : null;
        if (type === 'divider') return <div className="notification-content-divider" key={index} />;
        return null;
      })}
    </div>;
  }

  async function logout() {
    const currentToken = token;
    clearSession();
    setError(''); setSuccess('');
    try {
      await api<{ success: boolean }>('/api/v1/customer/auth/logout', currentToken, { method: 'POST' });
    } catch {
      navigateCustomerRoute('signin', true);
      setError('This browser session has been cleared. The server could not confirm session revocation; sign in again before continuing.');
      return;
    }
    navigateCustomerRoute('showroom', true);
  }


  function updateAddressField<K extends keyof AddressForm>(key: K, value: AddressForm[K]) {
    setAddressForm((current) => current ? { ...current, [key]: value } : current);
  }
  async function saveCustomerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<CustomerProfile>('/api/v1/customer/profile', token, {
        method: 'PUT', body: JSON.stringify({
          fullName: profileForm.fullName.trim(), phone: profileForm.phone.trim() || null,
          alternatePhone: profileForm.alternatePhone.trim() || null, email: profileForm.email.trim() || null,
          preferredLanguage: profileForm.preferredLanguage,
        }),
      });
      setCustomer(updated);
      setProfileForm({ fullName: updated.fullName, phone: updated.phone ?? '', alternatePhone: updated.alternatePhone ?? '',
        email: updated.email ?? '', preferredLanguage: updated.preferredLanguage });
      setSuccess('Profile saved. Your purchase, service and payment history stays preserved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your profile could not be saved.'); }
    finally { setSaving(false); }
  }
  function beginAddressEdit(address?: CustomerAddress) {
    setEditingAddressId(address?.publicId ?? '');
    setAddressForm(address ? {
      label: address.label, recipientName: address.recipientName, phone: address.phone,
      addressLine1: address.addressLine1, addressLine2: address.addressLine2 ?? '',
      landmark: address.landmark ?? '', locality: address.locality ?? '', city: address.city,
      district: address.district ?? '', state: address.state, postalCode: address.postalCode,
      country: address.country, isDefaultDelivery: address.isDefaultDelivery,
    } : { ...emptyAddressForm, recipientName: customer?.fullName ?? '', phone: customer?.phone ?? '',
      isDefaultDelivery: customerAddresses.length === 0 });
    setError(''); setSuccess('');
  }
  async function saveCustomerAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!addressForm) return;
    setAddressSaving(true); setError(''); setSuccess('');
    const wasEditing = Boolean(editingAddressId);
    try {
      const path = wasEditing ? `/api/v1/customer/addresses/${editingAddressId}` : '/api/v1/customer/addresses';
      await api<CustomerAddress>(path, token, {
        method: wasEditing ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...addressForm, phone: addressForm.phone.trim(), recipientName: addressForm.recipientName.trim(),
          addressLine1: addressForm.addressLine1.trim(), addressLine2: addressForm.addressLine2.trim() || null,
          landmark: addressForm.landmark.trim() || null, locality: addressForm.locality.trim() || null,
          district: addressForm.district.trim() || null, country: addressForm.country.trim() || 'India',
        }),
      });
      const result = await api<CustomerAddress[]>('/api/v1/customer/addresses', token);
      const list = Array.isArray(result) ? result : [];
      setCustomerAddresses(list);
      const defaultAddress = list.find((item) => item.isDefaultDelivery);
      if (defaultAddress) { setSelectedDeliveryAddressId(defaultAddress.publicId); setRetailDeliveryAddress(formatAddress(defaultAddress)); }
      setAddressForm(null); setEditingAddressId('');
      setSuccess(wasEditing ? 'Address updated. Existing orders retain their original address.' : 'Address saved in your address book.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The address could not be saved.'); }
    finally { setAddressSaving(false); }
  }
  async function deleteCustomerAddress(address: CustomerAddress) {
    if (!window.confirm(`Remove the ${address.label.toLowerCase()} address from your address book?`)) return;
    setAddressSaving(true); setError(''); setSuccess('');
    try {
      const result = await api<CustomerAddress[]>(`/api/v1/customer/addresses/${address.publicId}`, token, { method: 'DELETE' });
      const list = Array.isArray(result) ? result : [];
      setCustomerAddresses(list);
      if (selectedDeliveryAddressId === address.publicId) {
        const nextDefault = list.find((item) => item.isDefaultDelivery);
        setSelectedDeliveryAddressId(nextDefault?.publicId ?? '');
        setRetailDeliveryAddress(nextDefault ? formatAddress(nextDefault) : '');
      }
      setAddressForm(null); setEditingAddressId('');
      setSuccess('Address removed. Previously placed orders remain unchanged.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The address could not be removed.'); }
    finally { setAddressSaving(false); }
  }
  async function uploadCustomerPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG or WebP profile photo.'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('Profile photos must be 2 MiB or smaller.'); return; }
    setPhotoBusy(true); setError(''); setSuccess('');
    try {
      const body = new FormData(); body.append('file', file);
      await api<{ saved: boolean }>('/api/v1/customer/profile/photo', token, { method: 'POST', body });
      setCustomer((current) => current ? { ...current, profilePhotoAvailable: true } : current);
      setPhotoRefreshKey((current) => current + 1); setSuccess('Profile photo updated.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile photo could not be uploaded.'); }
    finally { setPhotoBusy(false); }
  }
  async function removeCustomerPhoto() {
    if (!window.confirm('Remove your profile photo and use your initials instead?')) return;
    setPhotoBusy(true); setError(''); setSuccess('');
    try {
      await api<{ success: boolean }>('/api/v1/customer/profile/photo', token, { method: 'DELETE' });
      setCustomer((current) => current ? { ...current, profilePhotoAvailable: false } : current);
      setPhotoRefreshKey((current) => current + 1); setSuccess('Profile photo removed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile photo could not be removed.'); }
    finally { setPhotoBusy(false); }
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointmentForm.vehiclePublicId) {
      setError('Choose one of your currently linked bikes.');
      return;
    }
    const scheduled = new Date(appointmentForm.scheduledFor);
    if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      setError('Choose a future date and time for your service request.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const created = await api<Appointment>('/api/v1/customer/appointments', token, {
        method: 'POST',
        body: JSON.stringify({
          vehiclePublicId: appointmentForm.vehiclePublicId,
          scheduledFor: scheduled.toISOString(),
          slotMinutes: Number(appointmentForm.slotMinutes),
          customerConcern: appointmentForm.customerConcern.trim(),
          customerLanguage: appointmentForm.customerLanguage,
        }),
      });
      setAppointments((current) => [created, ...current]);
      setAppointmentForm((current) => ({ ...current, customerConcern: '' }));
      setSuccess(`Service request ${created.appointmentCode} has been submitted for dealership confirmation.`);
      setTab('appointments');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service request could not be submitted.');
    } finally { setSaving(false); }
  }

  async function cancelAppointment(item: Appointment) {
    const reason = (cancelReasons[item.publicId] ?? '').trim();
    if (!reason) {
      setError('Add a reason before cancelling this appointment.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(
        `/api/v1/customer/appointments/${item.publicId}/cancel`, token, {
          method: 'POST', body: JSON.stringify({ reason }),
        });
      setAppointments((current) => current.map((appointment) =>
        appointment.publicId === updated.publicId ? updated : appointment));
      setSuccess(`Appointment ${updated.appointmentCode} has been cancelled.`);
      setCancelReasons((current) => ({ ...current, [item.publicId]: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appointment could not be cancelled.');
    } finally { setSaving(false); }
  }

  const activeAppointments = appointments.filter((appointment) =>
    ['REQUESTED', 'CONFIRMED'].includes(appointment.status));
  const nextAppointment = activeAppointments
    .slice().sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0];
  const outstanding = history.reduce((sum, job) => sum + Number(job.balanceDue ?? 0), 0);
  const mostRecentService = history[0];
  const hasPendingShowroomIntent = Boolean(window.sessionStorage.getItem('qe_bajaj_pending_intent'));

  if (route === 'privacy' || route === 'terms') {
    return <CustomerLegalPage kind={route} onNavigate={navigateCustomerRoute} />;
  }

  if (loadingSession) {
    return <main className="portal-loading"><div className="brand-mark">Q</div><h1>Opening your customer space</h1><p>Checking your secure session…</p></main>;
  }

  if (!token || !customer) {
    if (route === 'showroom') {
      return <BajajShowroom onSignIn={(bike?: ShowroomBike, action?: ShowroomAction, preferredAt?: string | null) => {
        if (bike && action) {
          sessionStorage.setItem('qe_bajaj_pending_intent', JSON.stringify({
            action, modelCode: bike.modelCode, modelName: bike.modelName,
            preferredAt: action === 'TEST_RIDE' ? preferredAt ?? null : null,
            selectedAt: new Date().toISOString(),
            idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `qe-sales-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          }));
          setSuccess(`${bike.modelName} selected. Sign in to continue your request.`);
        } else {
          setSuccess('');
        }
        setError('');
        navigateCustomerRoute('signin');
      }} onNavigate={navigateCustomerRoute} />;
    }
    return (
      <main className="portal-auth-screen">
        <div className="auth-orb orb-one" /><div className="auth-orb orb-two" /><div className="auth-orb orb-three" />
        <header className="portal-brand">
          <div className="brand-mark">Q</div>
          <div><strong>Quanta<span>Edge</span></strong><small>LUCKY BAJAJ CUSTOMER CARE</small></div>
          <button type="button" className="auth-return-link" onClick={() => {
            setError('');
            setSuccess('');
            navigateCustomerRoute('showroom');
          }}>← Showroom</button>
        </header>
        <section className="auth-layout">
          <div className="auth-story">
            <span className="eyebrow">YOUR BIKE. YOUR SERVICE. ONE PLACE.</span>
            <h1>More care for every kilometre.</h1>
            <p>View your linked bikes, request workshop appointments and keep track of the service work recorded by Lucky Bajaj Agency.</p>
            <div className="story-glass-card">
              <div className="story-bike-mark">LB</div><div><strong>Care that follows your bike</strong><span>Service requests, job progress and recorded bills in one secure view.</span></div><span className="story-spark">✦</span>
            </div>
            <div className="auth-assurances"><span>⌁ Verified customer access</span><span>◇ Your own linked vehicles only</span><span>◌ Secure sign-in sessions</span></div>
          </div>
          <section className="auth-card">
            <div className="auth-card-top"><span className="portal-icon">✦</span><span className="secure-label">PRIVATE CUSTOMER PORTAL</span></div>
            <h2>{authMode === 'login' ? 'Welcome back' : 'Activate your account'}</h2>
            <p className="auth-subtitle">{authMode === 'login'
              ? 'Sign in with your username and password, customer code, or continue securely with Google.'
              : 'Use your one-time dealership invitation token to activate your account, or continue with Google.'}</p>
            {error && <div className="portal-alert alert-error" role="alert">{error}</div>}
            {success && <div className="portal-alert alert-success" role="status">{success}</div>}
            <div className="auth-mode-tabs" role="tablist" aria-label="Customer portal authentication">
              <button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'active' : ''} onClick={() => { setError(''); setSuccess(''); navigateCustomerRoute('signin'); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={authMode === 'activate'} className={authMode === 'activate' ? 'active' : ''} onClick={() => { setError(''); setSuccess(''); navigateCustomerRoute('signup'); }}>Activate account</button>
            </div>
            {authMode === 'login' ? <form className="portal-form" onSubmit={submitLogin}>
              <label>Dealership code<input autoComplete="organization" required maxLength={40} value={loginForm.dealershipCode} onChange={(event) => setLoginForm((current) => ({ ...current, dealershipCode: event.target.value }))} placeholder="Lucky Bajaj code" /></label>
              <div className="auth-login-identifier">
                <div className="auth-login-identifier__label">Sign in with</div>
                <div className="auth-mode-tabs auth-identifier-tabs" role="group" aria-label="Choose sign-in method">
                  <button type="button" className={loginIdentifierMode === 'customerCode' ? 'active' : ''} aria-pressed={loginIdentifierMode === 'customerCode'} onClick={() => setLoginIdentifierMode('customerCode')}>Customer code</button>
                  <button type="button" className={loginIdentifierMode === 'username' ? 'active' : ''} aria-pressed={loginIdentifierMode === 'username'} onClick={() => setLoginIdentifierMode('username')}>Username</button>
                </div>
              </div>
              {loginIdentifierMode === 'customerCode'
                ? <label>Customer code<input autoComplete="username" required maxLength={40} value={loginForm.customerCode} onChange={(event) => setLoginForm((current) => ({ ...current, customerCode: event.target.value }))} placeholder="Your customer code" /></label>
                : <label>Username<input autoComplete="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]{3,40}" value={loginForm.username} onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))} placeholder="Your username" /></label>}
              <label>Password<input type="password" autoComplete="current-password" required maxLength={128} value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Your password" /></label>
              <button className="primary-button portal-submit" type="submit" disabled={saving}>{saving ? 'Signing in…' : 'Sign in securely'} <span>↗</span></button>
            </form> : <form className="portal-form" onSubmit={submitActivation}>
              <label>Dealership code (for Google sign-in)<input maxLength={40} autoComplete="organization" value={loginForm.dealershipCode} onChange={(event) => setLoginForm((current) => ({ ...current, dealershipCode: event.target.value }))} placeholder="Needed only for Google sign-in" /></label>
              <label>One-time activation token<textarea required rows={3} maxLength={128} autoComplete="one-time-code" value={activationForm.activationToken} onChange={(event) => setActivationForm((current) => ({ ...current, activationToken: event.target.value }))} placeholder="Paste the invitation token provided by the dealership" /></label>
              <label>Choose username<input required minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]{3,40}" autoComplete="username" value={activationForm.username} onChange={(event) => setActivationForm((current) => ({ ...current, username: event.target.value }))} placeholder="3–40 letters, numbers, dots, underscores or hyphens" /></label>
              <label>Create password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={activationForm.password} onChange={(event) => setActivationForm((current) => ({ ...current, password: event.target.value }))} placeholder="At least 12 characters" /></label>
              <label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={activationForm.confirmPassword} onChange={(event) => setActivationForm((current) => ({ ...current, confirmPassword: event.target.value }))} placeholder="Enter the same password again" /></label>
              <button className="primary-button portal-submit" type="submit" disabled={saving}>{saving ? 'Activating…' : 'Activate and continue'} <span>↗</span></button>
            </form>}
            <div className="auth-divider"><span>OR CONTINUE WITH</span></div>
            <div className="google-auth-panel">
              <div className="google-auth-panel__heading"><span className="google-auth-panel__spark">G</span><div><strong>{authMode === 'login' ? 'A simpler way to sign in' : 'Create access with Google'}</strong><small>Verified by Google · protected by QuantaEdge</small></div></div>
              <GoogleSignInButton requestUrl={apiRequestUrl} dealershipCode={loginForm.dealershipCode} context={authMode === 'activate' ? 'signup' : 'signin'} onAuthenticated={(session) => void acceptGoogleSession(session)} />
            </div>
            <button type="button" className="showroom-back-link" onClick={() => { setError(''); setSuccess(''); navigateCustomerRoute('showroom'); }}>← Back to Bajaj showroom</button>
            <div className="invite-note"><strong>Need portal access?</strong><span>Ask Lucky Bajaj Agency to verify your customer record and issue an invitation. No account is created from public phone/email matching alone.</span></div>
            <div className="portal-auth-footer">Protected by QuantaEdge <span>•</span> Lucky Bajaj Agency</div>
          </section>
        </section>
        <CustomerLegalFooter onNavigate={navigateCustomerRoute} />
      </main>
    );
  }

  const selectedTypeModelCodes = new Set(
    retailPartFilters.motorcycleModels.filter((model) => !partBikeTypeFilter || model.category === partBikeTypeFilter)
      .map((model) => model.modelCode),
  );
  const displayedRetailParts = retailParts.filter((part) => {
    const query = partSearch.trim().toLocaleLowerCase();
    const matchesQuery = !query || [part.partName, part.skuCode, part.partNumber ?? '', part.category]
      .some((value) => value.toLocaleLowerCase().includes(query));
    const matchesCategory = partCategoryFilter === 'ALL' || part.category === partCategoryFilter;
    const matchesModel = !partModelFilter
      || part.fitmentModelCodes.includes(partModelFilter)
      || (part.fitmentVerified && part.fitmentModelCodes.length === 0);
    const matchesType = !partBikeTypeFilter
      || (part.fitmentModelCodes.some((code) => selectedTypeModelCodes.has(code))
        || (part.fitmentVerified && part.fitmentModelCodes.length === 0));
    const matchesAvailability = partAvailabilityFilter === 'ALL' || part.availabilityStatus === partAvailabilityFilter;
    const price = part.retailPrice;
    const min = partMinPrice.trim() ? Number(partMinPrice) : null;
    const max = partMaxPrice.trim() ? Number(partMaxPrice) : null;
    const matchesPrice = price == null
      ? min == null && max == null
      : (min == null || (Number.isFinite(min) && price >= min))
        && (max == null || (Number.isFinite(max) && price <= max));
    return matchesQuery && matchesCategory && matchesModel && matchesType && matchesAvailability && matchesPrice;
  }).sort((left, right) => {
    if (partSort === 'NAME') return left.partName.localeCompare(right.partName);
    if (partSort === 'PRICE_LOW') return (left.retailPrice ?? Number.POSITIVE_INFINITY) - (right.retailPrice ?? Number.POSITIVE_INFINITY);
    if (partSort === 'PRICE_HIGH') return (right.retailPrice ?? -1) - (left.retailPrice ?? -1);
    return left.category.localeCompare(right.category) || left.partName.localeCompare(right.partName);
  });

  return (
    <main className="portal-app">
      <header className="portal-topbar">
        <div className="portal-brand compact"><div className="brand-mark">Q</div><div><strong>Quanta<span>Edge</span></strong><small>LUCKY BAJAJ CUSTOMER CARE</small></div></div>
        <div className="portal-top-actions"><span className="secure-pill"><i /> Secure account</span><button type="button" className="customer-profile-trigger" onClick={() => { setTab('profile'); document.getElementById('portal-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} aria-label="Open My profile"><span className="customer-avatar">{profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : initials(customer.fullName) || 'C'}</span><span className="customer-profile-trigger-copy"><strong>My profile</strong><small>{customer.fullName}</small></span></button><button type="button" className="secondary-button portal-logout" onClick={() => void logout()}>Sign out</button></div>
      </header>
      <div className="portal-app-content">
        <section className="portal-welcome-row">
          <div><div className="eyebrow">LUCKY BAJAJ AGENCY <span> / CUSTOMER CARE</span></div><h1>Namaste, {customer.fullName.split(/\s+/)[0]}.</h1><p>Your bike care, made simpler. Everything here is linked to your verified customer account.</p></div>
          <div className="portal-dealership-pill"><span>LB</span><div><strong>{customer.dealershipName}</strong><small>Dealership {customer.dealershipCode}</small></div></div>
        </section>
        {error && <div className="portal-alert alert-error" role="alert">{error}</div>}
        {success && <div className="portal-alert alert-success" role="status">{success}</div>}
        <section className="portal-hero">
          <div className="portal-hero-copy"><span className="hero-overline"><i /> CUSTOMER CARE, CONNECTED</span><h2>Every ride deserves<br /><em>better care.</em></h2><p>Check your bikes, request a service visit and keep the workshop journey in view—all in one calm, clear space.</p><button type="button" className="primary-button" onClick={() => { setTab('appointments'); document.getElementById('portal-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Manage service <span>↗</span></button></div>
          <div className="hero-bike-art" aria-hidden="true"><div className="hero-glow" /><div className="hero-wheel wheel-a" /><div className="hero-wheel wheel-b" /><div className="hero-bike-frame" /><div className="hero-bike-seat" /><div className="hero-bike-tank" /><div className="hero-bike-line" /><div className="hero-art-spark spark-a">✦</div><div className="hero-art-spark spark-b">✳</div><div className="hero-art-label">RIDE WITH CONFIDENCE</div></div>
        </section>
        <section className="portal-metrics" aria-label="Customer overview">
          <article className="portal-metric"><span className="metric-icon orange">♧</span><div><small>My bikes</small><strong>{vehicles.length}</strong><span>Currently linked to you</span></div></article>
          <article className="portal-metric"><span className="metric-icon blue">◷</span><div><small>Service requests</small><strong>{activeAppointments.length}</strong><span>Awaiting / confirmed</span></div></article>
          <article className="portal-metric"><span className="metric-icon green">✓</span><div><small>Recorded outstanding</small><strong>{money(outstanding)}</strong><span>Operational records only</span></div></article>
        </section>
        <nav className="portal-tabs" aria-label="Customer portal sections">
          {([
            ['home', 'Overview', '⌂'],
            ['profile', 'My profile', '◉'],
            ['purchases', 'Purchases', '↗'],
            ['bikes', 'Explore bikes', '↗'],
            ['vehicles', 'My bikes', '♧'],
            ['service', 'Service history', '◷'],
            ['appointments', 'Appointments', '▦'],
            ['requests', 'Bike requests', '↗'],
            ['parts', 'Spare parts', '▦'],
            ['notifications', 'Updates', '✦'],
          ] as const).map(([key, label, icon]) => <button type="button" key={key} className={tab === key ? 'portal-tab active' : 'portal-tab'} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}><span>{icon}</span>{label}{key === 'notifications' && notificationPage.unreadCount > 0 && <b className="notification-tab-badge">{notificationPage.unreadCount > 99 ? '99+' : notificationPage.unreadCount}</b>}</button>)}
        </nav>
        <div id="portal-content" className="portal-content">
          {loadingData && <div className="glass-empty"><span className="loading-spinner" />Refreshing your portal data…</div>}
          {!loadingData && tab === 'home' && <>
            <div className="portal-section-heading"><div><h2>Your care overview</h2><p>Current ownership, your next visit and your latest saved service record.</p></div><span className="section-mark">OVERVIEW</span></div>
            <div className="overview-grid">
              <section className="glass-panel"><div className="panel-heading"><div><h3>My bikes</h3><p>Vehicles currently linked to your customer record.</p></div><button type="button" className="text-link" onClick={() => setTab('vehicles')}>View all ↗</button></div>
                {vehicles.length === 0 ? <div className="inline-empty">No currently linked bike is shown yet. Contact the dealership to review your customer record.</div> : <div className="mini-vehicle-list">{vehicles.slice(0, 3).map((vehicle) => <article className="mini-vehicle" key={vehicle.publicId}><div className="bike-avatar">LB</div><div className="mini-vehicle-copy"><strong>{vehicle.modelName}{vehicle.variantName ? ' · ' + vehicle.variantName : ''}</strong><span>{vehicle.colourName || 'Colour not recorded'}{vehicle.modelYear ? ' · ' + vehicle.modelYear : ''}</span><small>Chassis ending {vehicle.chassisNumber.slice(-5)}</small></div><span className="row-chevron">↗</span></article>)}</div>}
              </section>
              <section className="glass-panel next-visit-panel"><div className="panel-heading"><div><h3>Next appointment</h3><p>Your upcoming service request.</p></div><span className="next-visit-icon">◷</span></div>
                {nextAppointment ? <><div className="next-visit-date"><span>{dateOnly(nextAppointment.scheduledFor)}</span><strong>{dateTime(nextAppointment.scheduledFor)}</strong></div><div className="next-visit-bike"><strong>{nextAppointment.modelName}{nextAppointment.variantName ? ' · ' + nextAppointment.variantName : ''}</strong><span>{nextAppointment.appointmentCode} · {pretty(nextAppointment.status)}</span></div><p className="next-visit-concern">{nextAppointment.customerConcern}</p><button type="button" className="text-link" onClick={() => setTab('appointments')}>Open appointments ↗</button></>
                  : <div className="inline-empty"><strong>No upcoming appointment</strong><span>Request a time that suits your schedule.</span><button type="button" className="secondary-button" onClick={() => setTab('appointments')}>Request service</button></div>}
              </section>
              <section className="glass-panel recent-service-panel"><div className="panel-heading"><div><h3>Latest service record</h3><p>Most recent job card recorded by the workshop.</p></div><button type="button" className="text-link" onClick={() => setTab('service')}>Service history ↗</button></div>
                {mostRecentService ? <div className="recent-service-row"><div className="service-icon">✓</div><div className="recent-service-copy"><strong>{mostRecentService.jobCardCode}</strong><span>{mostRecentService.modelName}{mostRecentService.variantName ? ' · ' + mostRecentService.variantName : ''}</span><small>{dateOnly(mostRecentService.checkedInAt)} · {pretty(mostRecentService.status)}</small></div><span className={`status-pill status-${mostRecentService.status.toLowerCase()}`}>{pretty(mostRecentService.status)}</span></div>
                  : <div className="inline-empty">No workshop job card is available in your current customer history.</div>}
              </section>
            </div>
          </>}
          
          {!loadingData && tab === 'profile' && <>
            <div className="portal-section-heading"><div><h2>My profile</h2><p>Keep your contact details and addresses current for delivery and customer care.</p></div><span className="section-mark">YOUR ACCOUNT</span></div>
            <section className="glass-panel profile-identity-card">
              <div className="profile-identity-photo"><span className="profile-large-avatar">{profilePhotoUrl ? <img src={profilePhotoUrl} alt={customer.fullName + ' profile'} /> : initials(customer.fullName) || 'C'}</span></div>
              <div className="profile-identity-copy"><span className="hero-overline"><i /> VERIFIED CUSTOMER ACCOUNT</span><h3>{customer.fullName}</h3><p>Customer ID <strong>{customer.customerCode}</strong> · {customer.dealershipName}</p><small>Your photo is private to your authenticated account and dealership operations.</small>
                <div className="profile-photo-actions"><input ref={profilePhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadCustomerPhoto(event)} hidden aria-label="Choose profile photo" /><button type="button" className="primary-button" onClick={() => profilePhotoInputRef.current?.click()} disabled={photoBusy}>{photoBusy ? 'Updating photo…' : profilePhotoUrl ? 'Change photo' : 'Add profile photo'}</button>{profilePhotoUrl && <button type="button" className="secondary-button" onClick={() => void removeCustomerPhoto()} disabled={photoBusy}>Remove photo</button>}<span>JPEG, PNG or WebP · up to 2 MiB</span></div>
              </div>
            </section>
            <form className="glass-panel profile-edit-card" onSubmit={saveCustomerProfile}>
              <div className="panel-heading"><div><h3>Personal details</h3><p>Update your name and contact details.</p></div><span className="profile-section-icon">01</span></div>
              <div className="profile-form-grid">
                <label>Full name *<input required minLength={2} maxLength={160} autoComplete="name" value={profileForm.fullName} onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))} /></label>
                <label>Mobile number<input type="tel" maxLength={32} autoComplete="tel" value={profileForm.phone} onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+91…" /></label>
                <label>Alternate number<input type="tel" maxLength={32} value={profileForm.alternatePhone} onChange={(event) => setProfileForm((current) => ({ ...current, alternatePhone: event.target.value }))} placeholder="Optional" /></label>
                <label>Email address<input type="email" maxLength={320} autoComplete="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label>
                <label>Preferred language<select value={profileForm.preferredLanguage} onChange={(event) => setProfileForm((current) => ({ ...current, preferredLanguage: event.target.value as CustomerProfile['preferredLanguage'] }))}><option value="hi">हिन्दी</option><option value="en">English</option><option value="hinglish">Hinglish</option></select></label>
              </div>
              <p className="profile-form-note">Keep at least one contact method—mobile number or email—on your account.</p>
              <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving profile…' : 'Save changes'}</button></div>
            </form>
            <section className="profile-address-section">
              <div className="portal-section-heading"><div><h2>Saved addresses</h2><p>Keep Home, Work and other useful destinations in one secure address book.</p></div><button type="button" className="primary-button" onClick={() => beginAddressEdit()} disabled={addressSaving}>+ Add address</button></div>
              {customerAddresses.length === 0 && !addressForm && <div className="glass-panel inline-empty"><strong>No saved addresses yet</strong><span>Add your home or work address once, then select it during parts delivery checkout.</span><button type="button" className="secondary-button" onClick={() => beginAddressEdit()}>Add your first address</button></div>}
              <div className="profile-address-grid">{customerAddresses.map((address) => <article className="glass-panel profile-address-card" key={address.publicId}>
                <div className="profile-address-card-heading"><span className="address-kind-icon">{address.label === 'HOME' ? '⌂' : address.label === 'WORK' ? '▦' : '⌖'}</span><div><span className="address-kind-label">{address.label}</span><h3>{address.recipientName}</h3></div>{address.isDefaultDelivery && <span className="status-pill status-active">Default delivery</span>}</div>
                <p>{formatAddress(address)}</p><div className="profile-address-contact"><span>{address.phone}</span></div>
                <div className="profile-address-actions"><button type="button" className="secondary-button" onClick={() => beginAddressEdit(address)} disabled={addressSaving}>Edit address</button><button type="button" className="text-link danger-link" onClick={() => void deleteCustomerAddress(address)} disabled={addressSaving}>Remove</button></div>
              </article>)}</div>
              {addressForm && <form className="glass-panel profile-address-form" onSubmit={saveCustomerAddress}>
                <div className="panel-heading"><div><h3>{editingAddressId ? 'Edit address' : 'Add a saved address'}</h3><p>Complete details make delivery and customer service more reliable.</p></div><button type="button" className="text-button" onClick={() => { setAddressForm(null); setEditingAddressId(''); }}>Close</button></div>
                <div className="profile-form-grid">
                  <label>Address label *<select value={addressForm.label} onChange={(event) => updateAddressField('label', event.target.value as AddressForm['label'])}><option value="HOME">Home</option><option value="WORK">Work</option><option value="OTHER">Other</option></select></label>
                  <label>Recipient name *<input required maxLength={160} autoComplete="shipping name" value={addressForm.recipientName} onChange={(event) => updateAddressField('recipientName', event.target.value)} /></label>
                  <label>Contact mobile *<input required type="tel" maxLength={32} autoComplete="shipping tel" value={addressForm.phone} onChange={(event) => updateAddressField('phone', event.target.value)} /></label>
                  <label className="profile-field-wide">Address line 1 *<input required maxLength={240} autoComplete="address-line1" value={addressForm.addressLine1} onChange={(event) => updateAddressField('addressLine1', event.target.value)} placeholder="House / flat, building, street" /></label>
                  <label>Address line 2<input maxLength={240} autoComplete="address-line2" value={addressForm.addressLine2} onChange={(event) => updateAddressField('addressLine2', event.target.value)} placeholder="Optional" /></label>
                  <label>Landmark<input maxLength={160} value={addressForm.landmark} onChange={(event) => updateAddressField('landmark', event.target.value)} placeholder="Near…" /></label>
                  <label>Locality / area<input maxLength={160} value={addressForm.locality} onChange={(event) => updateAddressField('locality', event.target.value)} /></label>
                  <label>City / town *<input required maxLength={120} autoComplete="address-level2" value={addressForm.city} onChange={(event) => updateAddressField('city', event.target.value)} /></label>
                  <label>District<input maxLength={120} value={addressForm.district} onChange={(event) => updateAddressField('district', event.target.value)} /></label>
                  <label>State *<input required maxLength={120} autoComplete="address-level1" value={addressForm.state} onChange={(event) => updateAddressField('state', event.target.value)} /></label>
                  <label>PIN / postal code *<input required maxLength={12} autoComplete="postal-code" value={addressForm.postalCode} onChange={(event) => updateAddressField('postalCode', event.target.value)} /></label>
                  <label>Country<input maxLength={80} autoComplete="country-name" value={addressForm.country} onChange={(event) => updateAddressField('country', event.target.value)} /></label>
                </div>
                <label className="profile-default-address"><input type="checkbox" checked={addressForm.isDefaultDelivery} onChange={(event) => updateAddressField('isDefaultDelivery', event.target.checked)} /> Use as my default delivery address</label>
                <p className="profile-form-note">Updating the address book does not rewrite the addresses on previous orders.</p>
                <div className="form-actions"><button type="button" className="secondary-button" onClick={() => { setAddressForm(null); setEditingAddressId(''); }}>Cancel</button><button type="submit" className="primary-button" disabled={addressSaving}>{addressSaving ? 'Saving address…' : editingAddressId ? 'Save address' : 'Add address'}</button></div>
              </form>}
            </section>
          </>}
          {!loadingData && tab === 'purchases' && <>
            <div className="portal-section-heading"><div><h2>Purchase history</h2><p>Your saved motorcycle deliveries and all spare-parts orders, including cancelled and returned orders.</p></div><span className="section-mark">{motorcyclePurchases.length + retailOrders.length} RECORDS</span></div>
            <section className="glass-panel purchase-history-section">
              <div className="panel-heading"><div><h3>Motorcycles purchased</h3><p>Completed purchases linked to this customer record, including purchases arranged in person.</p></div><span className="profile-section-icon">BIKES</span></div>
              {motorcyclePurchases.length === 0 ? <div className="inline-empty">No completed motorcycle handovers are linked yet. Website enquiries and bookings remain under “Bike requests”.</div>
                : <div className="purchase-history-list">{motorcyclePurchases.map((purchase) => <article className="purchase-history-row" key={purchase.publicId}>
                    <div className="purchase-history-icon">B</div><div className="purchase-history-main"><div className="purchase-history-title"><strong>{purchase.modelName}{purchase.variantName ? ' · ' + purchase.variantName : ''}</strong><span className="status-pill status-active">Delivered</span></div><p>{[purchase.colourName, purchase.modelYear ? String(purchase.modelYear) : null].filter(Boolean).join(' · ') || 'Bajaj motorcycle'}</p><small>Invoice {purchase.invoiceNumber} · Delivered {dateTime(purchase.deliveredAt)}</small><small>Handover acknowledged by {purchase.deliveredToName}</small></div><div className="purchase-history-amount"><strong>{money(purchase.invoiceTotal)}</strong><span>Recorded paid {money(purchase.paidAmount)}</span>{purchase.creditedAmount > 0 && <span>Approved credits {money(purchase.creditedAmount)}</span>}<span>Balance {money(purchase.balanceDue)}</span></div>
                  </article>)}</div>}
              <small className="profile-form-note">History comes from saved handover, invoice and payment records—not editable profile fields.</small>
            </section>
            <section className="glass-panel purchase-history-section">
              <div className="panel-heading"><div><h3>Spare-parts purchases</h3><p>Saved checkout records, quantities, order status and recorded collection.</p></div><button type="button" className="secondary-button" onClick={() => setTab('parts')}>Open spare-parts shop ↗</button></div>
              {retailOrders.length === 0 ? <div className="inline-empty">No spare-parts orders yet. Browse the shop to place an order.</div>
                : <div className="purchase-history-list">{retailOrders.map((order) => <article className="purchase-history-row" key={order.publicId}>
                    <div className="purchase-history-icon">P</div><div className="purchase-history-main"><div className="purchase-history-title"><strong>{order.orderCode}</strong><span className={`status-pill status-${order.status.toLowerCase()}`}>{pretty(order.status)}</span></div><p>{order.lines.map((line) => `${line.quantity} × ${line.partName}`).join(' · ')}</p><small>Placed {dateTime(order.createdAt)} · {order.fulfillmentMethod === 'PICKUP' ? 'Pickup' : 'Delivery'}</small><small>{order.paymentStatus === 'REFUND_REVIEW_REQUIRED' ? 'Return recorded; refund review required' : order.paymentStatus === 'PAID_AT_PICKUP' ? 'Collection recorded at pickup' : order.paymentStatus === 'PAID_ON_DELIVERY' ? 'Collection recorded on delivery' : order.status === 'CANCELLED' ? 'Cancelled; reservation released' : order.fulfillmentMethod === 'DELIVERY' ? 'Delivery fee: ' + money(order.deliveryFee) + ' · ' + pretty(order.deliveryQuoteStatus) : 'Payment due at pickup'}</small></div><div className="purchase-history-amount"><strong>{money(order.orderTotal)}</strong><span>{pretty(order.paymentStatus)}</span><button type="button" className="text-link" onClick={() => setTab('parts')}>View order ↗</button></div>
                  </article>)}</div>}
            </section>
          </>}
          {!loadingData && tab === 'bikes' && <BajajShowroom
            mode="portal"
            requesting={saving}
            onCustomerRequest={(bike, action, preferredAt) => { void submitPortalBikeIntent(bike, action, preferredAt); }}
          />}
          {!loadingData && tab === 'vehicles' && <>
            <div className="portal-section-heading"><div><h2>My bikes</h2><p>Only vehicles currently linked to your verified customer profile are shown.</p></div><span className="section-mark">{vehicles.length} LINKED</span></div>
            {vehicles.length === 0 ? <div className="glass-panel inline-empty">No currently linked vehicles were found. Ask Lucky Bajaj to verify your ownership record.</div> : <div className="vehicle-grid">{vehicles.map((vehicle) => <article className="vehicle-glass-card" key={vehicle.publicId}><div className="vehicle-card-top"><span className="vehicle-logo">LB</span><span className="status-pill status-active">Current vehicle</span></div><div className="vehicle-illustration"><div className="bike-arc" /><div className="bike-profile-wheel a" /><div className="bike-profile-wheel b" /><div className="bike-profile-frame" /><span>BAJAJ</span></div><div className="vehicle-card-copy"><span className="vehicle-overline">{vehicle.modelYear || 'BIKE'}{vehicle.colourName ? ' / ' + vehicle.colourName.toUpperCase() : ''}</span><h3>{vehicle.modelName}</h3><p>{vehicle.variantName || 'Standard variant'}</p><div className="vehicle-card-facts"><div><small>Chassis number</small><strong>{vehicle.chassisNumber}</strong></div><div><small>Engine number</small><strong>{vehicle.engineNumber}</strong></div><div><small>Linked since</small><strong>{dateOnly(vehicle.ownershipStartedAt)}</strong></div></div><button type="button" className="secondary-button wide-button" onClick={() => { setAppointmentForm((current) => ({ ...current, vehiclePublicId: vehicle.publicId })); setTab('appointments'); }}>Book a service visit <span>↗</span></button></div></article>)}</div>}
          </>}
          {!loadingData && tab === 'service' && <>
            <div className="portal-section-heading"><div><h2>Service history</h2><p>Job-card status and recorded operational bill balances from your saved customer records.</p></div><span className="section-mark">{history.length} RECORDS</span></div>
            {history.length === 0 ? <div className="glass-panel inline-empty">Your recorded workshop history will appear here when a job card is linked to your customer profile.</div> : <div className="service-history-list">{history.map((job) => <article className="glass-panel service-history-card" key={job.jobCardPublicId}><div className="service-history-top"><div><span className="history-job-code">{job.jobCardCode}</span><h3>{job.modelName}{job.variantName ? ' · ' + job.variantName : ''}</h3><p>{job.customerConcern}</p></div><span className={`status-pill status-${job.status.toLowerCase()}`}>{pretty(job.status)}</span></div><div className="history-timeline"><div><small>Checked in</small><strong>{dateTime(job.checkedInAt)}</strong></div><div><small>Completed</small><strong>{dateTime(job.completedAt)}</strong></div><div><small>Vehicle handover</small><strong>{dateTime(job.deliveredAt)}</strong></div></div>{job.invoiceNumber ? <div className="service-invoice-summary"><div><small>Operational invoice</small><strong>{job.invoiceNumber}</strong><span>{job.invoiceNotice}</span></div><div><small>Invoice total</small><strong>{money(job.invoiceTotal)}</strong></div><div><small>Recorded paid</small><strong>{money(job.paidAmount)}</strong></div><div><small>Balance due</small><strong className={job.balanceDue > 0 ? 'balance-due' : 'balance-paid'}>{money(job.balanceDue)}</strong></div></div> : <div className="service-invoice-unavailable">No issued operational invoice is recorded for this job card.</div>}</article>)}</div>}
          </>}
          {!loadingData && tab === 'requests' && <>
            <div className="portal-section-heading"><div><h2>My Bajaj requests</h2><p>Requests from the showroom stay connected to your account. A request is not yet a confirmed test-ride slot or vehicle booking.</p></div><span className="section-mark">{salesRequests.length} REQUESTS</span></div>
            {hasPendingShowroomIntent && <section className="glass-panel pending-showroom-retry" role="region" aria-label="Saved showroom request not submitted">
              <div><strong>Your request result is not confirmed yet</strong><p>The connection did not confirm whether the dealership saved your request. Retry with the same safe request key to avoid creating a duplicate, or discard the saved selection.</p></div>
              <div className="pending-showroom-retry-actions">
                <button type="button" className="primary-button" disabled={saving} onClick={() => void retrySavedShowroomRequest()}>{saving ? 'Retrying…' : 'Retry saved request'}</button>
                <button type="button" className="secondary-button" disabled={saving} onClick={discardSavedShowroomRequest}>Discard selection</button>
              </div>
            </section>}
            {salesRequests.length === 0
              ? <div className="glass-panel inline-empty"><strong>No bike requests yet.</strong><span>Browse the Bajaj showroom to choose a motorcycle and start a test-ride or purchase enquiry.</span></div>
              : <div className="appointment-list">{salesRequests.map((request) => <article className="glass-panel customer-appointment-card" key={request.publicId}>
                  <div className="appointment-date-card"><strong>{request.requestCode.slice(-4)}</strong><span>{request.requestType === 'TEST_RIDE' ? 'RIDE' : 'BUY'}</span></div>
                  <div className="customer-appointment-copy">
                    <div className="customer-appointment-top"><strong>{request.requestCode}</strong><span className={`status-pill status-${request.status.toLowerCase()}`}>{pretty(request.status)}</span></div>
                    <h4>{request.modelName}</h4>
                    <span>{request.requestType === 'TEST_RIDE' ? 'Test-ride request' : 'Purchase enquiry'} · {dateTime(request.createdAt)}</span>
                    {request.preferredAt && <p>Preferred time: {dateTime(request.preferredAt)}</p>}
                    {request.notes && <p className="customer-request-note"><strong>Your note:</strong> {request.notes}</p>}
                    <p>{request.status === 'CONVERTED'
                      ? 'The dealership has added this request to its sales pipeline. Progress below reflects saved dealership transactions.'
                      : request.status === 'CANCELLED' ? 'You cancelled this request.'
                      : 'Received by the dealership. A request is not a confirmed test-ride slot, booking, quote, or payment.'}</p>
                    <div className="history-timeline sales-journey-timeline" aria-label={`Sales journey for ${request.requestCode}`}>
                      <div><small>Sales enquiry</small><strong>{request.enquiryCode ? `${request.enquiryCode} · ${pretty(request.enquiryStatus || 'NEW')}` : 'Awaiting review'}</strong></div>
                      {request.requestType === 'TEST_RIDE' && <div><small>Test ride</small><strong>{request.testRideCode ? `${pretty(request.testRideStatus || 'SCHEDULED')} · ${dateTime(request.testRideScheduledStart)}` : 'Slot not confirmed'}</strong></div>}
                      <div><small>Vehicle booking</small><strong>{request.bookingCode ? `${request.bookingCode} · ${pretty(request.bookingStatus || 'ACTIVE')}` : 'Not booked'}</strong></div>
                      <div><small>Operational invoice</small><strong>{request.invoiceNumber ? `${request.invoiceNumber} · ${pretty(request.invoiceStatus || 'DRAFT')}` : 'Not issued'}</strong></div>
                      <div><small>Net recorded payment</small><strong>{request.invoiceTotal == null ? 'Awaiting invoice' : `${money(request.paidAmount)} of ${money(request.invoiceTotal)}`}</strong></div>
                      {request.creditedAmount != null && request.creditedAmount > 0 && <div><small>Approved credit notes</small><strong>{money(request.creditedAmount)}</strong></div>}
                      {request.invoiceTotal != null && <div><small>Balance due after credits</small><strong className={request.balanceDue != null && request.balanceDue > 0 ? 'balance-due' : 'balance-paid'}>{money(request.balanceDue)}</strong></div>}
                      <div><small>Vehicle handover</small><strong>{request.deliveredAt ? dateTime(request.deliveredAt) : 'Not recorded'}</strong></div>
                    </div>
                    {request.invoiceNumber && <small className="sales-invoice-disclaimer">Operational sales invoice only; this is not a statutory GST invoice.</small>}
                    {request.status === 'REQUESTED' && <button type="button" className="text-link danger-link" onClick={() => void cancelCustomerSalesRequest(request)} disabled={saving}>Cancel request</button>}
                  </div>
                </article>)}</div>}
          </>}
          {!loadingData && tab === 'parts' && <>
            <div className="portal-section-heading">
              <div><h2>Bajaj spare-parts shop</h2><p>Browse common spare-part references across categories. Prices, exact OEM numbers and motorcycle compatibility are confirmed by Lucky Bajaj; items can only be ordered when the matching stock SKU is linked and sellable inventory is available.</p></div>
              <span className="section-mark">{displayedRetailParts.length} OF {retailParts.length} PARTS</span>
            </div>
            <section className="retail-catalogue-filters glass-panel" aria-label="Filter spare parts">
              <div className="retail-catalogue-search"><label htmlFor="retail-parts-search">Search by name or part reference</label><input id="retail-parts-search" value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="e.g. brake shoe, oil filter, BGP-0001" /></div>
              <div className="retail-catalogue-filter-grid">
                <label>Part category<select value={partCategoryFilter} onChange={(event) => setPartCategoryFilter(event.target.value)}><option value="ALL">All categories</option>{retailPartFilters.categories.map((category) => <option key={category} value={category}>{pretty(category)}</option>)}</select></label>
                <label>Motorcycle type<select value={partBikeTypeFilter} onChange={(event) => { setPartBikeTypeFilter(event.target.value); setPartModelFilter(''); }}><option value="">All motorcycle types</option>{[...new Set(retailPartFilters.motorcycleModels.map((model) => model.category))].sort().map((category) => <option key={category} value={category}>{pretty(category)}</option>)}</select></label>
                <label>Motorcycle model<select value={partModelFilter} onChange={(event) => setPartModelFilter(event.target.value)}><option value="">All models</option>{retailPartFilters.motorcycleModels.filter((model) => !partBikeTypeFilter || model.category === partBikeTypeFilter).map((model) => <option key={model.modelCode} value={model.modelCode}>{model.modelName}</option>)}</select></label>
                <label>Availability<select value={partAvailabilityFilter} onChange={(event) => setPartAvailabilityFilter(event.target.value)}><option value="ALL">Any status</option><option value="AVAILABLE">In stock and orderable</option><option value="OUT_OF_STOCK">Out of stock</option><option value="CHECK_WITH_DEALER">Check with dealership</option></select></label>
                <label>Minimum price (₹)<input type="number" min="0" step="1" value={partMinPrice} onChange={(event) => setPartMinPrice(event.target.value)} placeholder="No minimum" /></label>
                <label>Maximum price (₹)<input type="number" min="0" step="1" value={partMaxPrice} onChange={(event) => setPartMaxPrice(event.target.value)} placeholder="No maximum" /></label>
                <label>Sort by<select value={partSort} onChange={(event) => setPartSort(event.target.value)}><option value="CATEGORY">Category, then name</option><option value="NAME">Name</option><option value="PRICE_LOW">Price: low to high</option><option value="PRICE_HIGH">Price: high to low</option></select></label>
                <div className="retail-catalogue-filter-actions"><span>{displayedRetailParts.length} matching item(s)</span><button type="button" className="text-link" onClick={() => { setPartSearch(''); setPartCategoryFilter('ALL'); setPartModelFilter(''); setPartBikeTypeFilter(''); setPartAvailabilityFilter('ALL'); setPartMinPrice(''); setPartMaxPrice(''); setPartSort('CATEGORY'); }}>Clear filters</button></div>
              </div>
            </section>
            <div className="retail-shop-layout">
              <section className="retail-shop-main">
                {displayedRetailParts.length === 0
                  ? <div className="glass-panel inline-empty"><strong>No spare parts match these filters.</strong><span>Clear some filters or search another part category.</span></div>
                  : <div className="retail-parts-grid">{displayedRetailParts.map((part) => {
                    const selectedLine = retailCart.find((line) => line.partPublicId === part.publicId);
                    const quantity = Number(selectedLine?.quantity ?? 0);
                    const statusText = part.available
                      ? `${part.quantityAvailable} ${part.unitOfMeasure.toLowerCase()} available`
                      : part.availabilityStatus === 'OUT_OF_STOCK' ? 'Out of stock'
                        : 'Availability to be confirmed';
                    return <article className="glass-panel retail-part-card" key={part.publicId}>
                      {part.imageUrl
                        ? <div className="retail-part-image"><img src={part.imageUrl} alt={part.partName} loading="lazy" /></div>
                        : <div className="retail-part-image retail-part-placeholder"><span>BAJAJ</span><strong>SPARE PARTS</strong></div>}
                      <div className="retail-part-copy">
                        <span className="vehicle-overline">{part.skuCode} · {pretty(part.category)}</span>
                        <h3>{part.partName}</h3>
                        <p>{part.description || 'General spare-parts reference. Ask the dealership to confirm the exact part for your motorcycle.'}</p>
                        {part.partNumber && <small>OEM part number: {part.partNumber}</small>}
                        <small>{part.fitmentVerified
                          ? part.fitmentModelCodes.length > 0 ? `Verified for ${part.fitmentModelCodes.map((code) => retailPartFilters.motorcycleModels.find((model) => model.modelCode === code)?.modelName ?? code).join(', ')}` : 'Dealership-confirmed universal fitment'
                          : 'Exact model compatibility must be confirmed by Lucky Bajaj.'}</small>
                        {part.sourceUrl && <a className="retail-part-source-link" href={part.sourceUrl} target="_blank" rel="noreferrer">Bajaj spares reference ↗</a>}
                        <div className="retail-part-price-row"><strong>{part.retailPrice == null ? 'Price to be confirmed' : money(part.retailPrice)}</strong><span className={part.available ? 'retail-stock available' : 'retail-stock unavailable'}>{statusText}</span></div>
                        <div className="retail-part-cart-row">
                          <div className="retail-quantity-stepper">
                            <button type="button" aria-label={`Remove one ${part.partName}`} disabled={!quantity || saving} onClick={() => updateRetailCart(part, -1)}>−</button>
                            <strong>{quantity}</strong>
                            <button type="button" aria-label={`Add one ${part.partName}`} disabled={!part.available || saving || quantity >= Number(part.quantityAvailable)} onClick={() => updateRetailCart(part, 1)}>+</button>
                          </div>
                          <button type="button" className="secondary-button" disabled={!part.available || saving || quantity >= Number(part.quantityAvailable)} onClick={() => updateRetailCart(part, 1)}>{quantity ? 'Add another' : 'Add to cart'}</button>
                        </div>
                      </div>
                    </article>;
                  })}</div>}
              </section>
              <aside className="glass-panel retail-cart-panel">
                <div className="panel-heading"><div><h3>Your cart</h3><p>{retailCart.length} SKU(s) · {retailFulfillmentMethod === 'PICKUP' ? 'pickup at dealership' : 'delivery request'}</p></div><span className="next-visit-icon">▦</span></div>
                {retailCart.length === 0
                  ? <div className="inline-empty">Choose an in-stock, published part to start an order.</div>
                  : <>
                    {retailCart.map((line) => {
                      const part = retailParts.find((item) => item.publicId === line.partPublicId);
                      if (!part || part.retailPrice == null) return null;
                      return <div className="retail-cart-line" key={line.partPublicId}>
                        <div><strong>{part.partName}</strong><small>{line.quantity} × {money(part.retailPrice)}</small></div>
                        <strong>{money(Number(line.quantity) * part.retailPrice)}</strong>
                        <button type="button" className="text-link danger-link" onClick={() => setRetailCart((current) => current.filter((item) => item.partPublicId !== line.partPublicId))}>Remove</button>
                      </div>;
                    })}
                    <div className="retail-cart-total"><span>Order total</span><strong>{money(retailCart.reduce((sum, line) => {
                      const part = retailParts.find((item) => item.publicId === line.partPublicId);
                      return sum + Number(line.quantity) * Number(part?.retailPrice ?? 0);
                    }, 0))}</strong></div>
                    <form className="retail-checkout-form" onSubmit={placeRetailOrder}>
                      <label>Motorcycle model for fitment (if applicable)
                        <select value={fitmentModelCode} onChange={(event) => setFitmentModelCode(event.target.value)}>
                          <option value="">Choose model if requested by the part</option>
                          {retailPartFilters.motorcycleModels.map((model) => <option key={model.modelCode} value={model.modelCode}>{model.modelName}</option>)}
                        </select>
                      </label>
                      <label>Fulfillment method
                        <select value={retailFulfillmentMethod} onChange={(event) => {
                          const method = event.target.value as 'PICKUP' | 'DELIVERY';
                          setRetailFulfillmentMethod(method);
                          if (method === 'PICKUP') setRetailDeliveryAddress('');
                        }}>
                          <option value="PICKUP">Pickup at Lucky Bajaj</option>
                          <option value="DELIVERY">Request delivery (fee quoted separately)</option>
                        </select>
                      </label>
                      {retailFulfillmentMethod === 'DELIVERY' && <>
                        <label>Use a saved address
                          <select value={selectedDeliveryAddressId} onChange={(event) => {
                            const id = event.target.value; setSelectedDeliveryAddressId(id);
                            const selectedAddress = customerAddresses.find((address) => address.publicId === id);
                            setRetailDeliveryAddress(selectedAddress ? formatAddress(selectedAddress) : '');
                          }}>
                            <option value="">Enter an address manually</option>
                            {customerAddresses.map((address) => <option key={address.publicId} value={address.publicId}>{address.label} · {[address.locality, address.city, address.state, address.postalCode].filter(Boolean).join(', ')}{address.isDefaultDelivery ? ' · Default' : ''}</option>)}
                          </select>
                        </label>
                        {customerAddresses.length === 0 && <p className="retail-address-book-hint">Save a reusable address in <button type="button" className="text-link" onClick={() => setTab('profile')}>My profile</button>.</p>}
                        <label>Delivery address *
                          <textarea required rows={3} maxLength={1500} value={retailDeliveryAddress}
                            onChange={(event) => { setRetailDeliveryAddress(event.target.value); setSelectedDeliveryAddressId(''); }}
                            placeholder="House / street, locality, city, state and PIN code" />
                        </label>
                      </>}
                      <label>{retailFulfillmentMethod === 'PICKUP' ? 'Pickup note (optional)' : 'Delivery instructions (optional)'}
                        <textarea rows={2} maxLength={1000} value={partsOrderNote} onChange={(event) => setPartsOrderNote(event.target.value)}
                          placeholder={retailFulfillmentMethod === 'PICKUP' ? 'Preferred pickup details' : 'Landmark or safe delivery instructions'} />
                      </label>
                      <p className="retail-payment-note">{retailFulfillmentMethod === 'PICKUP'
                        ? 'Reserve stock now; pay when collecting from Lucky Bajaj. This checkout does not charge a bank account or UPI wallet.'
                        : 'This is a delivery request, not a confirmed delivery. Lucky Bajaj will quote the delivery fee separately; the order total currently shows parts only. Payment is due on delivery and no online charge is taken.'}</p>
                      <button type="submit" className="primary-button wide-button" disabled={saving || retailCart.length === 0}>
                        {saving ? 'Saving order…' : retailFulfillmentMethod === 'PICKUP' ? 'Place pickup order' : 'Request delivery quote'}
                      </button>
                    </form>
                  </>}
              </aside>
            </div>
            <section className="glass-panel retail-order-history">
              <div className="portal-section-heading"><div><h2>My parts orders</h2><p>Saved orders and their pickup/collection status.</p></div><span className="section-mark">{retailOrders.length} ORDERS</span></div>
              {retailOrders.length === 0
                ? <div className="inline-empty">Your spare-parts orders will appear here.</div>
                : <div className="retail-order-list">{retailOrders.map((order) => <article className="retail-order-row" key={order.publicId}>
                    <div><strong>{order.orderCode}</strong><small>{dateTime(order.createdAt)} · {order.lines.length} line(s)</small><p>{order.lines.map((line) => `${line.quantity} × ${line.partName}`).join(' · ')}</p></div>
                    <div className="retail-order-state">
                      <strong>{money(order.orderTotal)}</strong>
                      <span className={`status-pill status-${order.status.toLowerCase()}`}>{pretty(order.status)}</span>
                      <small>{order.status === 'CANCELLED' ? 'Order cancelled; reserved stock released'
                        : order.paymentStatus === 'PAID_AT_PICKUP' ? 'Payment recorded at pickup (staff-attested)'
                        : order.paymentStatus === 'PAID_ON_DELIVERY' ? 'Payment recorded on delivery (staff-attested)'
                        : order.paymentStatus === 'REFUND_REVIEW_REQUIRED' ? 'Return recorded; refund review required (no automatic refund)'
                        : order.fulfillmentMethod === 'DELIVERY'
                          ? order.deliveryQuoteStatus === 'ACCEPTED' ? 'Pay on delivery when it arrives' : 'Pay on delivery after accepting the quoted fee'
                          : 'Pay at dealership pickup'}</small>
                      {order.fulfillmentMethod === 'DELIVERY' && <small>Delivery address: {order.deliveryAddress}</small>}
                      {order.fulfillmentMethod === 'DELIVERY' && order.deliveryQuoteStatus === 'AWAITING_STAFF_QUOTE' && order.status === 'PLACED' &&
                        <small>Awaiting Lucky Bajaj delivery quote. Current total is the parts subtotal only; the delivery fee is not set yet.</small>}
                      {order.fulfillmentMethod === 'DELIVERY' && order.deliveryQuoteStatus === 'AWAITING_CUSTOMER_CONFIRMATION' && order.status === 'PLACED' &&
                        <><small>Delivery fee: {money(order.deliveryFee)} · quoted {dateTime(order.deliveryQuotedAt)}</small>
                          {order.deliveryQuoteNote && <small>Quote note: {order.deliveryQuoteNote}</small>}
                          <small>Review the delivery fee. Accept to proceed or decline to cancel and release the reserved stock.</small>
                          <div className="retail-delivery-quote-actions">
                            <button type="button" className="primary-button" disabled={saving} onClick={() => void respondToDeliveryQuote(order, true)}>Accept delivery quote</button>
                            <button type="button" className="secondary-button" disabled={saving} onClick={() => void respondToDeliveryQuote(order, false)}>Decline and cancel order</button>
                          </div>
                        </>}
                      {order.fulfillmentMethod === 'DELIVERY' && order.deliveryQuoteStatus === 'ACCEPTED' && order.status === 'PLACED' &&
                        <small>Delivery fee accepted: {money(order.deliveryFee)}. Lucky Bajaj can now arrange delivery; pay when it arrives.</small>}
                      {order.fulfillmentMethod === 'DELIVERY' && order.status === 'CANCELLED' &&
                        <small>Delivery request cancelled; stock reservation was released.</small>}
                      {order.status === 'RETURNED' && order.returnReason && <small>Return reason: {order.returnReason}. Returned quantity {order.restockedOnReturn ? 'was restocked after inspection' : 'remains excluded from sellable stock'}.</small>}
                    </div>
                    {order.status === 'PLACED' && <button type="button" className="text-link danger-link" disabled={saving} onClick={() => void cancelRetailOrder(order)}>Cancel and release stock</button>}
                  </article>)}</div>}
            </section>
          </>}
          {!loadingData && tab === 'notifications' && <>
            <div className="portal-section-heading"><div><h2>Updates from Lucky Bajaj</h2><p>Service messages and dealership updates delivered through the QuantaEdge Notification Studio.</p></div><span className="section-mark">{notificationPage.unreadCount} UNREAD</span></div>
            {notificationPage.items.length === 0
              ? <div className="glass-panel inline-empty"><strong>You are all caught up.</strong><span>Messages delivered to your customer inbox will appear here. Marketing communication remains subject to recorded consent.</span></div>
              : <div className="customer-notification-list">{notificationPage.items.map((item) => {
                  const unread = !item.readAt;
                  return <article className={unread ? 'glass-panel customer-notification-card unread' : 'glass-panel customer-notification-card'} key={item.recipientPublicId}>
                    <div className="customer-notification-heading"><span className="notification-envelope">{unread ? '✦' : '✓'}</span><div><div className="customer-notification-title-row"><h3>{item.title}</h3>{unread && <span className="notification-unread-dot" aria-label="Unread" />}</div><span>{item.senderName} · {dateTime(item.createdAt)}</span></div></div>
                    {item.summary && <p className="customer-notification-summary">{item.summary}</p>}
                    {renderNotificationContent(item.contentDocumentJson)}
                    <div className="customer-notification-actions">
                      {unread
                        ? <button type="button" className="text-link" onClick={() => void updateNotification(item, 'read')}>Mark as read</button>
                        : <button type="button" className="text-link" onClick={() => void updateNotification(item, 'unread')}>Mark as unread</button>}
                      <button type="button" className="text-link danger-link" onClick={() => void updateNotification(item, 'dismiss')}>Dismiss</button>
                    </div>
                  </article>;
                })}</div>}
          </>}

          {!loadingData && tab === 'appointments' && <>
            <div className="portal-section-heading"><div><h2>Appointments</h2><p>Send a service request to Lucky Bajaj, then track confirmation and status here.</p></div><span className="section-mark">{appointments.length} REQUESTS</span></div>
            <div className="appointments-layout">
              <form className="glass-panel appointment-form" onSubmit={submitAppointment}><div className="panel-heading"><div><h3>Request a service visit</h3><p>All details are checked against your current vehicle ownership.</p></div><span className="form-count">01</span></div>
                <label>Bike *<select required value={appointmentForm.vehiclePublicId} onChange={(event) => setAppointmentForm((current) => ({ ...current, vehiclePublicId: event.target.value }))}><option value="">Choose a currently linked bike</option>{vehicles.map((vehicle) => <option key={vehicle.publicId} value={vehicle.publicId}>{vehicle.modelName}{vehicle.variantName ? ' · ' + vehicle.variantName : ''} · {vehicle.chassisNumber.slice(-5)}</option>)}</select></label>
                <label>Date and time *<input required type="datetime-local" min={toLocalDateTime(new Date(Date.now() + 60_000))} value={appointmentForm.scheduledFor} onChange={(event) => setAppointmentForm((current) => ({ ...current, scheduledFor: event.target.value }))} /></label>
                <label>Visit duration<select value={appointmentForm.slotMinutes} onChange={(event) => setAppointmentForm((current) => ({ ...current, slotMinutes: event.target.value }))}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1 hour 30 minutes</option><option value="120">2 hours</option></select></label>
                <label>Preferred language<select value={appointmentForm.customerLanguage} onChange={(event) => setAppointmentForm((current) => ({ ...current, customerLanguage: event.target.value }))}><option value="hi">हिन्दी</option><option value="en">English</option><option value="hinglish">Hinglish</option></select></label>
                <label>What does your bike need? *<textarea required maxLength={3000} rows={4} value={appointmentForm.customerConcern} onChange={(event) => setAppointmentForm((current) => ({ ...current, customerConcern: event.target.value }))} placeholder="e.g. regular service, unusual sound, brake inspection…" /></label>
                <div className="appointment-honesty-note">Your request is not confirmed until dealership staff review it. No payment is taken here.</div>
                <button type="submit" className="primary-button wide-button" disabled={saving || vehicles.length === 0}>{saving ? 'Submitting…' : 'Submit service request'} <span>↗</span></button>
              </form>
              <section className="glass-panel appointments-list-panel"><div className="panel-heading"><div><h3>Your service requests</h3><p>Requested and confirmed visits stay at the top of your mind.</p></div><span className="form-count">{appointments.length.toString().padStart(2, '0')}</span></div>
                {appointments.length === 0 ? <div className="inline-empty">No appointments yet. Submit a request to get started.</div> : <div className="appointment-list">{appointments.map((appointment) => <article className="customer-appointment-card" key={appointment.publicId}><div className="appointment-date-card"><strong>{new Date(appointment.scheduledFor).toLocaleDateString('en-IN', { day: '2-digit' })}</strong><span>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(appointment.scheduledFor)).toUpperCase()}</span></div><div className="customer-appointment-copy"><div className="customer-appointment-top"><strong>{appointment.appointmentCode}</strong><span className={`status-pill status-${appointment.status.toLowerCase()}`}>{pretty(appointment.status)}</span></div><h4>{appointment.modelName}{appointment.variantName ? ' · ' + appointment.variantName : ''}</h4><span>{dateTime(appointment.scheduledFor)} · {appointment.slotMinutes} min</span><p>{appointment.customerConcern}</p>{appointment.statusReason && <small className="status-explanation">{appointment.statusReason}</small>}
                    {['REQUESTED', 'CONFIRMED'].includes(appointment.status) && <form className="inline-cancel-form" onSubmit={(event) => { event.preventDefault(); void cancelAppointment(appointment); }}><input aria-label={`Cancellation reason for ${appointment.appointmentCode}`} maxLength={500} value={cancelReasons[appointment.publicId] ?? ''} onChange={(event) => setCancelReasons((current) => ({ ...current, [appointment.publicId]: event.target.value }))} placeholder="Reason if you need to cancel" /><button type="submit" className="text-link danger-link" disabled={saving}>Cancel request</button></form>}
                  </div></article>)}</div>}
              </section>
            </div>
          </>}
        </div>
        <footer className="portal-footer"><span>Powered by <strong>QuantaEdge</strong></span><span>Customer data is displayed only for your authenticated dealership account.</span><button type="button" className="text-link" onClick={() => void loadPortalData(token)}>Refresh data ↻</button></footer>
      </div>
    </main>
  );
}
