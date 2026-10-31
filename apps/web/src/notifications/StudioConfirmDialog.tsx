import { useEffect, useId, useRef } from 'react';
import styles from './StudioConfirmDialog.module.css';

type Props = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/** Accessible in-app confirmation. Never delegates decisions to browser-native dialogs. */
export default function StudioConfirmDialog({
  title, description, confirmLabel, busy = false, danger = true, onCancel, onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      (cancelRef.current ?? dialogRef.current)?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!dialog || !focusable?.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return <div className={styles.backdrop}>
    <section
      ref={dialogRef}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className={styles.heading}>
        <span className={styles.mark} aria-hidden="true">!</span>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>Confirm this action</p>
        </div>
      </div>
      <p className={styles.description} id={descriptionId}>{description}</p>
      <div className={styles.actions}>
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className={danger ? styles.danger : styles.primary}
          disabled={busy}
          onClick={() => void onConfirm()}
        >{busy ? 'Please wait…' : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
