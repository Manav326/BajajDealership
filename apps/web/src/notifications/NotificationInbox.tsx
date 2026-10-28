import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiClient';
import { notifyUser } from './GlobalNotificationHost';
import RichNotificationRenderer from './RichNotificationRenderer';

type DocumentV1 = { version: 1; blocks: Array<Record<string, unknown> & { type: string }> };
type InboxItem = {
  recipientPublicId: string;
  campaignPublicId: string;
  title: string;
  summary: string | null;
  contentDocument: DocumentV1;
  senderName: string;
  status: string;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};
type InboxPage = { items: InboxItem[]; page: number; pageSize: number; total: number; unreadCount: number };

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { message?: string; detail?: string };
  if (!response.ok) throw new Error(body.message ?? body.detail ?? 'Notification inbox is unavailable.');
  return body;
}

function relativeDate(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function NotificationInbox({
  onClose, onUnreadCountChange,
}: {
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/admin/notifications/inbox?page=0&pageSize=20', { cache: 'no-store' });
      const data = await parse<InboxPage>(response);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setUnreadCount(data.unreadCount ?? 0);
      onUnreadCountChange(data.unreadCount ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [onUnreadCountChange]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(item: InboxItem, read: boolean) {
    setBusyId(item.recipientPublicId);
    setError('');
    try {
      const response = await apiFetch(
        `/api/v1/admin/notifications/inbox/${item.recipientPublicId}/${read ? 'read' : 'unread'}`,
        { method: 'POST' },
      );
      if (!response.ok) await parse<unknown>(response);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update notification.');
    } finally {
      setBusyId('');
    }
  }

  async function dismiss(item: InboxItem) {
    setBusyId(item.recipientPublicId);
    setError('');
    try {
      const response = await apiFetch(
        `/api/v1/admin/notifications/inbox/${item.recipientPublicId}/dismiss`,
        { method: 'POST' },
      );
      if (!response.ok) await parse<unknown>(response);
      await load();
      notifyUser('Notification dismissed from your inbox.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not dismiss notification.');
    } finally {
      setBusyId('');
    }
  }

  async function markAllRead() {
    setError('');
    try {
      const response = await apiFetch('/api/v1/admin/notifications/inbox/read-all', { method: 'POST' });
      if (!response.ok) await parse<unknown>(response);
      await load();
      notifyUser('All notifications marked as read.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark notifications as read.');
    }
  }

  return (
    <section className="inbox-popover" aria-label="Notification inbox">
      <header className="inbox-popover-header">
        <div><strong>Notifications</strong><span>{unreadCount} unread · {total} total</span></div>
        <div className="inbox-popover-actions">
          <button type="button" onClick={() => void load()} aria-label="Refresh inbox" title="Refresh inbox">↻</button>
          <button type="button" onClick={onClose} aria-label="Close inbox" title="Close inbox">×</button>
        </div>
      </header>
      {error && <div className="inbox-error" role="alert">{error}</div>}
      {unreadCount > 0 && <div className="inbox-mark-all"><button type="button" onClick={() => void markAllRead()}>Mark all as read</button></div>}
      <div className="inbox-list">
        {loading ? <div className="inbox-empty">Loading your inbox…</div>
          : items.length === 0 ? <div className="inbox-empty"><span>✳</span><strong>You’re all caught up</strong><p>New staff notifications will appear here.</p></div>
          : items.map((item) => {
            const unread = !item.readAt;
            const busy = busyId === item.recipientPublicId;
            const expanded = expandedId === item.recipientPublicId;
            return <article key={item.recipientPublicId} className={unread ? 'inbox-item unread' : 'inbox-item'}>
              <button type="button" className="inbox-item-main" onClick={() => {
                setExpandedId((current) => current === item.recipientPublicId ? '' : item.recipientPublicId);
                if (unread) void markRead(item, true);
              }} aria-expanded={expanded}>
                <span className="inbox-item-icon">✳</span>
                <span className="inbox-item-copy"><strong>{item.title}</strong><span>{item.summary || 'A dealership notification is available.'}</span><small>{item.senderName} · {relativeDate(item.createdAt)}</small></span>
                {unread && <span className="inbox-unread-dot" aria-label="Unread" />}
              </button>
              {expanded && <div className="inbox-item-expanded">
                <RichNotificationRenderer document={item.contentDocument} surface="staff" mode="inbox" />
                <div className="inbox-item-footer">
                  <button type="button" disabled={busy} onClick={() => void markRead(item, !item.readAt)}>{busy ? 'Updating…' : item.readAt ? 'Mark unread' : 'Mark read'}</button>
                  <button type="button" disabled={busy} onClick={() => void dismiss(item)}>Dismiss</button>
                </div>
              </div>}
            </article>;
          })}
      </div>
      <footer className="inbox-popover-footer">
        <span>In-app notifications</span><span>Other delivery channels are separate.</span>
      </footer>
    </section>
  );
}
