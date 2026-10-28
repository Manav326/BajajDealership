import { useEffect, useState } from 'react';
import { apiFetch } from './apiClient';
import CustomerWorkspace from './customers/CustomerWorkspace';
import VehicleInventoryWorkspace from './inventory/VehicleInventoryWorkspace';
import NotificationStudio from './notifications/NotificationStudio';
import GlobalNotificationHost from './notifications/GlobalNotificationHost';
import StaffLogin, { type LoginResult, type StaffSummary } from './auth/StaffLogin';

type ApiHealth = {
  status: string;
  service: string;
  version: string;
  timestamp: string;
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
  Reports: 'Sales, workshop, collections, expenses and stock reports based on saved transactions.',
};

function App() {
  const [token, setToken] = useState<string>(() => window.sessionStorage.getItem('qe_staff_token') ?? '');
  const [staff, setStaff] = useState<StaffSummary | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activePage, setActivePage] = useState('Overview');
  const [health, setHealth] = useState<ApiHealth | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [logoutError, setLogoutError] = useState('');

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

  useEffect(() => {
    if (!token || !staff) return;
    const controller = new AbortController();
    fetch('/api/v1/system/health', { signal: controller.signal })
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
    setActivePage('Overview');
    setLogoutError('');
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
      setActivePage('Overview');
      setHealth(null);
    }
  }

  if (authLoading) {
    return <main className="auth-screen"><div className="auth-loading"><div className="brand-mark">Q</div><h1>Verifying your session</h1><p>Checking your dealership permissions…</p></div></main>;
  }
  if (!token || !staff) return <StaffLogin onLogin={onLogin} />;

  const visibleNavigation = navigation.filter((item) => !item.permission || staff.permissions.includes(item.permission));
  const pageDescription = descriptions[activePage];
  const initials = staff.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');

  return (
    <div className="app-shell">
      <GlobalNotificationHost />
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">Q</div>
          <div className="brand-copy">
            <div className="brand-name">Quanta<span>Edge</span></div>
            <div className="brand-caption">DEALERSHIP MANAGEMENT</div>
          </div>
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
                onClick={() => setActivePage(item.label)}>
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

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">Lucky Bajaj Agency <span>/</span> {activePage}</div>
          <div className="topbar-actions">
            <div className={health ? 'connection-status online' : 'connection-status'}>
              <span className="status-dot" />
              {health ? 'API connected' : healthError ? 'API unavailable' : 'Connecting'}
            </div>
            <button className="icon-button" aria-label="Open Notification Studio" title="Open Notification Studio"
              type="button" onClick={() => setActivePage('Notification Studio')}>♧</button>
            <div className="user-avatar" title={staff.fullName}>{initials || 'ST'}</div>
            <button className="logout-button" type="button" onClick={() => void logout()}>Sign out</button>
          </div>
        </header>

        <div className="page-wrap">
          {logoutError && <div className="notice notice-error" role="status">{logoutError}</div>}
          {activePage === 'Customers' ? (
            <CustomerWorkspace token={token} staff={staff} />
          ) : activePage === 'Notification Studio' ? (
            <NotificationStudio staff={staff} />
          ) : activePage === 'Bike inventory' ? (
            <VehicleInventoryWorkspace token={token} staff={staff} />
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
                  <button type="button" className="primary-button" onClick={() => setActivePage('Customers')}>Open customer workspace <span>↗</span></button>
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
              <button type="button" className="secondary-button" onClick={() => setActivePage('Overview')}>← Back to overview</button>
            </section>
          )}
          <footer className="page-footer"><span>© {new Date().getFullYear()} QuantaEdge</span><span>Secure by design <b>·</b> Built for Lucky Bajaj Agency</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
