import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, apiRequestUrl, desktopRequestHeaders } from './apiClient';
import CustomerWorkspace from './customers/CustomerWorkspace';
import VehicleInventoryWorkspace from './inventory/VehicleInventoryWorkspace';
import SparePartsWorkspace from './inventory/SparePartsWorkspace';
import WorkshopWorkspace from './workshop/WorkshopWorkspace';
import SalesWorkspace from './sales/SalesWorkspace';
import NotificationStudio from './notifications/NotificationStudio';
import NotificationInbox from './notifications/NotificationInbox';
import SocialMediaArtworkStudio from './notifications/SocialMediaArtworkStudio';
import GlobalNotificationHost from './notifications/GlobalNotificationHost';
import StaffLogin, { type LoginResult, type StaffSummary } from './auth/StaffLogin';
import StaffDirectoryWorkspace from './staff/StaffDirectoryWorkspace';
import BillingWorkspace from './finance/BillingWorkspace';
import FinanceReportsWorkspace from './finance/FinanceReportsWorkspace';

type ApiHealth = {
  status: string;
  service: string;
  version: string;
  timestamp: string;
};

type LicenseStatus = {
  dealershipCode: string;
  dealershipName: string;
  planCode: string | null;
  licenseStatus: string;
  state: string;
  startsAt: string | null;
  expiresAt: string | null;
  gracePeriodEndsAt: string | null;
  gracePeriodDays: number;
  maxStaffSeats: number;
  occupiedStaffSeats: number;
  daysUntilExpiry: number;
  message: string;
};


const navigation = [
  { label: 'Overview', group: 'Workspace', icon: '◫' },
  { label: 'Customers', group: 'Customers & sales', icon: '◎', permission: 'customer.read' },
  { label: 'Sales pipeline', group: 'Customers & sales', icon: '↗', permission: 'sales.read' },
  { label: 'Bike inventory', group: 'Customers & sales', icon: '▤', permission: 'vehicle.read' },
  { label: 'Workshop', group: 'Service centre', icon: '⚙', permission: 'workshop.read' },
  { label: 'Spare parts', group: 'Service centre', icon: '▦', permission: 'parts.read' },
  { label: 'Billing & expenses', group: 'Business control', icon: '₹', permission: 'finance.read' },
  { label: 'Team & access', group: 'Business control', icon: '♙', permission: 'staff.read' },
  { label: 'Notification Studio', group: 'Engagement', icon: '✳', permission: 'notification.read' },
  { label: 'Social Media Studio', group: 'Engagement', icon: '▧', permission: 'social_media.read' },
  { label: 'Reports', group: 'Engagement', icon: '▥', permission: 'report.read' },
];

const descriptions: Record<string, string> = {
  'Sales pipeline': 'Manage enquiries, test rides, bookings, follow-ups and delivery progress.',
  'Bike inventory': 'Track models, individual vehicle units, chassis and engine identifiers, and allocation.',
  Workshop: 'Appointments, inspections, estimates, job cards, mechanic assignment and handover.',
  'Spare parts': 'Supplier purchases, stock ledger, parts issued to jobs, returns and reorder alerts.',
  'Billing & expenses': 'Operational invoices, receipts, collections, expenses and daily reconciliation.',
  'Team & access': 'Staff accounts, role permissions, assignments and accountable change history.',
  'Notification Studio': 'Design rich Hindi/English messages, preview eligible customers, schedule campaigns and review delivery.',
  'Social Media Studio': 'Create dealership campaigns, edit artwork and video, connect social accounts, and manage publishing and messaging.',
  Reports: 'Sales, workshop, collections, expenses and stock reports based on saved transactions.',
};

// Stable hash routes work on static hosting without server-side rewrite rules.
const pageRoutes: Record<string, string> = {
  Overview: 'overview',
  Customers: 'customers',
  'Sales pipeline': 'sales',
  'Bike inventory': 'inventory',
  Workshop: 'workshop',
  'Spare parts': 'parts',
  'Billing & expenses': 'billing',
  'Team & access': 'team',
  'Notification Studio': 'notification-studio',
  'Social Media Studio': 'social-media-studio',
  Reports: 'reports',
};

