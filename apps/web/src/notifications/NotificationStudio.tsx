import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { apiFetch } from './apiClient';
import { notifyUser } from './GlobalNotificationHost';
import LogoGraphicsLab, { type UploadedNotificationMedia } from './LogoGraphicsLab';
import RichNotificationRenderer from './RichNotificationRenderer';
import type { StaffSummary } from '../auth/StaffLogin';

type Block = Record<string, unknown> & { type: string };
type DocumentV1 = { version: 1; blocks: Block[] };
type Template = {
  id: number; publicId: string; templateFamilyId: string; templateName: string; description: string | null;
  contentVersion: number; contentDocument: DocumentV1; status: string; createdAt: string; updatedAt: string;
};
type Recipient = {
  recipientId: number; recipientKind: 'CUSTOMER' | 'STAFF'; publicId: string; recipientName: string;
  classCode: string | null; institutionId: number; institutionName: string; institutionCode: string;
};
type Campaign = {
  id: number; publicId: string; scope: string; title: string; summary: string; status: string;
  resolvedRecipientCount: number; scheduledAt: string | null; expiresAt: string | null;
  createdAt: string; dispatchedAt: string | null; cancelledAt: string | null;
};
type Preview = {
  valid: boolean; campaignPublicId: string; previewToken: string; expiresAt: string; recipientCount: number;
  recipientCounts: Record<string, number>; recipients: Recipient[]; message: string;
};
type Options = {
  institutions: Array<{
    id: number; institutionCode: string; displayName: string; status: string;
    activeCustomerCount: number; marketingConsentCustomerCount: number; activeStaffCount: number;
  }>;
  activeCustomerCount: number; marketingConsentCustomerCount: number; activeStaffCount: number;
};
type Envelope<T> = T | { message?: string; detail?: string; error?: string };

const defaultDocument: DocumentV1 = {
  version: 1,
  blocks: [
    { type: 'hero', eyebrow: 'LUCKY BAJAJ AGENCY', title: 'A helpful update for you', subtitle: 'Keep your customers informed with clear, timely updates.' },
    { type: 'richText', text: 'Write a short message here. Use this space for service updates, appointment details or dealership news.' },
    { type: 'cta', label: 'View details', target: '/appointments' },
    { type: 'footer', text: 'Lucky Bajaj Agency · Contact the dealership if you need help.' },
  ],
};

const blockTypes = [
  ['hero', 'Hero / headline'], ['richText', 'Rich text'], ['image', 'Image'], ['cta', 'Call-to-action'],
  ['vehicleCard', 'Vehicle card'], ['serviceCard', 'Service card'], ['highlight', 'Highlight'],
  ['badge', 'Badge'], ['icon', 'Icon with text'], ['divider', 'Divider'], ['spacer', 'Spacer'], ['footer', 'Footer'],
] as const;

