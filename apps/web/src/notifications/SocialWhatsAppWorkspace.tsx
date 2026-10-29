import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiClient';
import styles from './SocialWhatsAppWorkspace.module.css';

type Status = { configured: boolean; webhookConfigured: boolean; message: string; webhookMessage: string; missingConfigurationKeys: string[]; missingWebhookConfigurationKeys: string[] };
type Customer = { publicId: string; customerCode: string; fullName: string; maskedPhone: string; validPhone: boolean; consentStatus: string; consentSource: string | null; consentUpdatedAt: string | null };
type Template = { name: string; language: string; status: string; category: string | null; bodyParameterCount: number; headerFormat: string; supported: boolean; unsupportedReason: string | null };
type Consent = { customerPublicId: string; customerName: string; maskedPhone: string; status: string; source: string; consentedAt: string | null; optedOutAt: string | null };
type Message = { publicId: string; status: string; templateName: string; languageCode: string; providerMessageId: string | null; errorCode: string | null; createdAt: string; updatedAt: string; acceptedAt?: string | null; sentAt: string | null; deliveredAt: string | null; readAt: string | null; failedAt: string | null; scheduledAt?: string | null };
type Props = { canRead: boolean; canManage: boolean; canSend: boolean; getArtworkJpeg: () => Promise<Blob> };

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { message?: string; detail?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.detail ?? 'Request failed (' + response.status + ').');
  return payload;
}
function localDateTimeMin(minutes = 2): string {
  const date = new Date(Date.now() + minutes * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function makeIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? ('wa-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}

export default function SocialWhatsAppWorkspace({ canRead, canManage, canSend, getArtworkJpeg }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [parameters, setParameters] = useState<string[]>([]);
  const [source, setSource] = useState('Customer-confirmed WhatsApp opt-in');
  const [evidence, setEvidence] = useState('');
  const [optInVerified, setOptInVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [includeArtwork, setIncludeArtwork] = useState(false);
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [scheduledMessages, setScheduledMessages] = useState<Message[]>([]);

  const customer = customers.find((item) => item.publicId === customerId) ?? null;
  const template = templates.find((item) => item.name + '|' + item.language === templateId) ?? null;

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [currentStatus, list, scheduled] = await Promise.all([
        apiFetch('/api/v1/admin/social/whatsapp/status', { cache: 'no-store' }).then(readResponse<Status>),
        apiFetch('/api/v1/admin/social/whatsapp/customers?limit=100', { cache: 'no-store' }).then(readResponse<Customer[]>),
        apiFetch('/api/v1/admin/social/whatsapp/scheduled?limit=25', { cache: 'no-store' }).then(readResponse<Message[]>)
      ]);
      setStatus(currentStatus);
      setCustomers(list);
      setScheduledMessages(scheduled);
      setCustomerId((current) => current && list.some((item) => item.publicId === current) ? current : (list[0]?.publicId ?? ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp workspace could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    const selected = templates.find((item) => item.name + '|' + item.language === templateId);
    if (!selected) {
      setParameters([]);
      setIncludeArtwork(false);
      return;
    }
    setParameters(Array.from({ length: selected.bodyParameterCount }, () => ''));
    setIncludeArtwork(selected.headerFormat === 'IMAGE');
  }, [templateId, templates]);

  async function loadTemplates() {
    setBusy(true); setError(''); setNotice('');
    try {
      const values = await apiFetch('/api/v1/admin/social/whatsapp/templates', { cache: 'no-store' }).then(readResponse<Template[]>);
      setTemplates(values);
      const preferred = values.find((item) => item.supported);
      setTemplateId(preferred ? preferred.name + '|' + preferred.language : '');
      setNotice(values.length ? 'Loaded ' + values.length + ' approved template variant(s).' : 'Meta returned no approved template variants.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Templates could not be loaded.');
    } finally { setBusy(false); }
  }

  async function saveConsent(optedIn: boolean) {
    if (!customer) return;
    if (optedIn && !optInVerified) { setError('Confirm that the customer explicitly opted in before recording consent.'); return; }
    if (!source.trim()) { setError('Record the source of the customer preference.'); return; }
    const prompt = optedIn
      ? 'Record explicit WhatsApp opt-in for ' + customer.fullName + '?'
      : 'Record WhatsApp opt-out for ' + customer.fullName + '? Future sends will be blocked.';
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch('/api/v1/admin/social/whatsapp/customers/' + customer.publicId + '/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optedIn, source: source.trim(), evidenceReference: evidence.trim() || null })
      }).then(readResponse<Consent>);
      setCustomers((old) => old.map((item) => item.publicId === result.customerPublicId
        ? { ...item, consentStatus: result.status, consentSource: result.source, consentUpdatedAt: result.consentedAt ?? result.optedOutAt }
        : item));
      setOptInVerified(false);
      setNotice(optedIn ? 'WhatsApp opt-in recorded.' : 'WhatsApp opt-out recorded.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Consent could not be saved.');
    } finally { setBusy(false); }
  }

  async function send() {
    if (!canSend) { setError('Your role does not have WhatsApp send permission.'); return; }
    if (!customer || customer.consentStatus !== 'OPTED_IN' || !customer.validPhone) {
      setError('Choose a customer with a valid phone and active WhatsApp opt-in.'); return;
    }
    if (!template || !template.supported) { setError('Choose a supported, approved template.'); return; }
    if (parameters.length !== template.bodyParameterCount || parameters.some((value) => !value.trim())) {
      setError('Fill in every body parameter for this template.'); return;
    }
    if ((template.headerFormat === 'IMAGE') !== includeArtwork) {
      setError('The image-header choice must match the selected template.'); return;
    }
    if (scheduledLocal && Number.isNaN(new Date(scheduledLocal).getTime())) { setError('Choose a valid local send time.'); return; }
    const scheduledAt = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;
    if (scheduledAt && new Date(scheduledAt).getTime() < Date.now() + 120000) { setError('Schedule the send at least two minutes from now.'); return; }
    const prompt = scheduledAt
      ? 'Schedule approved template "' + template.name + '" for ' + customer.fullName + ' (' + customer.maskedPhone + ') at ' + new Date(scheduledAt).toLocaleString() + '? Consent and template approval will be rechecked when it dispatches.'
      : 'Send approved template "' + template.name + '" to ' + customer.fullName + ' (' + customer.maskedPhone + ')?';
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let assetId: string | null = null;
      if (includeArtwork) {
        const blob = await getArtworkJpeg();
        const form = new FormData();
        form.append('file', blob, 'bajaj-campaign-whatsapp.jpg');
        const uploaded = await apiFetch('/api/v1/admin/social/media', { method: 'POST', body: form })
          .then(readResponse<{ assetId: string }>);
        assetId = uploaded.assetId;
      }
      const payload = {
        customerPublicId: customer.publicId,
        templateName: template.name,
        languageCode: template.language,
        bodyParameters: parameters,
        assetId,
        idempotencyKey: makeIdempotencyKey(),
        ...(scheduledAt ? { scheduledAt } : {})
      };
      const endpoint = scheduledAt ? '/api/v1/admin/social/whatsapp/schedule' : '/api/v1/admin/social/whatsapp/send';
      const result = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(readResponse<Message>);
      setMessage(result);
      setScheduledLocal('');
      setNotice(result.status === 'SCHEDULED'
        ? 'WhatsApp send scheduled. The worker will recheck consent, phone and template approval before sending.'
        : result.status === 'ACCEPTED'
          ? 'Meta accepted the message request. Delivery status will update from signed webhooks.'
          : 'WhatsApp message status: ' + result.status + '.');
      void loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WhatsApp message could not be submitted.');
    } finally { setBusy(false); }
  }

  async function refreshMessage() {
    if (!message) return;
    setError('');
    try {
      const result = await apiFetch('/api/v1/admin/social/whatsapp/messages/' + message.publicId, { cache: 'no-store' })
        .then(readResponse<Message>);
      setMessage(result);
      setScheduledMessages((old) => old.map((item) => item.publicId === result.publicId ? result : item));
      setNotice('Provider status: ' + result.status + '.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message status could not be refreshed.');
    }
  }

  async function cancelScheduled(item: Message) {
    if (!canManage || item.status !== 'SCHEDULED') return;
    if (!window.confirm('Cancel this scheduled WhatsApp message? It will not be sent.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiFetch('/api/v1/admin/social/whatsapp/scheduled/' + item.publicId + '/cancel', {
        method: 'POST'
      }).then(readResponse<Message>);
      setScheduledMessages((old) => old.map((value) => value.publicId === item.publicId ? result : value));
      setNotice('Scheduled WhatsApp message cancelled.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scheduled message could not be cancelled.');
    } finally { setBusy(false); }
  }

  async function refreshMessageFor(item: Message) {
    setError('');
    try {
      const result = await apiFetch('/api/v1/admin/social/whatsapp/messages/' + item.publicId, { cache: 'no-store' })
        .then(readResponse<Message>);
      setScheduledMessages((old) => old.map((value) => value.publicId === item.publicId ? result : value));
      setMessage(result);
      setNotice('Provider status: ' + result.status + '.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message status could not be refreshed.');
    }
  }

  return <section className={styles.workspace} aria-label="WhatsApp Business messaging">
    <div className={styles.heading}>
      <div>
        <span className={styles.eyebrow}>WHATSAPP BUSINESS · SEPARATE CHANNEL</span>
        <h3>WhatsApp customer messages</h3>
        <p>Send approved templates to customers with current recorded opt-in. This is not WhatsApp Status publishing.</p>
      </div>
      <button type="button" disabled={busy || loading} onClick={() => void loadWorkspace()} className={styles.secondary}>Refresh</button>
    </div>
    {loading && <p className={styles.note}>Loading WhatsApp configuration and customer consent…</p>}
    {status && <div className={status.configured ? styles.configured : styles.unconfigured}>
      <strong>{status.configured ? 'Cloud API configured' : 'Cloud API not configured'}</strong>
      <p>{status.message}</p>
      {!!status.missingConfigurationKeys?.length && <small><strong>Required messaging settings not configured:</strong> {status.missingConfigurationKeys.join(', ')}</small>}
      <small>{status.webhookMessage}</small>
      {!!status.missingWebhookConfigurationKeys?.length && <small><strong>Required webhook settings not configured:</strong> {status.missingWebhookConfigurationKeys.join(', ')}</small>}
    </div>}
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    <div className={styles.grid}>
      <section className={styles.card}>
        <h4>Customer consent</h4>
        <label>Customer
          <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setError(''); }} disabled={busy}>
            <option value="">Select customer…</option>
            {customers.map((item) => <option key={item.publicId} value={item.publicId}>{item.fullName} · {item.maskedPhone} · {item.consentStatus}</option>)}
          </select>
        </label>
        {customer && <div className={styles.customerSummary}>
          <strong>{customer.fullName}</strong><span>{customer.maskedPhone}</span>
          <span className={customer.consentStatus === 'OPTED_IN' ? styles.optedIn : styles.optedOut}>WhatsApp: {customer.consentStatus}</span>
          {!customer.validPhone && <small>Phone must be in valid international E.164 format.</small>}
        </div>}
        <label>Preference source<input value={source} maxLength={100} onChange={(event) => setSource(event.target.value)} /></label>
        <label>Evidence reference (optional)<input value={evidence} maxLength={500} onChange={(event) => setEvidence(event.target.value)} placeholder="Consent form, CRM note or customer request" /></label>
        <label className={styles.check}><input type="checkbox" checked={optInVerified} onChange={(event) => setOptInVerified(event.target.checked)} /> I verified that this customer explicitly opted in.</label>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!canManage || busy || !customer || !optInVerified || !customer.validPhone} onClick={() => void saveConsent(true)}>Record opt-in</button>
          <button type="button" className={styles.danger} disabled={!canManage || busy || !customer} onClick={() => void saveConsent(false)}>Record opt-out</button>
        </div>
        {!canManage && <p className={styles.note}>Your role cannot change WhatsApp consent preferences.</p>}
      </section>
      <section className={styles.card}>
        <div className={styles.cardHeading}><h4>Approved template</h4><button type="button" className={styles.secondary} disabled={!status?.configured || busy || !canRead} onClick={() => void loadTemplates()}>Load templates</button></div>
        <label>Template and language
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={!templates.length || busy}>
            <option value="">Load Meta-approved templates…</option>
            {templates.map((item) => <option key={item.name + '|' + item.language} value={item.name + '|' + item.language} disabled={!item.supported}>
              {item.name} · {item.language}{item.supported ? '' : ' · unsupported format'}
            </option>)}
          </select>
        </label>
        {template && <div className={styles.customerSummary}>
          <strong>{template.name}</strong><span>{template.category ?? 'Template'} · {template.language}</span>
          <small>Body parameters: {template.bodyParameterCount} · Header: {template.headerFormat}</small>
          {!template.supported && <small>{template.unsupportedReason}</small>}
        </div>}
        {template && parameters.map((value, index) => <label key={templateId + '-' + index}>Body parameter {index + 1}
          <input maxLength={1024} value={value} onChange={(event) => setParameters((old) => old.map((item, i) => i === index ? event.target.value : item))} placeholder={'Value for {{' + (index + 1) + '}}'} />
        </label>)}
        {template?.headerFormat === 'IMAGE' && <label className={styles.check}><input type="checkbox" checked={includeArtwork} onChange={(event) => setIncludeArtwork(event.target.checked)} /> Use current artwork as the image header.</label>}
        <label>Schedule send (optional)
          <input type="datetime-local" value={scheduledLocal} min={localDateTimeMin()} onChange={(event) => setScheduledLocal(event.target.value)} disabled={busy} />
        </label>
        <p className={styles.note}>Leave blank to send now. Scheduled messages run server-side and recheck the customer's current opt-in at dispatch time.</p>
        <button type="button" className={styles.primary} disabled={!canSend || !status?.configured || busy || !template || !template.supported || !customer || customer.consentStatus !== 'OPTED_IN' || !customer.validPhone} onClick={() => void send()}>{busy ? 'Processing…' : scheduledLocal ? 'Schedule WhatsApp template' : 'Send WhatsApp template'}</button>
        {!canSend && <p className={styles.note}>Your role cannot send WhatsApp messages.</p>}
        {message && <div className={styles.messageResult}>
          <div><strong>Latest message</strong><span>{message.status}</span></div>
          <p>{message.templateName} · {message.languageCode}{message.providerMessageId ? ' · Provider ID recorded' : ''}{message.errorCode ? ' · ' + message.errorCode : ''}</p>
          <button type="button" className={styles.textButton} disabled={busy} onClick={() => void refreshMessage()}>Refresh delivery status</button>
        </div>}
      </section>
    </div>
    {scheduledMessages.length > 0 && <section className={styles.card}>
      <div className={styles.cardHeading}><h4>Scheduled WhatsApp messages</h4><button type="button" className={styles.secondary} disabled={busy || loading} onClick={() => void loadWorkspace()}>Refresh queue</button></div>
      {scheduledMessages.map((item) => <div key={item.publicId} className={styles.messageResult}>
        <div><strong>{item.templateName}</strong><span>{item.status}</span></div>
        <p>{item.scheduledAt ? new Date(item.scheduledAt).toLocaleString() : 'Scheduled time unavailable'}{item.errorCode ? ' · ' + item.errorCode : ''}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.textButton} disabled={busy} onClick={() => { setMessage(item); void refreshMessageFor(item); }}>Refresh status</button>
          {canManage && item.status === 'SCHEDULED' && <button type="button" className={styles.danger} disabled={busy} onClick={() => void cancelScheduled(item)}>Cancel scheduled send</button>}
        </div>
      </div>)}
    </section>}
    <p className={styles.note}>A provider acceptance is not proof of delivery. Signed webhooks update sent, delivered, read and failed states; inbound STOP and equivalent keywords withdraw recorded consent.</p>
  </section>;
}