function pageFromHash(hash: string): string {
  const route = hash.startsWith('#/') ? hash.slice(2).split(/[?#]/, 1)[0] : hash.startsWith('#') ? hash.slice(1).split(/[?#]/, 1)[0] : '';
  return Object.entries(pageRoutes).find(([, value]) => value === route)?.[0] ?? 'Overview';
}

function pageHashFor(page: string): string {
  return '#/' + (pageRoutes[page] ?? pageRoutes.Overview);
}

function App() {
  const [token, setToken] = useState<string>(() => window.sessionStorage.getItem('qe_staff_token') ?? '');
  const [staff, setStaff] = useState<StaffSummary | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activePage, setActivePage] = useState<string>(() => pageFromHash(window.location.hash));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState<boolean>(() => window.localStorage.getItem('qe_staff_nav_collapsed') === 'true');
  const mobileNavToggleRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavRef = useRef<HTMLElement | null>(null);
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [showInbox, setShowInbox] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const updateUnreadCount = useCallback((count: number) => setUnreadCount(count), []);

  useEffect(() => {
    window.localStorage.setItem('qe_staff_nav_collapsed', String(desktopNavCollapsed));
  }, [desktopNavCollapsed]);

  function navigateToPage(page: string, replace = false) {
    const hash = pageHashFor(page);
    if (window.location.hash !== hash) {
      const url = window.location.pathname + window.location.search + hash;
      if (replace) window.history.replaceState(null, '', url);
      else window.location.hash = hash;
    }
    setActivePage(page);
  }

  // Keep React state in sync with direct links and browser Back/Forward.
  useEffect(() => {
    const syncFromUrl = () => {
      const requestedRoute = window.location.hash.startsWith('#/') ? window.location.hash.slice(2).split(/[?#]/, 1)[0] : window.location.hash.startsWith('#') ? window.location.hash.slice(1).split(/[?#]/, 1)[0] : '';
      const isKnownRoute = Object.values(pageRoutes).includes(requestedRoute);
      if (!isKnownRoute) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + pageHashFor('Overview'));
      }
      setActivePage(pageFromHash(window.location.hash));
    };
    syncFromUrl();
    window.addEventListener('hashchange', syncFromUrl);
    return () => window.removeEventListener('hashchange', syncFromUrl);
  }, []);

  // A hash is navigation, not authorization: inaccessible workspaces fall back to Overview.
  useEffect(() => {
    if (!token || !staff) return;
    const requestedPage = navigation.find((item) => item.label === activePage);
    if (requestedPage?.permission && !staff.permissions.includes(requestedPage.permission)) {
      navigateToPage('Overview', true);
    }
  }, [token, staff, activePage]);

  useEffect(() => {
    if (!token) {
      setStaff(null);
      setAuthLoading(false);
      return;
    }
    let cancelled = false;
    setAuthLoading(true);
    apiFetch<StaffSummary>('/api/v1/auth/staff/me', token)
      .then((current) => {
        if (!cancelled) setStaff(current);
      })
      .catch(() => {
        if (!cancelled) {
          window.sessionStorage.removeItem('qe_staff_token');
          setToken('');
          setStaff(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  // The API enforces access; this refresh keeps the visible status banner in sync.
  useEffect(() => {
    if (!token || !staff) {
      setLicenseStatus(null);
      return;
    }
    let cancelled = false;
    const refreshLicense = () => {
      void apiFetch<LicenseStatus>('/api/v1/system/license/status', token)
        .then((status) => { if (!cancelled) setLicenseStatus(status); })
        .catch(() => { if (!cancelled) setLicenseStatus(null); });
    };
    refreshLicense();
    const interval = window.setInterval(refreshLicense, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, staff?.dealershipPublicId]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const drawer = mobileNavRef.current;
    if (!drawer) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnDesktopResize = () => {
      if (window.innerWidth > 820) setMobileNavOpen(false);
    };
    document.body.style.overflow = 'hidden';

    const focusableElements = () => Array.from(drawer.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute('aria-hidden') !== 'true');

    // Keep keyboard navigation inside the modal drawer while it is open.
    (drawer.querySelector<HTMLElement>('.nav-item.active')
      ?? focusableElements()[0])?.focus();

    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = focusableElements();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const focusOutsideDrawer = !(active instanceof Node) || !drawer.contains(active);
      if (event.shiftKey && (active === first || focusOutsideDrawer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || focusOutsideDrawer)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('resize', closeOnDesktopResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('resize', closeOnDesktopResize);
      // Return focus to the visible toggle after a user closes the mobile drawer.
      if (window.innerWidth <= 820 && mobileNavToggleRef.current?.isConnected) {
        mobileNavToggleRef.current.focus();
      }
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!token || !staff || !staff.permissions.includes('notification.read')) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    apiFetch<{ unreadCount: number }>('/api/v1/admin/notifications/inbox?page=0&pageSize=1', token)
      .then((result) => { if (!cancelled) setUnreadCount(result.unreadCount ?? 0); })
      .catch(() => { if (!cancelled) setUnreadCount(0); });
    return () => { cancelled = true; };
  }, [token, staff]);

  useEffect(() => {
    if (!token || !staff) return;
    const controller = new AbortController();
    fetch(apiRequestUrl('/api/v1/system/health'), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API is not ready');
        return response.json() as Promise<ApiHealth>;
      })
      .then((data) => {
        setHealth(data);
        setHealthError(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setHealthError(true);
      });
    return () => controller.abort();
  }, [token, staff]);

  function onLogin(result: LoginResult) {
    window.sessionStorage.setItem('qe_staff_token', result.accessToken);
    setToken(result.accessToken);
    setStaff(result.staff);
    navigateToPage('Overview', true);
    setLogoutError('');
  }

  async function downloadBusinessData() {
    if (!token || !staff?.roles.includes('OWNER')) return;
    setExportBusy(true);
    setExportMessage('');
    try {
      const headers = new Headers(desktopRequestHeaders());
      headers.set('Accept', 'application/zip');
      headers.set('Authorization', `Bearer ${token}`);
      const response = await fetch(apiRequestUrl('/api/v1/admin/data-export'), { headers });
      if (!response.ok) {
        let message = `Data export failed (HTTP ${response.status}).`;
        try {
          const problem = await response.json() as { message?: string; detail?: string; code?: string };
          message = problem.message ?? problem.detail ?? problem.code ?? message;
        } catch {
          // Preserve the HTTP status if the API did not return JSON.
        }
        throw new Error(message);
      }
      const archive = await response.blob();
      const objectUrl = window.URL.createObjectURL(archive);
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? 'LuckyBajaj-data-export.zip';
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 2000);
      setExportMessage('Export downloaded. Credential, session and licensing secrets are excluded.');
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : 'The business data export could not be downloaded.');
    } finally {
      setExportBusy(false);
    }
  }

  async function logout() {
    setLogoutError('');
    try {
      await apiFetch<void>('/api/v1/auth/staff/logout', token, { method: 'POST' });
    } catch {
      // Local credentials are still cleared if the network is unavailable.
      setLogoutError('The server could not confirm logout. This browser session has still been cleared.');
    } finally {
      window.sessionStorage.removeItem('qe_staff_token');
      setToken('');
      setStaff(null);
      navigateToPage('Overview', true);
      setMobileNavOpen(false);
      setHealth(null);
    }
  }

  if (authLoading) {
    return <main className="auth-screen"><div className="auth-loading"><div className="brand-mark">Q</div><h1>Verifying your session</h1><p>Checking your dealership permissions…</p></div></main>;
  }
  if (!token || !staff) return <StaffLogin onLogin={onLogin} />;

  if (licenseStatus && ['SUSPENDED', 'REVOKED', 'NOT_YET_ACTIVE', 'UNLICENSED'].includes(licenseStatus.state)) {
    return (
      <main className="license-blocked-screen">
        <section className="license-blocked-card">
          <div className="license-blocked-icon">!</div>
          <p className="license-eyebrow">LUCKY BAJAJ AGENCY</p>
          <h1>Software access is restricted</h1>
          <p>{licenseStatus.message}</p>
          <p className="license-blocked-meta">Dealership: {licenseStatus.dealershipCode || 'Not assigned'} · Status: {licenseStatus.state.replaceAll('_', ' ')}</p>
          <p className="license-blocked-help">Contact your software administrator or licensing support to resolve this issue. Your stored dealership records have not been deleted.</p>
          <button type="button" className="license-blocked-signout" onClick={() => void logout()}>Sign out</button>
        </section>
      </main>
    );
  }

  const visibleNavigation = navigation.filter((item) => !item.permission || staff.permissions.includes(item.permission));
  const pageDescription = descriptions[activePage];
  const initials = staff.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');

  return (
    <div className="app-shell">
      <GlobalNotificationHost />
      {mobileNavOpen && <button type="button" className="mobile-nav-backdrop" aria-label="Close navigation menu" tabIndex={-1} onClick={() => setMobileNavOpen(false)} />}
      <aside id="primary-navigation" ref={mobileNavRef}
        role={mobileNavOpen ? 'dialog' : undefined}
        aria-modal={mobileNavOpen ? true : undefined}
        aria-label={mobileNavOpen ? 'Primary navigation menu' : undefined}
        className={`sidebar${mobileNavOpen ? ' mobile-open' : ''}${desktopNavCollapsed ? ' collapsed' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark">Q</div>
          <div className="brand-copy">
            <div className="brand-name">Quanta<span>Edge</span></div>
            <div className="brand-caption">DEALERSHIP MANAGEMENT</div>
          </div>
          <button type="button" className="mobile-drawer-close" aria-label="Close navigation menu"
            onClick={() => setMobileNavOpen(false)}>×</button>
        </div>
        <div className="agency-switcher">
          <div className="agency-avatar">LB</div>
          <div className="agency-copy"><strong>Lucky Bajaj Agency</strong><span>{staff.dealershipCode}</span></div>
          <span className="switcher-dots">●</span>
        </div>

        {['Workspace', 'Customers & sales', 'Service centre', 'Business control', 'Engagement'].map((group) => (
          <nav className="nav-group" aria-label={group} key={group}>
            <div className="nav-label">{group}</div>
            {visibleNavigation.filter((item) => item.group === group).map((item) => (
              <button type="button" key={item.label}
                className={activePage === item.label ? 'nav-item active' : 'nav-item'}
                aria-current={activePage === item.label ? 'page' : undefined}
                title={item.label}
                onClick={() => { navigateToPage(item.label); setMobileNavOpen(false); setShowInbox(false); }}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-text">{item.label}</span>
                {item.label === 'Notification Studio' && <span className="nav-new">STUDIO</span>}
              </button>
            ))}
          </nav>
        ))}

        <div className="sidebar-bottom">
          <div className="support-mark">QE</div>
          <div className="support-copy"><strong>Powered by QuantaEdge</strong><span>Smarter Decisions. Greater Growth.</span></div>
        </div>
      </aside>

      <main className="main-content" aria-hidden={mobileNavOpen ? true : undefined}>
      {licenseStatus?.state === 'READ_ONLY' && (
        <div className="license-status-banner license-status-banner--readonly" role="status">
          <strong>Read-only mode: license expired.</strong>
          <span> Existing records and permitted exports remain available. Creating or changing records is disabled. Contact licensing support to renew.</span>
          {licenseStatus.expiresAt && <small> Expired {new Date(licenseStatus.expiresAt).toLocaleDateString()}.</small>}
          {staff.roles.includes('OWNER') && (
            <button type="button" className="license-export-button" onClick={() => void downloadBusinessData()} disabled={exportBusy}>
              {exportBusy ? 'Preparing export…' : 'Download business data'}
            </button>
          )}
          {exportMessage && <span className="license-export-status" role="status">{exportMessage}</span>}
        </div>
      )}
      {licenseStatus?.state === 'GRACE' && (
        <div className="license-status-banner license-status-banner--grace" role="status">
          <strong>License renewal required.</strong>
          <span> Your dealership is in its grace period. Renew before it ends to avoid read-only access.</span>
          {licenseStatus.gracePeriodEndsAt && <small> Grace period ends {new Date(licenseStatus.gracePeriodEndsAt).toLocaleDateString()}.</small>}
        </div>
      )}
      {licenseStatus?.state === 'ACTIVE' && licenseStatus.daysUntilExpiry >= 0 && licenseStatus.daysUntilExpiry <= 14 && (
        <div className="license-status-banner license-status-banner--grace" role="status">
          <strong>License expires soon.</strong>
          <span> {licenseStatus.daysUntilExpiry} day(s) remaining. Contact licensing support to renew.</span>
        </div>
      )}
        <header className="topbar">
          <button type="button" className="desktop-nav-toggle" aria-label={desktopNavCollapsed ? 'Expand navigation' : 'Collapse navigation'} aria-controls="primary-navigation" aria-expanded={!desktopNavCollapsed} title={desktopNavCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setDesktopNavCollapsed((collapsed) => !collapsed)}>{desktopNavCollapsed ? '›' : '‹'}</button>
          <button ref={mobileNavToggleRef} type="button" className="mobile-nav-toggle" aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileNavOpen} aria-controls="primary-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? '×' : '☰'}</button>
          <div className="breadcrumbs">Lucky Bajaj Agency <span>/</span> {activePage}</div>
          <div className="topbar-actions">
            <div className={health ? 'connection-status online' : 'connection-status'}>
              <span className="status-dot" />
              {health ? 'API connected' : healthError ? 'API unavailable' : 'Connecting'}
            </div>
            {staff.permissions.includes('notification.read') && <div className="inbox-control">
              <button className="icon-button inbox-trigger" aria-label={unreadCount ? `Open inbox, ${unreadCount} unread` : 'Open notification inbox'}
                aria-expanded={showInbox} title="Notification inbox" type="button"
                onClick={() => setShowInbox((open) => !open)}>♧{unreadCount > 0 && <span className="inbox-trigger-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
              {showInbox && <NotificationInbox onClose={() => setShowInbox(false)} onUnreadCountChange={updateUnreadCount} />}
            </div>}
            <div className="user-avatar" title={staff.fullName}>{initials || 'ST'}</div>
            <button className="logout-button" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        <div className="page-wrap">
          {logoutError && <div className="notice notice-error" role="status">{logoutError}</div>}
          {activePage === 'Social Media Studio' ? (
            <SocialMediaArtworkStudio onClose={() => navigateToPage('Notification Studio')} canManage={staff.permissions.includes('social_media.manage')} canPublish={staff.permissions.includes('social_media.publish')} canReadWhatsapp={staff.permissions.includes('social_media.whatsapp.read')} canManageWhatsapp={staff.permissions.includes('social_media.whatsapp.manage')} canSendWhatsapp={staff.permissions.includes('social_media.whatsapp.send')} />
          ) : activePage === 'Customers' ? (
            <CustomerWorkspace token={token} staff={staff} />
          ) : activePage === 'Sales pipeline' ? (
            <SalesWorkspace token={token} staff={staff} />
          ) : activePage === 'Notification Studio' ? (
            <NotificationStudio staff={staff} />
          ) : activePage === 'Bike inventory' ? (
            <VehicleInventoryWorkspace token={token} staff={staff} />
          ) : activePage === 'Spare parts' ? (
            <SparePartsWorkspace token={token} staff={staff} />
          ) : activePage === 'Workshop' ? (
            <WorkshopWorkspace token={token} staff={staff} />
          ) : activePage === 'Reports' ? (
            <FinanceReportsWorkspace token={token} permissions={staff.permissions} />
          ) : activePage === 'Billing & expenses' ? (
            <BillingWorkspace token={token} permissions={staff.permissions} />
          ) : activePage === 'Team & access' ? (
            <StaffDirectoryWorkspace token={token} staff={staff} />
          ) : activePage === 'Overview' ? (
            <>
              <section className="welcome-row">
                <div><div className="eyebrow">DEALERSHIP COMMAND CENTRE</div><h1>Good day, {staff.fullName.split(/\s+/)[0]}.</h1><p>Your sales, service and customer operations—connected in one place.</p></div>
                <div className="date-chip">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date())}</div>
              </section>

              <section className="hero-panel">
                <div className="hero-copy">
                  <div className="hero-kicker"><span /> YOUR BUSINESS, IN SYNC</div>
                  <h2>Every customer.<br /><em>Every journey.</em> One view.</h2>
                  <p>Bring enquiries, bike delivery, workshop jobs, parts and customer follow-ups together—with clear ownership at every step.</p>
                  <button type="button" className="primary-button" onClick={() => navigateToPage('Customers')}>Open customer workspace <span>↗</span></button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-ring ring-one" /><div className="art-ring ring-two" />
                  <div className="art-orbit"><span>SALES</span><span>SERVICE</span><span>CARE</span></div>
                  <div className="art-core"><span>Q</span><small>CONNECTED<br />OPERATIONS</small></div>
                  <div className="art-spark spark-one">✳</div><div className="art-spark spark-two">✦</div>
                </div>
              </section>

              <section className="section-heading">
                <div><h2>Business at a glance</h2><p>Live figures appear as the relevant modules are connected to real records.</p></div>
                <span className="live-badge"><span /> LIVE DATA ONLY</span>
              </section>

              <section className="metric-grid">
                {[
                  { label: 'Bike sales today', value: '—', note: 'Sales module not connected', icon: '↗', tone: 'orange' },
                  { label: 'Workshop in progress', value: '—', note: 'Job cards not connected', icon: '⚙', tone: 'blue' },
                  { label: 'Payments collected', value: '—', note: 'Payment records not connected', icon: '₹', tone: 'green' },
                  { label: 'Customer follow-ups', value: '—', note: 'CRM tasks not connected', icon: '◎', tone: 'purple' },
                ].map((metric) => (
                  <article className="metric-card" key={metric.label}>
                    <div className={'metric-icon ' + metric.tone}>{metric.icon}</div>
                    <div className="metric-label">{metric.label}</div><div className="metric-value">{metric.value}</div><div className="metric-note">{metric.note}</div>
                  </article>
                ))}
              </section>

              <section className="lower-grid">
                <article className="surface-card focus-card">
                  <div className="card-heading"><div><h3>Operational priorities</h3><p>The first workflows to bring online</p></div><span className="muted-counter">04 MODULES</span></div>
                  {[
                    ['01', 'Customer & bike records', 'One reliable customer and vehicle history.'],
                    ['02', 'Sales-to-delivery flow', 'Track enquiry, booking, allocation and handover.'],
                    ['03', 'Workshop job cards', 'Make every service visit measurable and traceable.'],
                    ['04', 'Notification Studio', 'Design useful, permission-aware customer updates.'],
                  ].map(([number, title, detail]) => (
                    <div className="priority-row" key={number}>
                      <span className="priority-number">{number}</span><div><strong>{title}</strong><p>{detail}</p></div><span className="priority-arrow">↗</span>
                    </div>
                  ))}
                </article>

                <article className="surface-card system-card">
                  <div className="card-heading"><div><h3>System status</h3><p>Application foundation</p></div><span className={health ? 'health-pill healthy' : 'health-pill'}>{health ? 'Operational' : 'Pending'}</span></div>
                  <div className="system-row"><span>Web application</span><strong className="system-ready">Running</strong></div>
                  <div className="system-row"><span>Backend API</span><strong>{health ? 'Connected' : 'Not confirmed'}</strong></div>
                  <div className="system-row"><span>API version</span><strong>{health?.version ?? '—'}</strong></div>
                  <div className="system-row"><span>Signed-in role</span><strong>{staff.roles.join(', ') || 'No role assigned'}</strong></div>
                  <div className="system-note">{healthError ? 'Start the Spring Boot API on port 8080 to connect this dashboard.' : health ? 'API health endpoint responded. Database health is checked separately.' : 'Checking the Spring Boot health endpoint…'}</div>
                </article>
              </section>
            </>
          ) : (
            <section className="module-landing">
              <div className="module-symbol">{navigation.find((item) => item.label === activePage)?.icon}</div>
              <div className="eyebrow">DEALERSHIP WORKSPACE</div><h1>{activePage}</h1><p>{pageDescription ?? 'The owner dashboard brings together your connected business operations.'}</p>
              <div className="module-state"><span className="status-dot" /> Implementation in progress</div>
              <div className="module-footnote">This workspace is not yet connected to live business transactions. It will be enabled after its API, database rules and acceptance tests are implemented. No sample records are presented as real.</div>
              <button type="button" className="secondary-button" onClick={() => navigateToPage('Overview')}>← Back to overview</button>
            </section>
          )}
          <footer className="page-footer"><span>© {new Date().getFullYear()} QuantaEdge</span><span>Secure by design <b>·</b> Built for Lucky Bajaj Agency</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
