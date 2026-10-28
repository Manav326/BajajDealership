import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import type { StaffSummary } from '../auth/StaffLogin';

type StaffRecord = {
  publicId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string | null;
};

type StaffDetail = StaffRecord & { permissions: string[] };
type StaffPage = { items: StaffRecord[]; page: number; pageSize: number; total: number };

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').toLowerCase()
    .replace(/(^|\\s)\\S/g, (letter) => letter.toUpperCase());
}

export default function StaffDirectoryWorkspace({ token, staff }: { token: string; staff: StaffSummary }) {
  const canRead = staff.permissions.includes('staff.read');
  const [page, setPage] = useState<StaffPage>({ items: [], page: 0, pageSize: 25, total: 0 });
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<StaffDetail | null>(null);

  const load = useCallback(async (pageNumber: number, search: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(pageNumber), pageSize: '25' });
      if (search.trim()) params.set('q', search.trim());
      const result = await apiFetch<StaffPage>(`/api/v1/admin/staff?${params.toString()}`, token);
      setPage(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load staff records.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canRead) void load(0, '');
    else setLoading(false);
  }, [canRead, load]);

  async function viewDetails(record: StaffRecord) {
    setSelectedId(record.publicId);
    setSelected(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const result = await apiFetch<StaffDetail>(
        `/api/v1/admin/staff/${encodeURIComponent(record.publicId)}`, token);
      setSelected(result);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Could not load staff details.');
    } finally {
      setDetailLoading(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    setActiveQuery(next);
    setSelectedId('');
    setSelected(null);
    void load(0, next);
  }

  function clearSearch() {
    setQuery('');
    setActiveQuery('');
    setSelectedId('');
    setSelected(null);
    void load(0, '');
  }

  function changePage(nextPage: number) {
    if (nextPage < 0 || nextPage * page.pageSize >= page.total) return;
    setSelectedId('');
    setSelected(null);
    void load(nextPage, activeQuery);
  }

  const firstRecord = page.total === 0 ? 0 : page.page * page.pageSize + 1;
  const lastRecord = Math.min((page.page + 1) * page.pageSize, page.total);

  if (!canRead) {
    return <section className="module-landing">
      <div className="module-symbol">♙</div><div className="eyebrow">ACCESS CONTROL</div>
      <h1>Team &amp; access</h1>
      <p>Your assigned role does not include permission to view staff records.</p>
    </section>;
  }

  return (
    <section className="customer-workspace">
      <div className="customer-page-heading">
        <div><div className="eyebrow">PEOPLE &amp; PERMISSIONS</div><h1>Team &amp; access</h1>
          <p>Review staff identities, assigned roles and the access those roles grant.</p></div>
        <div className="date-chip">{page.total} staff record{page.total === 1 ? '' : 's'}</div>
      </div>

      <div className="module-footnote">
        Read-only directory in this release slice. Invitations, account disablement and role changes will be enabled only with audited owner-authorized controls.
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="customer-table-card">
        <div className="workshop-list-toolbar">
          <div><h2>Staff directory</h2><p>Search by name, email or mobile number. Records are restricted to this dealership.</p></div>
          <form className="search-form" onSubmit={search}>
            <input type="search" value={query} maxLength={100} aria-label="Search staff"
              placeholder="Search staff…" onChange={(event) => setQuery(event.target.value)} />
            <button type="submit" className="secondary-button" disabled={loading}>Search</button>
            {activeQuery && <button type="button" className="text-button" onClick={clearSearch}>Clear</button>}
          </form>
        </div>

        <div className="customer-table-scroll">
          <table className="customer-table">
            <thead><tr><th>Staff member</th><th>Contact</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Joined</th><th>Details</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="table-empty"><span className="loading-dot" /> Loading staff directory…</td></tr>
                : page.items.length === 0 ? <tr><td colSpan={7} className="table-empty">{activeQuery ? 'No staff match this search.' : 'No staff records were found for this dealership.'}</td></tr>
                : page.items.map((record) => (
                  <tr key={record.publicId}>
                    <td><strong>{record.fullName}</strong><div className="staff-record-id">{record.publicId}</div></td>
                    <td>{record.email || 'No email'}<div className="staff-contact-secondary">{record.phone || 'No mobile number'}</div></td>
                    <td><div className="staff-role-list">{record.roles.length
                      ? record.roles.map((role) => <span className="status-chip" key={role}>{titleCase(role)}</span>)
                      : <span className="status-chip">No role assigned</span>}</div></td>
                    <td><span className={record.status === 'ACTIVE' ? 'status-chip status-active' : 'status-chip'}>{titleCase(record.status)}</span></td>
                    <td>{dateLabel(record.lastLoginAt)}</td>
                    <td>{dateLabel(record.createdAt)}</td>
                    <td><button type="button" className="text-button" aria-label={`View details for ${record.fullName}`}
                      aria-pressed={selectedId === record.publicId} onClick={() => void viewDetails(record)}>View details</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing {firstRecord}–{lastRecord} of {page.total}</span>
          <div><button type="button" className="pagination-button" disabled={loading || page.page === 0}
            onClick={() => changePage(page.page - 1)}>Previous</button>
            <span>Page {page.page + 1} of {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
            <button type="button" className="pagination-button" disabled={loading || (page.page + 1) * page.pageSize >= page.total}
              onClick={() => changePage(page.page + 1)}>Next</button></div>
        </div>
      </section>

      {(detailLoading || detailError || selected) && <section className="surface-card" aria-label="Staff access details" style={{ marginTop: 18 }}>
        {detailLoading ? <p>Loading staff details…</p> : detailError ? <div className="notice notice-error" role="alert">{detailError}</div>
          : selected && <>
            <div className="form-card-heading">
              <div><div className="eyebrow">STAFF ACCESS REVIEW</div><h2>{selected.fullName}</h2>
                <p>{selected.email || 'No email'} · {selected.phone || 'No mobile number'}</p></div>
              <button type="button" className="text-button" onClick={() => { setSelected(null); setSelectedId(''); }}>Close details</button>
            </div>
            <div className="staff-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginTop: 18 }}>
              <div><div className="eyebrow">ACCOUNT STATUS</div><p><span className={selected.status === 'ACTIVE' ? 'status-chip status-active' : 'status-chip'}>{titleCase(selected.status)}</span></p></div>
              <div><div className="eyebrow">LAST SIGN-IN</div><p>{dateLabel(selected.lastLoginAt)}</p></div>
              <div><div className="eyebrow">ADDED</div><p>{dateLabel(selected.createdAt)}</p></div>
              <div><div className="eyebrow">STAFF ID</div><p>{selected.publicId}</p></div>
            </div>
            <div style={{ marginTop: 20 }}>
              <div className="eyebrow">ASSIGNED ROLES</div>
              <div className="staff-role-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {selected.roles.length ? selected.roles.map((role) => <span className="status-chip" key={role}>{titleCase(role)}</span>) : <span>No roles assigned</span>}
              </div>
            </div>
            <div style={{ marginTop: 20 }}>
              <div className="eyebrow">EFFECTIVE PERMISSIONS · {selected.permissions.length}</div>
              <div className="staff-role-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {selected.permissions.length ? selected.permissions.map((permission) =>
                  <span className="status-chip" key={permission}>{permission}</span>) : <span>No permissions granted by the current roles.</span>}
              </div>
            </div>
            <p className="module-footnote" style={{ marginTop: 20 }}>
              Effective permissions are resolved from the saved role-permission assignments on the server. Password hashes, bearer tokens and session secrets are never returned by this view.
            </p>
          </>}
      </section>}
    </section>
  );
}