function freshBlock(type: string): Block {
  switch (type) {
    case 'hero': return { type, eyebrow: '', title: 'Your dealership update', subtitle: '' };
    case 'richText': return { type, text: 'Write your message here.' };
    case 'image': return { type, assetId: '', alt: '', caption: '', decorative: false };
    case 'cta': return { type, label: 'Book an appointment', target: '/appointments' };
    case 'vehicleCard': return { type, title: 'Your vehicle', description: '', buttonLabel: 'View details', target: '/vehicles' };
    case 'serviceCard': return { type, title: 'Service update', description: '', buttonLabel: 'View service status', target: '/appointments' };
    case 'highlight': return { type, label: 'Next appointment', value: 'Add date and time', description: '' };
    case 'badge': return { type, text: 'DEALERSHIP UPDATE' };
    case 'icon': return { type, icon: '✦', title: 'A quick note', text: '' };
    case 'divider': return { type };
    case 'spacer': return { type, height: 16 };
    case 'footer': return { type, text: 'Lucky Bajaj Agency' };
    default: return { type: 'richText', text: '' };
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok) {
    const errorBody = payload as { message?: string; detail?: string; error?: string };
    throw new Error(errorBody.message ?? errorBody.detail ?? errorBody.error ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

async function getJson<T>(url: string): Promise<T> {
  return readResponse<T>(await apiFetch(url, { cache: 'no-store' }));
}

async function sendJson<T>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  return readResponse<T>(await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function recipientKey(recipient: Pick<Recipient, 'recipientKind' | 'recipientId'>) {
  return `${recipient.recipientKind}:${recipient.recipientId}`;
}

function humanDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    eyebrow: 'Eyebrow', title: 'Heading', subtitle: 'Supporting text', text: 'Text',
    alt: 'Image description (alt text)', caption: 'Image caption', label: 'Button / label',
    target: 'Destination URL or app route', description: 'Description', buttonLabel: 'Button label',
    value: 'Highlighted value', icon: 'Icon', height: 'Spacing in pixels',
  };
  return labels[key] ?? key;
}

const editableFields: Record<string, string[]> = {
  hero: ['eyebrow', 'title', 'subtitle'],
  richText: ['text'],
  image: ['assetId', 'alt', 'caption'],
  animation: ['assetId', 'alt', 'caption'],
  cta: ['label', 'target'],
  vehicleCard: ['title', 'description', 'buttonLabel', 'target'],
  serviceCard: ['title', 'description', 'buttonLabel', 'target'],
  highlight: ['label', 'value', 'description'],
  badge: ['text'],
  icon: ['icon', 'title', 'text'],
  spacer: ['height'],
  footer: ['text'],
};

export default function NotificationStudio({ staff }: { staff: StaffSummary }) {
  const canCreate = staff.permissions.includes('notification.create');
  const canSend = staff.permissions.includes('notification.send');
  const canApprove = staff.permissions.includes('notification.approve');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateName, setTemplateName] = useState('New dealership template');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templatePublicId, setTemplatePublicId] = useState<string | null>(null);
  const [templateVersion, setTemplateVersion] = useState<number | null>(null);
  const [title, setTitle] = useState('A helpful update from Lucky Bajaj');
  const [summary, setSummary] = useState('An update from your dealership');
  const [scope, setScope] = useState<'CUSTOMER' | 'STAFF' | 'DEALERSHIP'>('CUSTOMER');
  const [marketingOnly, setMarketingOnly] = useState(false);
  const [recipientTypes, setRecipientTypes] = useState<Array<'CUSTOMER' | 'STAFF'>>(['CUSTOMER']);
  const [selectionMode, setSelectionMode] = useState<'ALL' | 'SELECTED'>('ALL');
  const [searchKind, setSearchKind] = useState<'CUSTOMER' | 'STAFF'>('CUSTOMER');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<Recipient[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Recipient[]>([]);
  const [excludedRecipients, setExcludedRecipients] = useState<Recipient[]>([]);
  const [document, setDocument] = useState<DocumentV1>(defaultDocument);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [scheduleValue, setScheduleValue] = useState('');
  const [expiryValue, setExpiryValue] = useState('');
  const [showGraphics, setShowGraphics] = useState(false);
  const [addBlockType, setAddBlockType] = useState('richText');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'campaigns'>(() => canCreate ? 'editor' : 'campaigns');

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [templateEnvelope, campaignEnvelope, fetchedOptions] = await Promise.all([
        getJson<{ templates: Template[] }>('/api/v1/admin/notifications/templates'),
        getJson<{ campaigns: Campaign[] }>('/api/v1/admin/notifications/campaigns?limit=50'),
        getJson<Options>('/api/v1/admin/notifications/options'),
      ]);
      setTemplates(templateEnvelope.templates ?? []);
      setCampaigns(campaignEnvelope.campaigns ?? []);
      setOptions(fetchedOptions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification Studio could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const activeTemplates = useMemo(
    () => templates.filter((template) => template.status === 'ACTIVE').sort((a, b) =>
      a.templateName.localeCompare(b.templateName)),
    [templates],
  );

  const recipientTotal = useMemo(() => {
    if (scope === 'CUSTOMER') {
      return marketingOnly ? (options?.marketingConsentCustomerCount ?? 0) : (options?.activeCustomerCount ?? 0);
    }
    if (scope === 'STAFF') return options?.activeStaffCount ?? 0;
    const selectedTypes = recipientTypes.length ? recipientTypes : ['CUSTOMER', 'STAFF'];
    return selectedTypes.reduce((sum, type) => {
      if (type === 'STAFF') return sum + (options?.activeStaffCount ?? 0);
      return sum + (marketingOnly ? (options?.marketingConsentCustomerCount ?? 0) : (options?.activeCustomerCount ?? 0));
    }, 0);
  }, [scope, marketingOnly, options, recipientTypes]);

  function changeScope(next: 'CUSTOMER' | 'STAFF' | 'DEALERSHIP') {
    setScope(next);
    if (next === 'CUSTOMER') { setRecipientTypes(['CUSTOMER']); setMarketingOnly(false); setSearchKind('CUSTOMER'); }
    else if (next === 'STAFF') { setRecipientTypes(['STAFF']); setMarketingOnly(false); setSearchKind('STAFF'); }
    else setRecipientTypes(['CUSTOMER', 'STAFF']);
    setSelectionMode('ALL');
    setSelectedRecipients([]);
    setExcludedRecipients([]);
    setRecipientResults([]);
    setPreview(null);
  }

  function toggleType(type: 'CUSTOMER' | 'STAFF') {
    setRecipientTypes((current) => {
      const updated = current.includes(type) ? current.filter((value) => value !== type) : [...current, type];
      return updated;
    });
    if (scope !== 'DEALERSHIP') setScope('DEALERSHIP');
    if (type === 'STAFF' && !recipientTypes.includes('CUSTOMER')) setMarketingOnly(false);
    setPreview(null);
  }

  function updateBlock(index: number, key: string, value: string | boolean | number) {
    setDocument((current) => ({
      version: 1,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, [key]: value } : block),
    }));
    setPreview(null);
  }

  function deleteBlock(index: number) {
    setDocument((current) => ({ version: 1, blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index) }));
    setPreview(null);
  }

  function addBlock() {
    if (document.blocks.length >= 40) {
      setError('A notification can contain at most 40 content blocks.');
      return;
    }
    setDocument((current) => ({ version: 1, blocks: [...current.blocks, freshBlock(addBlockType)] }));
    setPreview(null);
  }

  function chooseTemplate(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setSelectedTemplate(id);
    setPreview(null);
    if (!id) {
      setTemplatePublicId(null);
      setTemplateVersion(null);
      setTemplateName('New dealership template');
      setTemplateDescription('');
      return;
    }
    const template = activeTemplates.find((candidate) => candidate.publicId === id);
    if (!template) return;
    setTemplatePublicId(template.publicId);
    setTemplateVersion(template.contentVersion);
    setTemplateName(template.templateName);
    setTemplateDescription(template.description ?? '');
    setTitle(template.templateName);
    setSummary(template.description || 'An update from your dealership');
    setDocument(template.contentDocument);
  }

  async function searchRecipients(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams({ kind: searchKind });
      if (recipientQuery.trim()) params.set('query', recipientQuery.trim());
      const result = await getJson<{ recipients: Recipient[] }>(`/api/v1/admin/notifications/recipients?${params.toString()}`);
      setRecipientResults(result.recipients ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search eligible recipients.');
    } finally {
      setSearching(false);
    }
  }

  function toggleRecipient(recipient: Recipient) {
    if (selectionMode === 'SELECTED') {
      setSelectedRecipients((current) => current.some((item) => recipientKey(item) === recipientKey(recipient))
        ? current.filter((item) => recipientKey(item) !== recipientKey(recipient))
        : [...current, recipient]);
    } else {
      setExcludedRecipients((current) => current.some((item) => recipientKey(item) === recipientKey(recipient))
        ? current.filter((item) => recipientKey(item) !== recipientKey(recipient))
        : [...current, recipient]);
    }
    setPreview(null);
  }

  async function previewCampaign() {
    setSaving(true);
    setError('');
    setMessage('');
    setPreview(null);
    try {
      if (!document.blocks.length) throw new Error('Add at least one content block before previewing.');
      if (selectionMode === 'SELECTED' && selectedRecipients.length === 0) {
        throw new Error('Choose at least one recipient or switch to all eligible recipients.');
      }
      if (scope === 'DEALERSHIP' && recipientTypes.length === 0) {
        throw new Error('Choose customers, staff or both for dealership-wide notifications.');
      }
      const request = {
        scope, title: title.trim(), summary: summary.trim(),
        audienceFilter: {
          recipientTypes,
          marketingOnly: scope !== 'STAFF' && marketingOnly,
          selectionMode,
          selectedRecipients: selectionMode === 'SELECTED'
            ? selectedRecipients.map((recipient) => ({ kind: recipient.recipientKind, id: recipient.recipientId }))
            : [],
          excludedRecipients: selectionMode === 'ALL'
            ? excludedRecipients.map((recipient) => ({ kind: recipient.recipientKind, id: recipient.recipientId }))
            : [],
        },
        contentDocument: document,
        templatePublicId,
        templateVersion,
      };
      const result = await sendJson<Preview>('/api/v1/admin/notifications/preview', 'POST', request);
      setPreview(result);
      setMessage(result.message);
      notifyUser('Audience preview is ready. Review the recipients and expiry before sending.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notification preview failed.');
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body = { templateName: templateName.trim(), description: templateDescription.trim() || null, contentDocument: document };
      if (templatePublicId) {
        const updated = await sendJson<Template>(`/api/v1/admin/notifications/templates/${templatePublicId}`, 'PUT', body);
        setTemplates((current) => [updated, ...current.filter((item) => item.publicId !== templatePublicId)]);
        setSelectedTemplate(updated.publicId);
        setTemplatePublicId(updated.publicId);
        setTemplateVersion(updated.contentVersion);
        notifyUser(`Saved template version ${updated.contentVersion}.`, 'success');
      } else {
        const created = await sendJson<Template>('/api/v1/admin/notifications/templates', 'POST', body);
        setTemplates((current) => [created, ...current]);
        setSelectedTemplate(created.publicId);
        setTemplatePublicId(created.publicId);
        setTemplateVersion(created.contentVersion);
        notifyUser('Template saved to the dealership library.', 'success');
      }
      setMessage('Template saved. Template versions are retained for audit and reuse.');
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  }

  async function sendCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) {
      setError('Preview the campaign before sending or scheduling it.');
      return;
    }
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      setError('This preview has expired. Run a new preview before sending.');
      setPreview(null);
      return;
    }
    setSending(true);
    setError('');
    setMessage('');
    try {
      const scheduledAt = scheduleValue ? new Date(scheduleValue).toISOString() : null;
      const expiresAt = expiryValue ? new Date(expiryValue).toISOString() : null;
      if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
        throw new Error('Scheduled time must be in the future.');
      }
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
        throw new Error('Campaign expiry must be in the future.');
      }
      if (scheduledAt && expiresAt && new Date(expiresAt).getTime() <= new Date(scheduledAt).getTime()) {
        throw new Error('Expiry must be later than the scheduled time.');
      }
      const result = await sendJson<{ campaign: Campaign; idempotentReplay: boolean }>(
        '/api/v1/admin/notifications/send', 'POST', {
          campaignPublicId: preview.campaignPublicId,
          previewToken: preview.previewToken,
          idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `qe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          scheduledAt, expiresAt,
        });
      const savedCampaign = result.campaign;
      setCampaigns((current) => [savedCampaign, ...current.filter((item) => item.publicId !== savedCampaign.publicId)]);
      setMessage(savedCampaign.status === 'SCHEDULED'
        ? `Campaign scheduled for ${humanDate(savedCampaign.scheduledAt)}. Recipients will be resolved again at dispatch.`
        : `In-app notification created for ${savedCampaign.resolvedRecipientCount} recipient(s).`);
      setPreview(null);
      setScheduleValue('');
      notifyUser(savedCampaign.status === 'SCHEDULED' ? 'Notification campaign scheduled.' : 'In-app notification sent.', 'success');
      setActiveTab('campaigns');
      await refreshCampaigns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The campaign could not be sent.');
    } finally {
      setSending(false);
    }
  }

  const refreshCampaigns = useCallback(async () => {
    try {
      const result = await getJson<{ campaigns: Campaign[] }>('/api/v1/admin/notifications/campaigns?limit=50');
      setCampaigns(result.campaigns ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign history could not be refreshed.');
    }
  }, []);

  async function cancelCampaign(publicId: string) {
    setError('');
    try {
      const cancelled = await sendJson<Campaign>(`/api/v1/admin/notifications/campaigns/${publicId}/cancel`, 'POST', {});
      setCampaigns((current) => current.map((item) => item.publicId === publicId ? cancelled : item));
      notifyUser('Pending campaign cancelled.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign could not be cancelled.');
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await apiFetch('/api/v1/admin/notifications/media', { method: 'POST', body: formData });
      const asset = await readResponse<UploadedNotificationMedia>(response);
      setDocument((current) => ({ version: 1, blocks: [...current.blocks,
        { type: 'image', assetId: asset.assetId, alt: asset.altText || file.name, caption: '', decorative: false }] }));
      setPreview(null);
      notifyUser('Image uploaded privately and added to the notification.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The image could not be uploaded.');
    } finally {
      setSaving(false);
    }
  }

  function addLogoAsset(asset: UploadedNotificationMedia) {
    setDocument((current) => ({ version: 1, blocks: [...current.blocks,
      { type: 'image', assetId: asset.assetId, alt: asset.altText || 'Lucky Bajaj logo', caption: '', decorative: false }] }));
    setShowGraphics(false);
    setPreview(null);
    notifyUser('Graphic added to the notification design.', 'success');
  }

  const audienceDescription = scope === 'CUSTOMER' ? 'Customers'
    : scope === 'STAFF' ? 'Staff' : 'Customers and staff';
  const selectedRecipientKeys = new Set(selectedRecipients.map(recipientKey));
  const excludedRecipientKeys = new Set(excludedRecipients.map(recipientKey));

  return (
    <section className="notification-studio">
      <div className="studio-heading">
        <div>
          <div className="eyebrow">DEALERSHIP CUSTOMER ENGAGEMENT</div>
          <h1>Notification Studio</h1>
          <p>Build branded updates, review the server-resolved audience and keep a durable delivery record.</p>
        </div>
        <div className="studio-heading-actions">
          <span className="studio-security-note"><span /> In-app delivery · dealership scoped</span>
          <button className="secondary-button" type="button" onClick={() => void loadWorkspace()}>↻ Refresh</button>
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {message && <div className="notice notice-success" role="status">{message}</div>}

      <div className="studio-tabs" role="tablist" aria-label="Notification Studio sections">
        {canCreate && <button type="button" className={activeTab === 'editor' ? 'studio-tab active' : 'studio-tab'} onClick={() => setActiveTab('editor')}>Design & send</button>}
        <button type="button" className={activeTab === 'campaigns' ? 'studio-tab active' : 'studio-tab'} onClick={() => { setActiveTab('campaigns'); void refreshCampaigns(); }}>Campaign history <span>{campaigns.length}</span></button>
      </div>

      {activeTab === 'campaigns' ? (
        <div className="studio-campaigns surface-card">
          <div className="studio-section-heading"><div><h2>Campaign history</h2><p>Scheduled work and in-app delivery states from persisted records.</p></div><span className="studio-count">{campaigns.length} campaigns</span></div>
          {loading ? <div className="studio-empty">Loading campaigns…</div> : campaigns.length === 0 ? <div className="studio-empty">No campaigns yet. Create a notification from the Design & send tab.</div> : (
            <div className="campaign-list">
              {campaigns.map((campaign) => (
                <article className="campaign-row" key={campaign.publicId}>
                  <div className="campaign-symbol">✳</div>
                  <div className="campaign-main"><strong>{campaign.title}</strong><p>{campaign.summary}</p><div className="campaign-meta"><span>{campaign.scope}</span><span>{campaign.resolvedRecipientCount} recipients</span><span>Created {humanDate(campaign.createdAt)}</span>{campaign.scheduledAt && <span>Scheduled {humanDate(campaign.scheduledAt)}</span>}</div></div>
                  <div className="campaign-actions"><span className={`campaign-status status-${campaign.status.toLowerCase()}`}>{campaign.status.replaceAll('_', ' ')}</span>{canApprove && ['PREVIEWED','SCHEDULED','QUEUED'].includes(campaign.status) && <button type="button" className="text-button danger-link" onClick={() => void cancelCampaign(campaign.publicId)}>Cancel</button>}</div>
                </article>
              ))}
            </div>
          )}
          <div className="studio-honesty-note"><strong>Delivery distinction:</strong> SENT means in-app inbox records were persisted. Android push, SMS, WhatsApp and email are not reported as sent until their providers are configured and confirm their own delivery states.</div>
        </div>
      ) : (
        <div className="studio-layout">
          <div className="studio-editor-column">
            <section className="studio-panel">
              <div className="studio-panel-heading"><div><span className="panel-step">01</span><div><h2>Campaign details</h2><p>Choose a saved template or start from your own design.</p></div></div></div>
              <div className="studio-field">
                <label htmlFor="studio-template">Template library</label>
                <select id="studio-template" value={selectedTemplate} onChange={chooseTemplate}>
                  <option value="">Start a new notification</option>
                  {activeTemplates.map((template) => <option value={template.publicId} key={template.publicId}>{template.templateName} · v{template.contentVersion}</option>)}
                </select>
              </div>
              <form onSubmit={saveTemplate} className="template-save-form">
                <div className="studio-two-fields">
                  <div className="studio-field"><label htmlFor="template-name">Template name</label><input id="template-name" required maxLength={120} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></div>
                  <div className="studio-field"><label htmlFor="template-description">Description</label><input id="template-description" maxLength={500} value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} placeholder="Optional internal description" /></div>
                </div>
                <div className="template-form-footer"><span>{templateVersion ? `Editing version ${templateVersion}; save creates a new version.` : 'Save this design as a reusable template.'}</span><button type="submit" className="secondary-button" disabled={saving}>{saving ? 'Saving…' : templatePublicId ? 'Save new version' : 'Save template'}</button></div>
              </form>
              <div className="studio-two-fields">
                <div className="studio-field"><label htmlFor="campaign-title">Campaign title</label><input id="campaign-title" required maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); setPreview(null); }} /></div>
                <div className="studio-field"><label htmlFor="campaign-summary">Inbox summary</label><input id="campaign-summary" required maxLength={300} value={summary} onChange={(event) => { setSummary(event.target.value); setPreview(null); }} /></div>
              </div>
            </section>

            <section className="studio-panel">
              <div className="studio-panel-heading"><div><span className="panel-step">02</span><div><h2>Audience & consent</h2><p>Eligible people are resolved by the server, not by browser-provided counts.</p></div></div><span className="studio-count">{recipientTotal.toLocaleString('en-IN')} potentially eligible</span></div>
              <div className="scope-choices">
                {([
                  ['CUSTOMER', 'Customers', 'Customer messages'],
                  ['STAFF', 'Staff', 'Internal updates'],
                  ['DEALERSHIP', 'Dealership-wide', 'Choose either or both groups'],
                ] as const).map(([value, label, help]) => <button type="button" key={value} onClick={() => changeScope(value)} className={scope === value ? 'scope-choice active' : 'scope-choice'}><strong>{label}</strong><span>{help}</span></button>)}
              </div>
              {scope === 'DEALERSHIP' && <div className="recipient-type-choices">
                <label><input type="checkbox" checked={recipientTypes.includes('CUSTOMER')} onChange={() => toggleType('CUSTOMER')} /> Customers</label>
                <label><input type="checkbox" checked={recipientTypes.includes('STAFF')} onChange={() => toggleType('STAFF')} /> Staff</label>
              </div>}
              {scope !== 'STAFF' && <label className="consent-panel studio-consent"><span className="consent-check"><input type="checkbox" checked={marketingOnly} onChange={(event) => { setMarketingOnly(event.target.checked); setPreview(null); }} /> Marketing campaign — include only customers with recorded marketing consent</span><p>Do not use the marketing audience for service or safety messages. The backend enforces consent filtering for this option.</p></label>}
              <div className="audience-mode">
                <label><input type="radio" name="audience-mode" checked={selectionMode === 'ALL'} onChange={() => { setSelectionMode('ALL'); setSelectedRecipients([]); setPreview(null); }} /> All eligible {audienceDescription.toLowerCase()}</label>
                <label><input type="radio" name="audience-mode" checked={selectionMode === 'SELECTED'} onChange={() => { setSelectionMode('SELECTED'); setExcludedRecipients([]); setPreview(null); }} /> Only selected recipients</label>
              </div>
              <div className="recipient-search-panel">
                <form className="recipient-search-form" onSubmit={searchRecipients}>
                  <div className="studio-field"><label htmlFor="recipient-search-kind">Search group</label><select id="recipient-search-kind" value={searchKind} onChange={(event) => setSearchKind(event.target.value as 'CUSTOMER' | 'STAFF')}><option value="CUSTOMER">Customers</option><option value="STAFF">Staff</option></select></div>
                  <div className="studio-field recipient-search-input"><label htmlFor="recipient-search-query">Find people to {selectionMode === 'SELECTED' ? 'include' : 'exclude'}</label><input id="recipient-search-query" maxLength={100} value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Name, mobile or email" /></div>
                  <button type="submit" className="secondary-button" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
                </form>
                {recipientResults.length > 0 && <div className="recipient-results">
                  <div className="recipient-results-heading"><span>Eligible search results (up to 50)</span><button type="button" className="text-button" onClick={() => setRecipientResults([])}>Clear results</button></div>
                  {recipientResults.map((recipient) => {
                    const key = recipientKey(recipient);
                    const active = selectionMode === 'SELECTED' ? selectedRecipientKeys.has(key) : excludedRecipientKeys.has(key);
                    return <label className={active ? 'recipient-option active' : 'recipient-option'} key={key}>
                      <input type="checkbox" checked={active} onChange={() => toggleRecipient(recipient)} />
                      <span className="recipient-option-avatar">{recipient.recipientName.trim().slice(0, 1).toUpperCase()}</span>
                      <span className="recipient-option-main"><strong>{recipient.recipientName}</strong><small>{recipient.recipientKind === 'CUSTOMER' ? 'Customer' : 'Staff'} · {recipient.institutionCode}</small></span>
                      <span className="recipient-option-action">{active ? 'Selected' : selectionMode === 'SELECTED' ? 'Include' : 'Exclude'}</span>
                    </label>;
                  })}
                </div>}
              </div>
              <div className="selection-summary">
                <span>{selectionMode === 'SELECTED' ? `${selectedRecipients.length} selected` : `${excludedRecipients.length} excluded`}</span>
                <span>{selectionMode === 'SELECTED' ? 'Only these records are considered.' : 'Excluded records are removed from the server-resolved audience.'}</span>
              </div>
            </section>

            <section className="studio-panel">
              <div className="studio-panel-heading"><div><span className="panel-step">03</span><div><h2>Rich content builder</h2><p>Reorder by removing and adding blocks; only supported structured content is accepted.</p></div></div></div>
              <div className="content-tools">
                <button className="secondary-button" type="button" onClick={() => setShowGraphics(true)}>✳ Logo & Graphics</button>
                <label className="secondary-button upload-label">↑ Upload image<input type="file" accept="image/png,image/jpeg" onChange={(event) => void uploadImage(event)} hidden /></label>
                <div className="add-block-controls"><select value={addBlockType} onChange={(event) => setAddBlockType(event.target.value)} aria-label="Content block type">{blockTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="primary-button" onClick={addBlock} disabled={document.blocks.length >= 40}>+ Add block</button></div>
              </div>
              <div className="block-list">
                {document.blocks.map((block, index) => <article className="content-block-editor" key={`${block.type}-${index}`}>
                  <div className="content-block-header"><span className="block-number">{String(index + 1).padStart(2, '0')}</span><strong>{blockTypes.find(([value]) => value === block.type)?.[1] ?? block.type}</strong><button type="button" className="text-button danger-link" onClick={() => deleteBlock(index)} aria-label={`Remove block ${index + 1}`}>Remove</button></div>
                  <div className="block-fields">
                    {(editableFields[block.type] ?? []).map((key) => {
                      const value = block[key];
                      const isLongText = ['text', 'subtitle', 'description', 'caption'].includes(key);
                      return <label className={isLongText ? 'block-field wide' : 'block-field'} key={key}>{fieldLabel(key)}
                        {key === 'height' ? <input type="number" min={4} max={96} value={Number(value ?? 16)} onChange={(event) => updateBlock(index, key, Number(event.target.value))} />
                          : isLongText ? <textarea rows={3} maxLength={5000} value={String(value ?? '')} onChange={(event) => updateBlock(index, key, event.target.value)} />
                          : <input maxLength={key === 'target' ? 500 : 5000} value={String(value ?? '')} onChange={(event) => updateBlock(index, key, event.target.value)} />}
                      </label>;
                    })}
                    {block.type === 'image' && <label className="block-field wide block-checkbox"><input type="checkbox" checked={Boolean(block.decorative)} onChange={(event) => updateBlock(index, 'decorative', event.target.checked)} /> Decorative image (no alt text required)</label>}
                    {block.type === 'cta' && <p className="block-help">Use an internal route such as /appointments, or an approved HTTPS destination. JavaScript links are rejected.</p>}
                    {block.type === 'image' && <p className="block-help">Images are stored privately for this dealership. Use the asset ID returned by Upload image or Logo & Graphics.</p>}
                  </div>
                </article>)}
                {document.blocks.length === 0 && <div className="studio-empty">Add a content block to begin designing your notification.</div>}
              </div>
            </section>
          </div>

          <aside className="studio-preview-column">
            <section className="studio-preview-panel">
              <div className="preview-panel-header"><div><span className="panel-step">04</span><div><h2>Preview</h2><p>Preview is not delivery.</p></div></div><button type="button" className="primary-button" onClick={() => void previewCampaign()} disabled={saving || !title.trim() || !summary.trim()}>{saving ? 'Validating…' : 'Preview audience'}</button></div>
              <div className="preview-summary"><span className="preview-summary-icon">◎</span><div><strong>{title || 'Your campaign title'}</strong><span>{summary || 'Your inbox summary'}</span><small>Draft · {document.blocks.length} content blocks</small></div></div>
              <div className="rich-preview-frame"><div className="preview-device-top"><span /><span /><span /></div><RichNotificationRenderer document={document} surface="admin" mode="mobile" /></div>
              {preview && <div className="preview-result" role="status">
                <div className="preview-result-top"><span className="preview-success-icon">✓</span><div><strong>Audience validated</strong><span>{preview.recipientCount.toLocaleString('en-IN')} recipients after exclusions</span></div></div>
                <div className="preview-counts">{Object.entries(preview.recipientCounts).map(([kind, count]) => <div key={kind}><span>{kind === 'CUSTOMER' ? 'Customers' : 'Staff'}</span><strong>{count.toLocaleString('en-IN')}</strong></div>)}</div>
                <p>{preview.message}</p>
                <div className="preview-expiry">Preview expires {humanDate(preview.expiresAt)}. If the audience or content changes, create a fresh preview.</div>
                <details className="preview-recipient-details"><summary>Review recipient sample ({Math.min(preview.recipients.length, 50)} shown)</summary>{preview.recipients.slice(0, 50).map((recipient) => <div className="preview-recipient" key={recipientKey(recipient)}><span>{recipient.recipientName}</span><small>{recipient.recipientKind}</small></div>)}</details>
              </div>}
              <form className="send-panel" onSubmit={sendCampaign}>
                <h3>Send or schedule</h3>
                <p>Only an unexpired server-issued preview can be accepted.</p>
                <label>Schedule for later <span className="optional-label">Optional</span><input type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} /></label>
                <label>Expiry time <span className="optional-label">Optional</span><input type="datetime-local" value={expiryValue} onChange={(event) => setExpiryValue(event.target.value)} /></label>
                <button type="submit" className="send-button" disabled={!canSend || sending || saving || !preview || preview.recipientCount === 0 || new Date(preview.expiresAt).getTime() <= Date.now()}>{sending ? 'Processing…' : scheduleValue ? 'Schedule campaign' : 'Send in-app notification'} <span>↗</span></button>
                <div className="send-channel-note">{!canSend && <><strong>Send permission required:</strong> Your role can prepare previews but cannot send or schedule notifications yet. </>}<strong>Current channel:</strong> durable in-app inbox only. Push/SMS/WhatsApp/email providers are not configured in this repository yet.</div>
              </form>
            </section>
            <div className="studio-trust-note"><strong>Safe by default</strong><p>Audience eligibility is resolved on the server. Template versions are immutable. Campaign creation uses one-time preview proof and idempotency keys. Media must pass server validation.</p></div>
          </aside>
        </div>
      )}

      {showGraphics && <LogoGraphicsLab onUseAsset={addLogoAsset} onClose={() => setShowGraphics(false)} />}
    </section>
  );
}
