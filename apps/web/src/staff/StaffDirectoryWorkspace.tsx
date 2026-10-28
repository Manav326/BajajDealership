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
type StaffRoleOption = { code: string; displayName: string; permissions: string[] };
type InvitationResult = {
  staffPublicId: string; fullName: string; dealershipCode: string; loginIdentifier: string;
  roles: string[]; activationToken: string; expiresAt: string;
};


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
  const canManage = staff.roles.includes('OWNER') && staff.permissions.includes('staff.manage');
  const [page, setPage] = useState<StaffPage>({ items: [], page: 0, pageSize: 25, total: 0 });
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<StaffDetail | null>(null);
  const [roleOptions, setRoleOptions] = useState<StaffRoleOption[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [savingRoles, setSavingRoles] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [inviteReason, setInviteReason] = useState('');
  const [issuedInvitation, setIssuedInvitation] = useState<InvitationResult | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

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

  useEffect(() => {
    if (!canManage) { setRoleOptions([]); return; }
    let cancelled = false;
    apiFetch<StaffRoleOption[]>('/api/v1/admin/staff/roles', token)
      .then((options) => { if (!cancelled) setRoleOptions(options); })
      .catch((cause) => { if (!cancelled) setInviteError(cause instanceof Error ? cause.message : 'Could not load role options.'); });
    return () => { cancelled = true; };
  }, [canManage, token]);

  useEffect(() => {
    setSelectedRoles(selected?.roles ?? []);
    setRoleReason('');
    setStatusReason('');
  }, [selected?.publicId, selected?.roles.join('|')]);

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

  function toggleRole(roleCode: string, current: string[], setCurrent: (roles: string[]) => void) {
    setCurrent(current.includes(roleCode)
      ? current.filter((role) => role !== roleCode)
      : [...current, roleCode]);
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteError('');
    setInviteSuccess('');
    setError('');
    setIssuedInvitation(null);
    setTokenCopied(false);
    try {
      const result = await apiFetch<InvitationResult>('/api/v1/admin/staff/invitations', token, {
        method: 'POST',
        body: JSON.stringify({
          fullName: inviteName.trim(),
          email: inviteEmail.trim() || null,
          phone: invitePhone.trim() || null,
          roleCodes: inviteRoles,
          reason: inviteReason.trim(),
        }),
      });
      setIssuedInvitation(result);
      setInviteSuccess(`Invitation issued for ${result.fullName}. Copy the token now; it will not be shown again after leaving this screen.`);
      setInviteName('');
      setInviteEmail('');
      setInvitePhone('');
      setInviteRoles([]);
      setInviteReason('');
      setInviteOpen(false);
      await load(0, activeQuery);
    } catch (cause) {
      setInviteError(cause instanceof Error ? cause.message : 'Could not issue the staff invitation.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selectedRoles.length === 0) {
      setDetailError('Assign at least one role before saving.');
      return;
    }
    setSavingRoles(true);
    setDetailError('');
    setInviteSuccess('');
    try {
      await apiFetch('/api/v1/admin/staff/' + encodeURIComponent(selected.publicId) + '/roles', token, {
        method: 'PUT',
        body: JSON.stringify({ roleCodes: selectedRoles, reason: roleReason.trim() }),
      });
      await viewDetails(selected);
      await load(page.page, activeQuery);
      setInviteSuccess('Staff roles updated and recorded in the audit history.');
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Could not update staff roles.');
    } finally {
      setSavingRoles(false);
    }
  }

  async function changeSelectedStatus() {
    if (!selected) return;
    const nextStatus = selected.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!statusReason.trim()) {
      setDetailError('Enter a reason for this status change.');
      return;
    }
    setSavingStatus(true);
    setDetailError('');
    setInviteSuccess('');
    try {
      await apiFetch('/api/v1/admin/staff/' + encodeURIComponent(selected.publicId) + '/status', token, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus, reason: statusReason.trim() }),
      });
      await viewDetails(selected);
      await load(page.page, activeQuery);
      setInviteSuccess(nextStatus === 'DISABLED'
        ? 'Staff access disabled. Active staff sessions were revoked.'
        : 'Staff access reactivated. Existing sessions remain revoked; the staff member must sign in again.');
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'Could not update staff status.');
    } finally {
      setSavingStatus(false);
    }
  }

  async function copyActivationToken() {
    if (!issuedInvitation) return;
    try {
      await navigator.clipboard.writeText(issuedInvitation.activationToken);
      setTokenCopied(true);
    } catch {
      setTokenCopied(false);
      setInviteError('Clipboard access is unavailable. Select and copy the activation token manually.');
    }
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
        <div className="staff-heading-actions">
          <div className="date-chip">{page.total} staff record{page.total === 1 ? '' : 's'}</div>
          {canManage && <button type="button" className="primary-button" onClick={() => { setInviteOpen((open) => !open); setInviteError(''); }}>+ Invite staff</button>}
        </div>
      </div>

      {inviteSuccess && <div className="notice notice-success" role="status">{inviteSuccess}</div>}
      {inviteError && <div className="notice notice-error" role="alert">{inviteError}</div>}
      {issuedInvitation && <section className="customer-form-card staff-token-card" aria-label="New staff activation token">
        <div className="form-card-heading">
          <div><h2>Staff invitation created</h2><p>For {issuedInvitation.fullName} · {issuedInvitation.loginIdentifier}</p></div>
          <button type="button" className="text-button" onClick={() => { setIssuedInvitation(null); setTokenCopied(false); }}>Dismiss</button>
        </div>
        <div className="portal-invitation-warning"><strong>Copy and share securely</strong><span>This token is shown once, expires {dateLabel(issuedInvitation.expiresAt)}, and is not emailed or sent by SMS.</span></div>
        <label className="portal-token-label">Single-use activation token<input readOnly value={issuedInvitation.activationToken} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="portal-invitation-actions"><button type="button" className="secondary-button" onClick={() => void copyActivationToken()}>{tokenCopied ? 'Copied token ✓' : 'Copy activation token'}</button><span>Ask the staff member to open the staff portal and choose “Activate invitation”.</span></div>
      </section>}

      {inviteOpen && canManage && <form className="customer-form-card staff-invite-form" onSubmit={submitInvitation}>
        <div className="form-card-heading"><div><h2>Invite a staff member</h2><p>The invitee sets their own password using the one-time token.</p></div><button type="button" className="text-button" onClick={() => setInviteOpen(false)}>Cancel</button></div>
        <div className="staff-form-grid">
          <label>Full name<input required maxLength={160} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label>
          <label>Email address <span className="optional-label">Optional if mobile is supplied</span><input type="email" maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label>Mobile number <span className="optional-label">Optional if email is supplied</span><input type="tel" maxLength={32} value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} /></label>
          <label className="staff-form-wide">Reason for access<input required minLength={4} maxLength={500} value={inviteReason} onChange={(event) => setInviteReason(event.target.value)} placeholder="For example, hiring a new sales executive" /></label>
        </div>
        <div className="eyebrow staff-permission-heading">ASSIGN ROLES · OWNER ROLE IS PROTECTED</div>
        <div className="staff-role-options">{roleOptions.map((role) => <label key={role.code} className="staff-role-option">
          <input type="checkbox" checked={inviteRoles.includes(role.code)} onChange={() => toggleRole(role.code, inviteRoles, setInviteRoles)} />
          <span><strong>{role.displayName}</strong><small>{role.permissions.length} effective permissions</small></span>
        </label>)}</div>
        {roleOptions.length === 0 && <p className="module-footnote">No assignable roles are available. The protected Owner role is intentionally omitted.</p>}
        <div className="sales-form-actions"><button type="submit" className="primary-button" disabled={inviteBusy || inviteRoles.length === 0}>{inviteBusy ? 'Issuing invitation…' : 'Issue single-use invitation'}</button><span>Expires in 24 hours. Only the token hash is stored.</span></div>
      </form>}

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
            {canManage && !selected.roles.includes('OWNER') && selected.publicId !== staff.staffPublicId && <>
              <form className="staff-access-form" onSubmit={saveRoles}>
                <div className="eyebrow">CHANGE ASSIGNED ROLES</div>
                <p className="module-footnote">Select the complete role set for this staff member. Every change requires a reason and is auditable.</p>
                <div className="staff-role-options">{roleOptions.map((role) => <label key={role.code} className="staff-role-option">
                  <input type="checkbox" checked={selectedRoles.includes(role.code)} onChange={() => toggleRole(role.code, selectedRoles, setSelectedRoles)} />
                  <span><strong>{role.displayName}</strong><small>{role.permissions.length} effective permissions</small></span>
                </label>)}</div>
                <label>Reason for role change<input required minLength={4} maxLength={500} value={roleReason} onChange={(event) => setRoleReason(event.target.value)} /></label>
                <button type="submit" className="secondary-button" disabled={savingRoles || selectedRoles.length === 0}>{savingRoles ? 'Saving roles…' : 'Save roles'}</button>
              </form>
              <form className="staff-access-form" onSubmit={(event) => { event.preventDefault(); void changeSelectedStatus(); }}>
                <div className="eyebrow">ACCOUNT STATUS</div>
                <p className="module-footnote">{selected.status === 'ACTIVE' ? 'Disabling immediately revokes all active sessions.' : selected.status === 'DISABLED' ? 'Reactivating allows the staff member to sign in again; prior sessions stay revoked.' : 'Pending invitations are activated by the invitee and cannot be changed here.'}</p>
                {['ACTIVE', 'DISABLED'].includes(selected.status) && <>
                  <label>Reason for status change<input required minLength={4} maxLength={500} value={statusReason} onChange={(event) => setStatusReason(event.target.value)} /></label>
                  <button type="submit" className={selected.status === 'ACTIVE' ? 'secondary-button danger-link' : 'secondary-button'} disabled={savingStatus}>{savingStatus ? 'Updating account…' : selected.status === 'ACTIVE' ? 'Disable account' : 'Reactivate account'}</button>
                </>}
              </form>
            </>}
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
