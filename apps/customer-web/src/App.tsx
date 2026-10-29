import { useCallback, useEffect, useState, type FormEvent } from 'react';
import BajajShowroom, { type ShowroomAction, type ShowroomBike } from './BajajShowroom';

type CustomerProfile = {
  publicId: string; customerCode: string; fullName: string; phone: string | null; email: string | null;
  preferredLanguage: string; dealershipCode: string; dealershipName: string;
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
};

type PendingShowroomIntent = {
  action: ShowroomAction; modelCode: string; modelName: string; selectedAt: string; idempotencyKey: string;
};
type RetailPart = {
  publicId: string; skuCode: string; partName: string; description: string | null; unitOfMeasure: string;
  retailPrice: number; fitmentModelCodes: string[]; imageUrl: string | null;
  quantityAvailable: number; available: boolean;
};
type RetailOrderLine = {
  partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantity: number; unitPrice: number; lineTotal: number;
};
type RetailOrder = {
  publicId: string; orderCode: string; status: string; paymentMethod: string; paymentStatus: string;
  orderTotal: number; customerNote: string | null; createdAt: string; updatedAt: string;
  cancelledAt: string | null; fulfilledAt: string | null; customerName: string;
  customerCode: string; customerPhone: string | null; lines: RetailOrderLine[];
};
type CartLine = { partPublicId: string; quantity: string };

type AuthMode = 'login' | 'activate';
type PortalTab = 'home' | 'vehicles' | 'service' | 'appointments' | 'notifications' | 'requests' | 'parts';

const SESSION_KEY = 'qe_customer_portal_token';

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

function apiRequestUrl(path: string): string {
  // Empty locally so the Vite/Docker proxy continues to handle /api routes.
  return configuredApiBaseUrl ? new URL(path, `${configuredApiBaseUrl}/`).toString() : path;
}


async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
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

