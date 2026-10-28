import { useEffect, useState } from 'react';

type NoticeDetail = { message?: string; kind?: 'success' | 'error' | 'info' };
type Notice = { id: number; message: string; kind: 'success' | 'error' | 'info' };

let nextNoticeId = 1;

export function notifyUser(message: string, kind: 'success' | 'error' | 'info' = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<NoticeDetail>('qe-notification-toast', { detail: { message, kind } }));
}

export default function GlobalNotificationHost() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<NoticeDetail>).detail;
      if (!detail?.message) return;
      const id = nextNoticeId++;
      setNotices((current) => [...current.slice(-3), {
        id, message: detail.message ?? '', kind: detail.kind ?? 'info',
      }]);
      window.setTimeout(() => {
        setNotices((current) => current.filter((notice) => notice.id !== id));
      }, 4500);
    };
    window.addEventListener('qe-notification-toast', receive);
    return () => window.removeEventListener('qe-notification-toast', receive);
  }, []);

  return <div className="toast-stack" aria-live="polite" aria-atomic="false">
    {notices.map((notice) => <div key={notice.id} className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</div>)}
  </div>;
}
