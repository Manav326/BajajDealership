import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { apiFetch } from './apiClient';
import { notifyUser } from './GlobalNotificationHost';
import LogoGraphicsLab, { type UploadedNotificationMedia } from './LogoGraphicsLab';
import SocialMediaArtworkStudio from './SocialMediaArtworkStudio';
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
  dispatchAttemptCount: number; lastDispatchAttemptAt: string | null;
  nextDispatchAttemptAt: string | null; lastDispatchError: string | null;
};
type SavedCampaignPreview = {
  campaign: Campaign; contentDocument: DocumentV1; audienceStage: string;
  audienceResolvedAt: string | null; previewedRecipientCount: number;
  recipientCounts: Record<string, number>;
  currentEligibleRecipientCount: number; currentEligibleRecipientCounts: Record<string, number>;
  eligibilityCheckedAt: string; previewExpiresAt: string | null;
  previewConsumedAt: string | null; approvedAt: string | null;
};
type SendNowResult = { campaign: Campaign; alreadySent: boolean };
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
function dispatchTiming(campaign: Campaign): { label: string; when: string } | null {
  if (campaign.status !== 'SCHEDULED') return null;
  const scheduledFor = campaign.nextDispatchAttemptAt ?? campaign.scheduledAt;
  if (!scheduledFor) return null;
  const timestamp = Date.parse(scheduledFor);
  const retry = Boolean(campaign.nextDispatchAttemptAt);
  const overdue = Number.isFinite(timestamp) && timestamp <= Date.now();
  return {
    label: overdue ? (retry ? 'Retry overdue since' : 'Dispatch overdue since')
      : (retry ? 'Retry scheduled for' : 'Dispatch due'),
    when: humanDate(scheduledFor),
  };
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
  const [previewMode, setPreviewMode] = useState<'mobile' | 'inbox' | 'push'>('mobile');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRequestSequence = useRef(0);
  const [approvedCampaignPublicId, setApprovedCampaignPublicId] = useState('');
  const [scheduleValue, setScheduleValue] = useState('');
  const [expiryValue, setExpiryValue] = useState('');
  const [showGraphics, setShowGraphics] = useState(false);
  const [showSocialArtwork, setShowSocialArtwork] = useState(false);
  const [addBlockType, setAddBlockType] = useState('richText');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const recipientSearchSequence = useRef(0);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedPreview, setSavedPreview] = useState<SavedCampaignPreview | null>(null);
  const [savedPreviewLoading, setSavedPreviewLoading] = useState(false);
  const [confirmSendNow, setConfirmSendNow] = useState(false);
  const [sendingNowPublicId, setSendingNowPublicId] = useState('');
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
    return recipientTypes.reduce((sum, type) => {
      if (type === 'STAFF') return sum + (options?.activeStaffCount ?? 0);
      return sum + (marketingOnly ? (options?.marketingConsentCustomerCount ?? 0) : (options?.activeCustomerCount ?? 0));
    }, 0);
  }, [scope, marketingOnly, options, recipientTypes]);

  // The picker must never offer recipients outside the active campaign audience.
  const availableSearchKinds: Array<'CUSTOMER' | 'STAFF'> = scope === 'CUSTOMER'
    ? ['CUSTOMER']
    : scope === 'STAFF' ? ['STAFF'] : recipientTypes;

  function invalidateRecipientSearch() {
    // Ignore any late response from a search that no longer matches the active audience.
    recipientSearchSequence.current += 1;
    setRecipientResults([]);
    setSearching(false);
  }

  function invalidatePreview() {
    // Ignore any in-flight validation if the audience or content changed afterwards.
    previewRequestSequence.current += 1;
    setPreview(null);
    setApprovedCampaignPublicId('');
    setPreviewing(false);
  }

  function changeScope(next: 'CUSTOMER' | 'STAFF' | 'DEALERSHIP') {
    setScope(next);
    invalidateRecipientSearch();
    if (next === 'CUSTOMER') { setRecipientTypes(['CUSTOMER']); setMarketingOnly(false); setSearchKind('CUSTOMER'); }
    else if (next === 'STAFF') { setRecipientTypes(['STAFF']); setMarketingOnly(false); setSearchKind('STAFF'); }
    else {
      setRecipientTypes(marketingOnly ? ['CUSTOMER'] : ['CUSTOMER', 'STAFF']);
      setSearchKind('CUSTOMER');
    }
    setSelectionMode('ALL');
    setSelectedRecipients([]);
    setExcludedRecipients([]);
    invalidatePreview();
  }

  function toggleType(type: 'CUSTOMER' | 'STAFF') {
    if (marketingOnly) return;
    const updated = recipientTypes.includes(type)
      ? recipientTypes.filter((value) => value !== type)
      : [...recipientTypes, type];
    setRecipientTypes(updated);
    // Keep manual selections compatible with the groups still included in this campaign.
    setSelectedRecipients((recipients) => recipients.filter((recipient) => updated.includes(recipient.recipientKind)));
    setExcludedRecipients((recipients) => recipients.filter((recipient) => updated.includes(recipient.recipientKind)));
    if (updated.length > 0 && !updated.includes(searchKind)) setSearchKind(updated[0]);
    invalidateRecipientSearch();
    if (scope !== 'DEALERSHIP') setScope('DEALERSHIP');
    if (type === 'STAFF' && !recipientTypes.includes('CUSTOMER')) setMarketingOnly(false);
    invalidatePreview();
  }

  function updateBlock(index: number, key: string, value: string | boolean | number) {
    setDocument((current) => ({
      version: 1,
      blocks: current.blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, [key]: value } : block),
    }));
    invalidatePreview();
  }

  function deleteBlock(index: number) {
    setDocument((current) => ({ version: 1, blocks: current.blocks.filter((_, blockIndex) => blockIndex !== index) }));
    invalidatePreview();
  }

  function addBlock() {
    if (document.blocks.length >= 40) {
      setError('A notification can contain at most 40 content blocks.');
      return;
    }
    setDocument((current) => ({ version: 1, blocks: [...current.blocks, freshBlock(addBlockType)] }));
    invalidatePreview();
  }

  function chooseTemplate(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setSelectedTemplate(id);
    invalidatePreview();
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
    const requestId = ++recipientSearchSequence.current;
    const requestedKind = searchKind;
    const applyMarketingFilter = requestedKind === 'CUSTOMER' && scope !== 'STAFF' && marketingOnly;
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams({ kind: requestedKind });
      if (recipientQuery.trim()) params.set('query', recipientQuery.trim());
      if (applyMarketingFilter) params.set('marketingOnly', 'true');
      const result = await getJson<{ recipients: Recipient[] }>(`/api/v1/admin/notifications/recipients?${params.toString()}`);
      if (requestId !== recipientSearchSequence.current) return;
      setRecipientResults((result.recipients ?? []).filter((recipient) => recipient.recipientKind === requestedKind));
    } catch (cause) {
      if (requestId !== recipientSearchSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not search eligible recipients.');
    } finally {
      if (requestId === recipientSearchSequence.current) setSearching(false);
    }
  }

  function isRecipientIncluded(recipient: Recipient) {
    const key = recipientKey(recipient);
    return selectionMode === 'SELECTED'
      ? selectedRecipients.some((item) => recipientKey(item) === key)
      : !excludedRecipients.some((item) => recipientKey(item) === key);
  }

  function setRecipientIncluded(recipient: Recipient, included: boolean) {
    const key = recipientKey(recipient);
    if (selectionMode === 'SELECTED') {
      setSelectedRecipients((current) => included
        ? current.some((item) => recipientKey(item) === key) ? current : [...current, recipient]
        : current.filter((item) => recipientKey(item) !== key));
    } else {
      // In "all eligible" mode, checked means included; unchecked recipients are exclusions.
      setExcludedRecipients((current) => included
        ? current.filter((item) => recipientKey(item) !== key)
        : current.some((item) => recipientKey(item) === key) ? current : [...current, recipient]);
    }
    invalidatePreview();
  }

  function toggleRecipient(recipient: Recipient) {
    setRecipientIncluded(recipient, !isRecipientIncluded(recipient));
  }

  function setVisibleRecipientsIncluded(included: boolean) {
    if (recipientResults.length === 0) return;
    const visibleKeys = new Set(recipientResults.map(recipientKey));
    if (selectionMode === 'SELECTED') {
      setSelectedRecipients((current) => {
        const retained = current.filter((recipient) => !visibleKeys.has(recipientKey(recipient)));
        return included ? [...retained, ...recipientResults] : retained;
      });
    } else {
      setExcludedRecipients((current) => {
        const retained = current.filter((recipient) => !visibleKeys.has(recipientKey(recipient)));
        return included ? retained : [...retained, ...recipientResults];
      });
    }
    invalidatePreview();
  }

  function clearRecipientChanges() {
    if (selectionMode === 'SELECTED') setSelectedRecipients([]);
    else setExcludedRecipients([]);
    invalidatePreview();
  }

  function restoreRecipient(recipient: Recipient) {
    if (selectionMode === 'SELECTED') {
      setSelectedRecipients((current) => current.filter((item) => recipientKey(item) !== recipientKey(recipient)));
    } else {
      setExcludedRecipients((current) => current.filter((item) => recipientKey(item) !== recipientKey(recipient)));
    }
    invalidatePreview();
  }

  async function previewCampaign() {
    invalidatePreview();
    const requestId = ++previewRequestSequence.current;
    setPreviewing(true);
    setError('');
    setMessage('');
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
      if (requestId !== previewRequestSequence.current) return;
      setPreview(result);
      setApprovedCampaignPublicId('');
      setMessage(result.message);
      notifyUser('Audience preview is ready. Review the recipients and expiry before sending.', 'success');
    } catch (cause) {
      if (requestId !== previewRequestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Notification preview failed.');
    } finally {
      if (requestId === previewRequestSequence.current) setPreviewing(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    invalidatePreview();
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
      invalidatePreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  }

  async function approveCampaign() {
    if (!preview) {
      setError('Run a fresh audience preview before approving this campaign.');
      return;
    }
    if (!canApprove) {
      setError('Your assigned role cannot approve notification campaigns.');
      return;
    }
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      setError('This preview has expired. Run a new preview before approval.');
      invalidatePreview();
      setApprovedCampaignPublicId('');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const approved = await sendJson<Campaign>(
        `/api/v1/admin/notifications/campaigns/${preview.campaignPublicId}/approve`,
        'POST',
        { previewToken: preview.previewToken },
      );
      setCampaigns((current) => [approved, ...current.filter((item) => item.publicId !== approved.publicId)]);
      setApprovedCampaignPublicId(approved.publicId);
      setMessage('Campaign approved. Sending or scheduling is now enabled for this approved preview.');
      notifyUser('Notification campaign approved.', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign approval failed.');
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
    if (approvedCampaignPublicId !== preview.campaignPublicId) {
      setError('An authorized approver must approve this exact preview before sending or scheduling.');
      return;
    }
    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      setError('This preview has expired. Run a new preview before sending.');
      invalidatePreview();
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
      invalidatePreview();
      setApprovedCampaignPublicId('');
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

  async function previewSavedCampaign(publicId: string) {
    setSavedPreviewLoading(true);
    setSavedPreview(null);
    setConfirmSendNow(false);
    setError('');
    try {
      const result = await getJson<SavedCampaignPreview>(`/api/v1/admin/notifications/campaigns/${publicId}/preview`);
      setSavedPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved notification preview could not be loaded.');
    } finally {
      setSavedPreviewLoading(false);
    }
  }

  async function sendScheduledNow() {
    if (!savedPreview) return;
    const campaign = savedPreview.campaign;
    setSendingNowPublicId(campaign.publicId);
    setError('');
    setMessage('');
    try {
      const result = await sendJson<SendNowResult>(
        `/api/v1/admin/notifications/campaigns/${campaign.publicId}/send-now`, 'POST', {});
      setCampaigns((current) => current.map((item) =>
        item.publicId === result.campaign.publicId ? result.campaign : item));
      setSavedPreview((current) => current ? { ...current, campaign: result.campaign } : current);
      setConfirmSendNow(false);
      notifyUser(result.alreadySent ? 'This campaign was already sent; no duplicate was created.' : 'Scheduled notification sent to the in-app inbox.', 'success');
      setMessage(result.alreadySent ? 'This notification was already sent.' : 'The scheduled notification was sent now.');
      await refreshCampaigns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The notification could not be sent now.');
    } finally {
      setSendingNowPublicId('');
    }
  }

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
      invalidatePreview();
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
    invalidatePreview();
    notifyUser('Graphic added to the notification design.', 'success');
  }

  const audienceDescription = scope === 'CUSTOMER' ? 'Customers'
    : scope === 'STAFF' ? 'Staff'
      : recipientTypes.length === 2 ? 'Customers and staff'
        : recipientTypes[0] === 'CUSTOMER' ? 'Customers'
          : recipientTypes[0] === 'STAFF' ? 'Staff' : 'recipients';

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
          {staff.permissions.includes('social_media.read') && <button className="secondary-button" type="button" onClick={() => setShowSocialArtwork(true)}>Create social artwork</button>}
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
                  <div className="campaign-main"><strong>{campaign.title}</strong><p>{campaign.summary}</p><div className="campaign-meta"><span>{campaign.scope}</span><span>{campaign.resolvedRecipientCount} recipients</span><span>Created {humanDate(campaign.createdAt)}</span>{campaign.scheduledAt && <span>Scheduled {humanDate(campaign.scheduledAt)}</span>}{dispatchTiming(campaign) && <span className="campaign-dispatch-timing">{dispatchTiming(campaign)!.label} {dispatchTiming(campaign)!.when}</span>}{campaign.dispatchAttemptCount > 0 && <span>{campaign.dispatchAttemptCount} dispatch attempt(s){campaign.lastDispatchAttemptAt ? ' · last ' + humanDate(campaign.lastDispatchAttemptAt) : ''}</span>}{campaign.status === 'FAILED' && campaign.lastDispatchError && <span className="campaign-dispatch-error">Failure recorded: {campaign.lastDispatchError}</span>}</div></div>
                  <div className="campaign-actions">
                    <span className={`campaign-status status-${campaign.status.toLowerCase()}`}>{campaign.status.replaceAll('_', ' ')}</span>
                    <button type="button" className="text-button" onClick={() => void previewSavedCampaign(campaign.publicId)}>Preview exact content</button>
                    {canSend && (campaign.status === 'SCHEDULED' || (campaign.status === 'FAILED' && !!campaign.lastDispatchError && !!campaign.scheduledAt)) &&
                      <button type="button" className="text-button campaign-send-now" onClick={() => void previewSavedCampaign(campaign.publicId)}>
                        {campaign.status === 'FAILED' ? 'Review retry' : 'Send now'} ↗
                      </button>}
                    {canApprove && ['PREVIEWED','APPROVED','SCHEDULED','QUEUED'].includes(campaign.status) &&
                      <button type="button" className="text-button danger-link" onClick={() => void cancelCampaign(campaign.publicId)}>Cancel</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="studio-honesty-note"><strong>Delivery distinction:</strong> SENT means in-app inbox records were persisted. Android push, SMS, WhatsApp and email are not reported as sent until their providers are configured and confirm their own delivery states.</div>
          {savedPreviewLoading && <div className="saved-campaign-overlay" role="dialog" aria-modal="true" aria-label="Loading saved notification preview"><div className="saved-campaign-dialog"><p>Loading the exact saved notification…</p></div></div>}
          {savedPreview && <div className="saved-campaign-overlay" role="dialog" aria-modal="true" aria-labelledby="saved-campaign-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !sendingNowPublicId) { setSavedPreview(null); setConfirmSendNow(false); } }}>
            <section className="saved-campaign-dialog">
              <header className="saved-campaign-header"><div><span className="saved-campaign-eyebrow">PERSISTED CAMPAIGN / {savedPreview.campaign.scope}</span><h2 id="saved-campaign-title">{savedPreview.campaign.title}</h2><p>{savedPreview.campaign.summary}</p></div><button type="button" className="saved-campaign-close" disabled={!!sendingNowPublicId} onClick={() => { setSavedPreview(null); setConfirmSendNow(false); }} aria-label="Close notification preview">×</button></header>
              <div className="saved-campaign-meta">
                <span className={`campaign-status status-${savedPreview.campaign.status.toLowerCase()}`}>{savedPreview.campaign.status.replaceAll('_', ' ')}</span>
                <span>{savedPreview.previewedRecipientCount} recipients in saved snapshot</span>
                <span>{savedPreview.currentEligibleRecipientCount} currently eligible · checked {humanDate(savedPreview.eligibilityCheckedAt)}</span>
                <span>Original audience stage: {savedPreview.audienceStage}</span>
                {savedPreview.audienceResolvedAt && <span>Snapshot resolved: {humanDate(savedPreview.audienceResolvedAt)}</span>}
                {savedPreview.campaign.scheduledAt && <span>Scheduled: {humanDate(savedPreview.campaign.scheduledAt)}</span>}
                {savedPreview.campaign.expiresAt && <span>Expires: {humanDate(savedPreview.campaign.expiresAt)}</span>}
                {savedPreview.approvedAt && <span>Approved: {humanDate(savedPreview.approvedAt)}</span>}
              </div>
              <div className="saved-campaign-preview-label">ORIGINAL SAVED AUDIENCE</div>
              <div className="saved-campaign-counts">{Object.entries(savedPreview.recipientCounts).map(([kind, count]) => <div key={kind}><small>{kind === 'CUSTOMER' ? 'Customers' : 'Staff'}</small><strong>{count}</strong></div>)}</div>
              <div className="saved-campaign-preview-label">CURRENTLY ELIGIBLE AUDIENCE</div>
              <div className="saved-campaign-counts saved-campaign-current-counts">{Object.entries(savedPreview.currentEligibleRecipientCounts).map(([kind, count]) => <div key={kind}><small>{kind === 'CUSTOMER' ? 'Customers' : 'Staff'}</small><strong>{count}</strong></div>)}{savedPreview.currentEligibleRecipientCount === 0 && <div><small>Eligible now</small><strong>0</strong></div>}</div>
              <div className="saved-campaign-content-preview"><div className="saved-campaign-preview-label">EXACT SAVED CONTENT</div><RichNotificationRenderer document={savedPreview.contentDocument} surface="admin" mode="mobile" /></div>
              {savedPreview.campaign.lastDispatchError && <div className="saved-campaign-error"><strong>Last dispatch issue</strong><span>{savedPreview.campaign.lastDispatchError}</span>{savedPreview.campaign.dispatchAttemptCount > 0 && <small>{savedPreview.campaign.dispatchAttemptCount} dispatch attempt(s)</small>}</div>}
              {confirmSendNow ? <div className="saved-campaign-confirm" role="alertdialog" aria-label="Confirm send now"><strong>Send this exact approved notification now?</strong><p>The saved content above will be dispatched to the currently eligible recipients. This cannot be recalled once it appears in their inbox.</p><div><button type="button" className="text-button" disabled={!!sendingNowPublicId} onClick={() => setConfirmSendNow(false)}>Go back</button><button type="button" className="showroom-send-confirm" disabled={!!sendingNowPublicId} onClick={() => void sendScheduledNow()}>{sendingNowPublicId ? 'Sending…' : 'Confirm send now'}</button></div></div> : <footer className="saved-campaign-actions">
                <button type="button" className="secondary-button" onClick={() => { setSavedPreview(null); setConfirmSendNow(false); }}>Close preview</button>
                {canSend && (savedPreview.campaign.status === 'SCHEDULED' || (savedPreview.campaign.status === 'FAILED' && !!savedPreview.campaign.lastDispatchError && !!savedPreview.campaign.scheduledAt)) &&
                  <button type="button" className="showroom-send-confirm" onClick={() => setConfirmSendNow(true)}>{savedPreview.campaign.status === 'FAILED' ? 'Retry failed dispatch' : 'Send now'} ↗</button>}
              </footer>}
            </section>
          </div>}
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
                <div className="studio-field"><label htmlFor="campaign-title">Campaign title</label><input id="campaign-title" required maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); invalidatePreview(); }} /></div>
                <div className="studio-field"><label htmlFor="campaign-summary">Inbox summary</label><input id="campaign-summary" required maxLength={300} value={summary} onChange={(event) => { setSummary(event.target.value); invalidatePreview(); }} /></div>
              </div>
            </section>

            <section className="studio-panel">
              <div className="studio-panel-heading"><div><span className="panel-step">02</span><div><h2>Audience & consent</h2><p>Eligible people are resolved by the server, not by browser-provided counts.</p></div></div><span className="studio-count">{recipientTotal.toLocaleString('en-IN')} potentially eligible</span></div>
              <div className="scope-choices">
                {([
                  ['CUSTOMER', 'Customers', 'Customer messages'],
                  ['STAFF', 'Staff', 'Internal updates'],
                  ['DEALERSHIP', 'Dealership-wide', 'Choose either or both groups'],
                ] as const).map(([value, label, help]) => <button type="button" key={value} disabled={sending} onClick={() => changeScope(value)} className={scope === value ? 'scope-choice active' : 'scope-choice'}><strong>{label}</strong><span>{help}</span></button>)}
              </div>
              {scope === 'DEALERSHIP' && <div className="recipient-type-choices">
                <label><input type="checkbox" checked={recipientTypes.includes('CUSTOMER')} disabled={sending || marketingOnly} onChange={() => toggleType('CUSTOMER')} /> Customers</label>
                <label><input type="checkbox" checked={recipientTypes.includes('STAFF')} disabled={sending || marketingOnly} onChange={() => toggleType('STAFF')} /> Staff</label>
              </div>}
              {scope !== 'STAFF' && <label className="consent-panel studio-consent"><span className="consent-check"><input type="checkbox" checked={marketingOnly} disabled={sending} onChange={(event) => {
                const enabled = event.target.checked;
                setMarketingOnly(enabled);
                setSelectedRecipients([]);
                setExcludedRecipients([]);
                invalidateRecipientSearch();
                if (enabled) {
                  setSearchKind('CUSTOMER');
                  if (scope === 'DEALERSHIP') setRecipientTypes(['CUSTOMER']);
                }
                invalidatePreview();
              }} /> Marketing campaign — include only customers with recorded marketing consent</span><p>Do not use the marketing audience for service or safety messages. Enabling this filter resets recipient choices and limits the audience to consented customers.</p></label>}
              <div className="audience-mode">
                <label>
                  <input type="radio" name="audience-mode" checked={selectionMode === 'ALL'} disabled={sending} onChange={() => { setSelectionMode('ALL'); setSelectedRecipients([]); invalidatePreview(); }} />
                  <span><strong>All eligible {audienceDescription.toLowerCase()}</strong><small>Everyone receives it unless you uncheck specific people below.</small></span>
                </label>
                <label>
                  <input type="radio" name="audience-mode" checked={selectionMode === 'SELECTED'} disabled={sending} onChange={() => { setSelectionMode('SELECTED'); setExcludedRecipients([]); invalidatePreview(); }} />
                  <span><strong>Choose recipients manually</strong><small>Only the people you check will receive it.</small></span>
                </label>
              </div>
              <div className="recipient-search-panel">
                <div className="recipient-picker-heading">
                  <div><strong>{selectionMode === 'SELECTED' ? 'Choose who will receive this' : 'Include or exclude specific people'}</strong><p>Search by name, mobile, email or customer code. Each result has its own checkbox.</p></div>
                  <span>{selectionMode === 'SELECTED' ? `${selectedRecipients.length} selected` : `${excludedRecipients.length} excluded`}</span>
                </div>
                <form className="recipient-search-form" onSubmit={searchRecipients}>
                  <div className="studio-field"><label htmlFor="recipient-search-kind">Search group</label><select id="recipient-search-kind" value={searchKind} disabled={sending || availableSearchKinds.length === 0} onChange={(event) => { setSearchKind(event.target.value as 'CUSTOMER' | 'STAFF'); invalidateRecipientSearch(); }}>{availableSearchKinds.map((kind) => <option key={kind} value={kind}>{kind === 'CUSTOMER' ? 'Customers' : 'Staff'}</option>)}</select></div>
                  <div className="studio-field recipient-search-input"><label htmlFor="recipient-search-query">Find a customer or staff member</label><input id="recipient-search-query" maxLength={100} disabled={sending} value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Name, mobile, email or code" /></div>
                  <button type="submit" className="secondary-button" disabled={searching || sending}>{searching ? 'Searching…' : 'Search people'}</button>
                </form>
                <p className="recipient-search-hint">Showing up to 50 matching people per search. Search again to find additional recipients.</p>
                {recipientResults.length > 0 && <div className="recipient-results">
                  <div className="recipient-results-heading">
                    <span>{recipientResults.length} matching {searchKind === 'CUSTOMER' ? 'customers' : 'staff members'}</span>
                    <div>
                      <button type="button" className="text-button" disabled={sending} onClick={() => setVisibleRecipientsIncluded(true)}>{selectionMode === 'SELECTED' ? 'Select all results' : 'Include all results'}</button>
                      <button type="button" className="text-button" disabled={sending} onClick={() => setVisibleRecipientsIncluded(false)}>{selectionMode === 'SELECTED' ? 'Deselect results' : 'Exclude all results'}</button>
                      <button type="button" className="text-button" disabled={sending} onClick={() => setRecipientResults([])}>Clear search</button>
                    </div>
                  </div>
                  {recipientResults.map((recipient) => {
                    const key = recipientKey(recipient);
                    const included = isRecipientIncluded(recipient);
                    return <label className={included ? 'recipient-option active' : 'recipient-option excluded'} key={key}>
                      <input aria-label={`${included ? 'Deselect' : 'Select'} ${recipient.recipientName}`} type="checkbox" checked={included} disabled={sending} onChange={() => toggleRecipient(recipient)} />
                      <span className="recipient-option-avatar">{recipient.recipientName.trim().slice(0, 1).toUpperCase()}</span>
                      <span className="recipient-option-main"><strong>{recipient.recipientName}</strong><small>{recipient.recipientKind === 'CUSTOMER' ? 'Customer' : 'Staff'} · {recipient.institutionCode}</small></span>
                      <span className="recipient-option-action">{included ? (selectionMode === 'SELECTED' ? 'Will receive' : 'Included') : (selectionMode === 'SELECTED' ? 'Not selected' : 'Excluded')}</span>
                    </label>;
                  })}
                </div>}
              </div>
              {(selectionMode === 'SELECTED' ? selectedRecipients : excludedRecipients).length > 0 && <div className="recipient-selection-review">
                <div className="recipient-selection-review-heading">
                  <div><strong>{selectionMode === 'SELECTED' ? 'Selected recipients' : 'Excluded recipients'}</strong><span>{selectionMode === 'SELECTED' ? 'Only these people will receive this notification.' : 'These people will not receive this notification.'}</span></div>
                  <button type="button" className="text-button" disabled={sending} onClick={clearRecipientChanges}>{selectionMode === 'SELECTED' ? 'Clear selection' : 'Remove all exclusions'}</button>
                </div>
                <div className="recipient-selection-review-list">
                  {(selectionMode === 'SELECTED' ? selectedRecipients : excludedRecipients).map((recipient) => (
                    <div className="recipient-selection-review-row" key={recipientKey(recipient)}>
                      <span className="recipient-option-avatar">{recipient.recipientName.trim().slice(0, 1).toUpperCase()}</span>
                      <span><strong>{recipient.recipientName}</strong><small>{recipient.recipientKind === 'CUSTOMER' ? 'Customer' : 'Staff'} · {recipient.institutionCode}</small></span>
                      <button type="button" className="text-button" disabled={sending} onClick={() => restoreRecipient(recipient)}>{selectionMode === 'SELECTED' ? 'Deselect' : 'Restore'}</button>
                    </div>
                  ))}
                </div>
              </div>}
              <div className="selection-summary">
                <span>{selectionMode === 'SELECTED' ? `${selectedRecipients.length} selected` : `${excludedRecipients.length} excluded`}</span>
                <span>{selectionMode === 'SELECTED' ? 'Only checked people are considered for delivery.' : 'Unchecked people are excluded from the server-resolved audience.'}</span>
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
              <div className="preview-panel-header"><div><span className="panel-step">04</span><div><h2>Preview</h2><p>Preview is not delivery.</p></div></div><button type="button" className="primary-button" onClick={() => void previewCampaign()} disabled={saving || previewing || !title.trim() || !summary.trim()}>{previewing ? 'Validating…' : 'Preview audience'}</button></div>
              <div className="preview-view-controls" role="group" aria-label="Choose notification preview format">
                {([
                  ['mobile', 'Mobile app'],
                  ['inbox', 'Desktop inbox'],
                  ['push', 'Push'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={previewMode === mode ? 'preview-view-button active' : 'preview-view-button'}
                    aria-pressed={previewMode === mode}
                    onClick={() => setPreviewMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="preview-summary"><span className="preview-summary-icon">◎</span><div><strong>{title || 'Your campaign title'}</strong><span>{summary || 'Your inbox summary'}</span><small>Draft · {document.blocks.length} content blocks</small></div></div>
              <div className="rich-preview-frame" data-preview-mode={previewMode}>
                <div className="preview-frame-heading">
                  <span>MESSAGE CONTENT</span>
                  <span>{previewMode === 'mobile' ? 'Mobile app' : previewMode === 'inbox' ? 'Desktop inbox' : 'Push notification'}</span>
                </div>
                <div className="preview-device-screen">
                  <RichNotificationRenderer document={document} surface="admin" mode={previewMode} />
                </div>
              </div>
            </section>
            {preview && <div className="preview-result" role="status">
                <div className="preview-result-top"><span className="preview-success-icon">✓</span><div><strong>Audience validated</strong><span>{preview.recipientCount.toLocaleString('en-IN')} recipients after exclusions</span></div></div>
                <div className="preview-counts">{Object.entries(preview.recipientCounts).map(([kind, count]) => <div key={kind}><span>{kind === 'CUSTOMER' ? 'Customers' : 'Staff'}</span><strong>{count.toLocaleString('en-IN')}</strong></div>)}</div>
                <p>{preview.message}</p>
                <div className="preview-expiry">Preview expires {humanDate(preview.expiresAt)}. If the audience or content changes, create a fresh preview.</div>
                <details className="preview-recipient-details"><summary>Review recipient sample ({Math.min(preview.recipients.length, 50)} shown)</summary>{preview.recipients.slice(0, 50).map((recipient) => <div className="preview-recipient" key={recipientKey(recipient)}><span>{recipient.recipientName}</span><small>{recipient.recipientKind}</small></div>)}</details>
                <div className={approvedCampaignPublicId === preview.campaignPublicId ? 'campaign-approval-banner approved' : 'campaign-approval-banner'}>
                  <div><strong>{approvedCampaignPublicId === preview.campaignPublicId ? '✓ Campaign approved' : 'Approval required'}</strong><span>{approvedCampaignPublicId === preview.campaignPublicId ? 'This preview is approved for sending or scheduling.' : 'An authorized approver must approve this exact preview before any delivery can be queued.'}</span></div>
                  {approvedCampaignPublicId !== preview.campaignPublicId && canApprove && <button type="button" className="primary-button" onClick={() => void approveCampaign()} disabled={saving || previewing || sending || preview.recipientCount === 0 || new Date(preview.expiresAt).getTime() <= Date.now()}>{saving ? 'Approving…' : 'Approve campaign'}</button>}
                  {approvedCampaignPublicId !== preview.campaignPublicId && !canApprove && <span className="approval-permission-note">Your role does not include approval.</span>}
                </div>
              </div>}
              <form className="send-panel send-panel-card" onSubmit={sendCampaign}>
                <h3>Send or schedule</h3>
                <p>The server must record approval of the same unexpired preview before sending or scheduling.</p>
                <label>Schedule for later <span className="optional-label">Optional</span><input type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} /></label>
                <label>Expiry time <span className="optional-label">Optional</span><input type="datetime-local" value={expiryValue} onChange={(event) => setExpiryValue(event.target.value)} /></label>
                <button type="submit" className="send-button" disabled={!canSend || sending || saving || previewing || !preview || approvedCampaignPublicId !== preview.campaignPublicId || preview.recipientCount === 0 || new Date(preview.expiresAt).getTime() <= Date.now()}>{sending ? 'Processing…' : scheduleValue ? 'Schedule campaign' : 'Send in-app notification'} <span>↗</span></button>
                <div className="send-channel-note">{!canSend && <><strong>Send permission required:</strong> Your role can prepare previews but cannot send or schedule notifications yet. </>}<strong>Current channel:</strong> durable in-app inbox only. Push/SMS/WhatsApp/email providers are not configured in this repository yet.</div>
              </form>
            <div className="studio-trust-note"><strong>Safe by default</strong><p>Audience eligibility is resolved on the server. Template versions are immutable. Campaign approval is audited, recipient changes invalidate approval, and sends use one-time preview proof and idempotency keys. Media must pass server validation.</p></div>
          </aside>
        </div>
      )}

      {showGraphics && <LogoGraphicsLab onUseAsset={addLogoAsset} onClose={() => setShowGraphics(false)} />}
      {showSocialArtwork && <SocialMediaArtworkStudio onClose={() => setShowSocialArtwork(false)} canManage={staff.permissions.includes('social_media.manage')} canPublish={staff.permissions.includes('social_media.publish')} canReadWhatsapp={staff.permissions.includes('social_media.whatsapp.read')} canManageWhatsapp={staff.permissions.includes('social_media.whatsapp.manage')} canSendWhatsapp={staff.permissions.includes('social_media.whatsapp.send')} />}
    </section>
  );
}