export default function App() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(SESSION_KEY) ?? '');
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [showStorefront, setShowStorefront] = useState(true);
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
  const [retailOrders, setRetailOrders] = useState<RetailOrder[]>([]);
  const [retailCart, setRetailCart] = useState<CartLine[]>([]);
  const [fitmentModelCode, setFitmentModelCode] = useState('');
  const [partsOrderNote, setPartsOrderNote] = useState('');
  const [partsOrderKey, setPartsOrderKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `retail-${Date.now()}`);
  const [notificationPage, setNotificationPage] = useState<NotificationPage>({
    items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0,
  });
  const [loginForm, setLoginForm] = useState({ dealershipCode: '', customerCode: '', password: '' });
  const [activationForm, setActivationForm] = useState({ activationToken: '', password: '', confirmPassword: '' });
  const [appointmentForm, setAppointmentForm] = useState({
    vehiclePublicId: '', scheduledFor: toLocalDateTime(new Date(Date.now() + 86_400_000)),
    slotMinutes: '60', customerConcern: '', customerLanguage: 'hi',
  });
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});

  const clearSession = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_KEY);
    setToken('');
    setCustomer(null);
    setVehicles([]);
    setHistory([]);
    setAppointments([]);
    setSalesRequests([]);
    setRetailParts([]);
    setRetailOrders([]);
    setRetailCart([]);
    setNotificationPage({ items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0 });
    setTab('home');
  }, []);

  const loadPortalData = useCallback(async (sessionToken: string) => {
    setLoadingData(true);
    setError('');
    try {
      const [profile, ownedVehicles, serviceHistory, customerAppointments, customerNotifications, customerRequests, parts, orders] = await Promise.all([
        api<CustomerProfile>('/api/v1/customer/auth/me', sessionToken),
        api<Vehicle[]>('/api/v1/customer/vehicles', sessionToken),
        api<ServiceHistory[]>('/api/v1/customer/service-history', sessionToken),
        api<Appointment[]>('/api/v1/customer/appointments', sessionToken),
        api<NotificationPage>('/api/v1/customer/notifications?page=0&pageSize=50', sessionToken),
        api<CustomerSalesRequest[]>('/api/v1/customer/sales-requests', sessionToken),
        api<RetailPart[]>('/api/v1/customer/parts', sessionToken),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', sessionToken),
      ]);
      setCustomer(profile);
      setVehicles(ownedVehicles);
      setHistory(serviceHistory);
      setAppointments(customerAppointments);
      setSalesRequests(customerRequests);
      setRetailParts(parts);
      setRetailOrders(orders);
      setNotificationPage(customerNotifications);
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

  async function resumePendingShowroomIntent(sessionToken: string): Promise<boolean | null> {
    const raw = window.sessionStorage.getItem('qe_bajaj_pending_intent');
    if (!raw) return null;
    let intent: PendingShowroomIntent;
    try {
      const parsed = JSON.parse(raw) as Partial<PendingShowroomIntent>;
      if ((parsed.action !== 'TEST_RIDE' && parsed.action !== 'PURCHASE')
        || typeof parsed.modelCode !== 'string' || typeof parsed.modelName !== 'string'
        || typeof parsed.idempotencyKey !== 'string') {
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
          preferredAt: null,
          notes: 'Request started from the public Bajaj showroom.',
          idempotencyKey: intent.idempotencyKey,
        }),
      });
      window.sessionStorage.removeItem('qe_bajaj_pending_intent');
      const current = await api<CustomerSalesRequest[]>('/api/v1/customer/sales-requests', sessionToken);
      setSalesRequests(current);
      setTab('requests');
      setSuccess(intent.action === 'TEST_RIDE'
        ? `Your test-ride request for ${intent.modelName} was sent to Lucky Bajaj. The team will confirm the bike and time.`
        : `Your purchase enquiry for ${intent.modelName} was sent to Lucky Bajaj. The team will confirm availability and the next steps.`);
      return true;
    } catch (cause) {
      setTab('requests');
      setError(cause instanceof Error
        ? `${cause.message} Your selected bike is saved; retry the request from this screen.`
        : 'The request could not be submitted. Your selected bike remains saved.');
      return false;
    }
  }

  useEffect(() => {
    if (!token) {
      setLoadingSession(false);
      return;
    }
    let cancelled = false;
    api<CustomerProfile>('/api/v1/customer/auth/me', token)
      .then((profile) => {
        if (!cancelled) {
          setCustomer(profile);
          void loadPortalData(token);
        }
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => { if (!cancelled) setLoadingSession(false); });
    return () => { cancelled = true; };
  }, [token, clearSession, loadPortalData]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const session = await api<PortalSession>('/api/v1/customer/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({
          dealershipCode: loginForm.dealershipCode.trim().toUpperCase(),
          customerCode: loginForm.customerCode.trim().toUpperCase(),
          password: loginForm.password,
        }),
      });
      window.sessionStorage.setItem(SESSION_KEY, session.accessToken);
      setToken(session.accessToken);
      setCustomer(session.customer);
      setLoginForm((current) => ({ ...current, password: '' }));
      const resumed = await resumePendingShowroomIntent(session.accessToken);
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
      const session = await api<PortalSession>('/api/v1/customer/auth/activate', undefined, {
        method: 'POST',
        body: JSON.stringify({
          activationToken: activationForm.activationToken.trim(),
          password: activationForm.password,
        }),
      });
      window.sessionStorage.setItem(SESSION_KEY, session.accessToken);
      setToken(session.accessToken);
      setCustomer(session.customer);
      setActivationForm({ activationToken: '', password: '', confirmPassword: '' });
      const resumed = await resumePendingShowroomIntent(session.accessToken);
      if (resumed === null) setSuccess('Your customer account is active. Welcome to Lucky Bajaj.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account activation failed.');
    } finally { setSaving(false); }
  }

  function updateRetailCart(part: RetailPart, delta: number) {
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
          idempotencyKey: partsOrderKey,
        }),
      });
      const [parts, orders] = await Promise.all([
        api<RetailPart[]>('/api/v1/customer/parts', token),
        api<RetailOrder[]>('/api/v1/customer/parts/orders', token),
      ]);
      setRetailParts(parts);
      setRetailOrders(orders);
      setRetailCart([]);
      setPartsOrderNote('');
      setPartsOrderKey(globalThis.crypto?.randomUUID?.() ?? `retail-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setSuccess(`Order ${order.orderCode} placed. Pay at dealership pickup; no online payment has been taken.`);
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
      setRetailParts(parts);
      setRetailOrders(orders);
      setSuccess(`Order ${order.orderCode} was cancelled and its stock reservation released.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be cancelled.');
    } finally {
      setSaving(false);
    }
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
      setError('This browser session has been cleared. The server could not confirm session revocation; sign in again before continuing.');
    }
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

  if (loadingSession) {
    return <main className="portal-loading"><div className="brand-mark">Q</div><h1>Opening your customer space</h1><p>Checking your secure session…</p></main>;
  }

  if (!token || !customer) {
    if (showStorefront && authMode === 'login') {
      return <BajajShowroom onSignIn={(bike?: ShowroomBike, action?: ShowroomAction) => {
        if (bike && action) {
          sessionStorage.setItem('qe_bajaj_pending_intent', JSON.stringify({
            action, modelCode: bike.modelCode, modelName: bike.modelName,
            selectedAt: new Date().toISOString(),
            idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `qe-sales-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          }));
          setSuccess(`${bike.modelName} selected. Sign in to continue your request.`);
        } else {
          setSuccess('');
        }
        setError('');
        setAuthMode('login');
        setShowStorefront(false);
      }} />;
    }
    return (
      <main className="portal-auth-screen">
        <div className="auth-orb orb-one" /><div className="auth-orb orb-two" /><div className="auth-orb orb-three" />
        <header className="portal-brand">
          <div className="brand-mark">Q</div>
          <div><strong>Quanta<span>Edge</span></strong><small>LUCKY BAJAJ CUSTOMER CARE</small></div>
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
              ? 'Sign in with the customer code provided by Lucky Bajaj.'
              : 'Use the one-time invitation token issued by the dealership.'}</p>
            {error && <div className="portal-alert alert-error" role="alert">{error}</div>}
            {success && <div className="portal-alert alert-success" role="status">{success}</div>}
            <div className="auth-mode-tabs" role="tablist" aria-label="Customer portal authentication">
              <button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); setSuccess(''); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={authMode === 'activate'} className={authMode === 'activate' ? 'active' : ''} onClick={() => { setAuthMode('activate'); setError(''); setSuccess(''); }}>Activate account</button>
            </div>
            {authMode === 'login' ? <form className="portal-form" onSubmit={submitLogin}>
              <label>Dealership code<input autoComplete="organization" required maxLength={40} value={loginForm.dealershipCode} onChange={(event) => setLoginForm((current) => ({ ...current, dealershipCode: event.target.value }))} placeholder="Lucky Bajaj code" /></label>
              <label>Customer code<input autoComplete="username" required maxLength={40} value={loginForm.customerCode} onChange={(event) => setLoginForm((current) => ({ ...current, customerCode: event.target.value }))} placeholder="Your customer code" /></label>
              <label>Password<input type="password" autoComplete="current-password" required maxLength={128} value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Your password" /></label>
              <button className="primary-button portal-submit" type="submit" disabled={saving}>{saving ? 'Signing in…' : 'Sign in securely'} <span>↗</span></button>
            </form> : <form className="portal-form" onSubmit={submitActivation}>
              <label>One-time activation token<textarea required rows={3} maxLength={128} autoComplete="one-time-code" value={activationForm.activationToken} onChange={(event) => setActivationForm((current) => ({ ...current, activationToken: event.target.value }))} placeholder="Paste the invitation token provided by the dealership" /></label>
              <label>Create password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={activationForm.password} onChange={(event) => setActivationForm((current) => ({ ...current, password: event.target.value }))} placeholder="At least 12 characters" /></label>
              <label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={activationForm.confirmPassword} onChange={(event) => setActivationForm((current) => ({ ...current, confirmPassword: event.target.value }))} placeholder="Enter the same password again" /></label>
              <button className="primary-button portal-submit" type="submit" disabled={saving}>{saving ? 'Activating…' : 'Activate and continue'} <span>↗</span></button>
            </form>}
            <button type="button" className="showroom-back-link" onClick={() => { setShowStorefront(true); setAuthMode('login'); setError(''); setSuccess(''); }}>← Back to Bajaj showroom</button>
            <div className="invite-note"><strong>Need portal access?</strong><span>Ask Lucky Bajaj Agency to verify your customer record and issue an invitation. No account is created from public phone/email matching alone.</span></div>
            <div className="portal-auth-footer">Protected by QuantaEdge <span>•</span> Lucky Bajaj Agency</div>
          </section>
        </section>
        <footer className="public-footer">© {new Date().getFullYear()} QuantaEdge <span>Made for your journey.</span></footer>
      </main>
    );
  }

  return (
    <main className="portal-app">
      <header className="portal-topbar">
        <div className="portal-brand compact"><div className="brand-mark">Q</div><div><strong>Quanta<span>Edge</span></strong><small>LUCKY BAJAJ CUSTOMER CARE</small></div></div>
        <div className="portal-top-actions"><span className="secure-pill"><i /> Secure account</span><div className="customer-avatar" aria-hidden="true">{initials(customer.fullName) || 'C'}</div><div className="customer-identity"><strong>{customer.fullName}</strong><small>{customer.customerCode}</small></div><button type="button" className="secondary-button portal-logout" onClick={() => void logout()}>Sign out</button></div>
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
            {salesRequests.length === 0
              ? <div className="glass-panel inline-empty"><strong>No bike requests yet.</strong><span>Browse the Bajaj showroom to choose a motorcycle and start a test-ride or purchase enquiry.</span></div>
              : <div className="appointment-list">{salesRequests.map((request) => <article className="glass-panel customer-appointment-card" key={request.publicId}>
                  <div className="appointment-date-card"><strong>{request.requestCode.slice(-4)}</strong><span>{request.requestType === 'TEST_RIDE' ? 'RIDE' : 'BUY'}</span></div>
                  <div className="customer-appointment-copy">
                    <div className="customer-appointment-top"><strong>{request.requestCode}</strong><span className={`status-pill status-${request.status.toLowerCase()}`}>{pretty(request.status)}</span></div>
                    <h4>{request.modelName}</h4>
                    <span>{request.requestType === 'TEST_RIDE' ? 'Test-ride request' : 'Purchase enquiry'} · {dateTime(request.createdAt)}</span>
                    {request.preferredAt && <p>Preferred time: {dateTime(request.preferredAt)}</p>}
                    <p>{request.status === 'CONVERTED'
                      ? 'The dealership has added this request to its sales pipeline. The team will confirm availability and the next step.'
                      : request.status === 'CANCELLED' ? 'You cancelled this request.'
                      : 'Received by the dealership. The team will check availability and contact you to confirm the next step.'}</p>
                    {request.status === 'REQUESTED' && <button type="button" className="text-link danger-link" onClick={() => void cancelCustomerSalesRequest(request)} disabled={saving}>Cancel request</button>}
                  </div>
                </article>)}</div>}
          </>}
          {!loadingData && tab === 'parts' && <>
            <div className="portal-section-heading">
              <div><h2>Bajaj spare-parts shop</h2><p>Shop items the dealership has explicitly listed for retail. Availability excludes stock already reserved for workshop jobs and other customers.</p></div>
              <span className="section-mark">{retailParts.length} LISTED</span>
            </div>
            <div className="retail-shop-layout">
              <section className="retail-shop-main">
                {retailParts.length === 0
                  ? <div className="glass-panel inline-empty"><strong>No retail parts listed yet.</strong><span>Only parts published by Lucky Bajaj will appear here. Ask the dealership if a part is missing.</span></div>
                  : <div className="retail-parts-grid">{retailParts.map((part) => {
                    const selectedLine = retailCart.find((line) => line.partPublicId === part.publicId);
                    const quantity = Number(selectedLine?.quantity ?? 0);
                    return <article className="glass-panel retail-part-card" key={part.publicId}>
                      {part.imageUrl
                        ? <div className="retail-part-image"><img src={part.imageUrl} alt={part.partName} loading="lazy" /></div>
                        : <div className="retail-part-image retail-part-placeholder"><span>BAJAJ</span><strong>GENUINE PARTS</strong></div>}
                      <div className="retail-part-copy">
                        <span className="vehicle-overline">{part.skuCode}</span>
                        <h3>{part.partName}</h3>
                        <p>{part.description || 'Dealership-listed spare part.'}</p>
                        {part.fitmentModelCodes.length > 0 && <small>Fitment restricted to selected Bajaj model</small>}
                        <div className="retail-part-price-row"><strong>{money(part.retailPrice)}</strong><span className={part.available ? 'retail-stock available' : 'retail-stock unavailable'}>{part.available ? `${part.quantityAvailable} ${part.unitOfMeasure} available` : 'Currently unavailable'}</span></div>
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
                <div className="panel-heading"><div><h3>Your cart</h3><p>{retailCart.length} SKU(s) · pickup at dealership</p></div><span className="next-visit-icon">▦</span></div>
                {retailCart.length === 0
                  ? <div className="inline-empty">Choose a part to start an order.</div>
                  : <>
                    {retailCart.map((line) => {
                      const part = retailParts.find((item) => item.publicId === line.partPublicId);
                      if (!part) return null;
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
                      <label>Bike fitment (if applicable)
                        <input maxLength={60} value={fitmentModelCode} onChange={(event) => setFitmentModelCode(event.target.value.toUpperCase())} placeholder="Model code, e.g. BAJAJ_PULSAR_N160" />
                      </label>
                      <label>Pickup note (optional)
                        <textarea rows={2} maxLength={1000} value={partsOrderNote} onChange={(event) => setPartsOrderNote(event.target.value)} placeholder="Preferred pickup details" />
                      </label>
                      <p className="retail-payment-note">Reserve stock now; pay when collecting from Lucky Bajaj. This checkout does not charge a bank account or UPI wallet.</p>
                      <button type="submit" className="primary-button wide-button" disabled={saving || retailCart.length === 0}>{saving ? 'Placing order…' : 'Place pickup order'}</button>
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
                    <div className="retail-order-state"><strong>{money(order.orderTotal)}</strong><span className={`status-pill status-${order.status.toLowerCase()}`}>{pretty(order.status)}</span><small>{order.paymentStatus === 'PAID_AT_PICKUP' ? 'Collected at pickup' : 'Pay at dealership pickup'}</small></div>
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
