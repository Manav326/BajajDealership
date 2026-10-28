import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { StaffSummary } from '../auth/StaffLogin';

type Appointment = {
  publicId: string; appointmentCode: string; customerPublicId: string; customerName: string; customerPhone: string | null;
  vehiclePublicId: string; modelName: string; variantName: string | null; colourName: string | null;
  chassisNumber: string; engineNumber: string; scheduledFor: string; slotMinutes: number; customerConcern: string;
  customerLanguage: string; source: string; status: string; statusReason: string | null; requestedByName: string | null;
  checkedInAt: string | null; createdAt: string; updatedAt: string;
};
type JobCard = {
  publicId: string; jobCardCode: string; appointmentPublicId: string | null; appointmentCode: string | null;
  customerPublicId: string; customerName: string; customerPhone: string | null; vehiclePublicId: string;
  modelName: string; variantName: string | null; colourName: string | null; chassisNumber: string; engineNumber: string;
  status: string; customerConcern: string; odometerKm: number | null; fuelLevelPercent: number | null;
  checkinNotes: string | null; checkedInAt: string; completedAt: string | null; deliveredAt: string | null;
  inspectionCount: number; pendingInspectionCount: number; createdAt: string; updatedAt: string;
};
type InspectionItem = {
  publicId: string; checklistCode: string; label: string; status: 'PENDING' | 'OK' | 'ATTENTION' | 'NOT_APPLICABLE';
  notes: string | null; checkedByName: string | null; checkedAt: string | null; updatedAt: string;
};
type EstimateLine = {
  lineNumber: number; lineType: 'PART' | 'LABOUR' | 'OTHER'; description: string;
  quantity: number; unitPrice: number; lineTotal: number;
  sourceReservationPublicId: string | null; sourceReservationCode: string | null;
  sourceQuantityReserved: number | null; sourceQuantityIssued: number | null;
  sourceQuantityReturned: number | null; sourceQuantityReleased: number | null;
  sourceUnitCostSnapshot: number | null; sourceSnapshotAt: string | null;
};
type PartReservationOption = {
  publicId: string; reservationCode: string; jobCardPublicId: string; jobCardCode: string;
  partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string;
  quantityReserved: number; quantityIssued: number; quantityReturned: number; quantityReleased: number;
  quantityRemainingToIssue: number; unitCostSnapshot: number; status: string;
  notes: string | null; reservedByName: string; createdAt: string; updatedAt: string;
};
type EstimateDecision = {
  decision: string; evidenceMethod: string; evidenceReference: string | null; note: string | null;
  recordedByName: string; recordedAt: string;
};
type Estimate = {
  publicId: string; jobCardPublicId: string; jobCardCode: string; revision: number; status: string;
  partsSubtotal: number; labourSubtotal: number; otherSubtotal: number; discountAmount: number;
  estimatedTotal: number; customerMessage: string | null; createdByName: string;
  submittedAt: string | null; decidedAt: string | null; createdAt: string;
  lines: EstimateLine[]; decisions: EstimateDecision[];
};
type InvoiceLine = {
  lineNumber: number; sourceEstimateLineNumber: number; lineType: string; description: string;
  quantity: number; unitPrice: number; lineTotal: number;
};
type PaymentAllocation = { invoicePublicId: string; invoiceNumber: string; jobCardCode: string; amount: number };
type Payment = {
  publicId: string; receiptNumber: string; paymentMethod: string; amount: number;
  paymentReference: string | null; note: string | null; status: 'RECORDED' | 'REVERSED';
  recordedByName: string; recordedAt: string; reversedByName: string | null; reversedAt: string | null;
  reversalReason: string | null; reversalReference: string | null; allocations: PaymentAllocation[];
};
type Invoice = {
  publicId: string; invoiceNumber: string; jobCardPublicId: string; jobCardCode: string;
  customerPublicId: string; customerName: string; customerPhone: string | null;
  vehiclePublicId: string; modelName: string; variantName: string | null; colourName: string | null;
  chassisNumber: string; engineNumber: string; estimateRevision: number; status: 'DRAFT' | 'ISSUED' | 'CANCELLED';
  partsSubtotal: number; labourSubtotal: number; otherSubtotal: number; discountAmount: number;
  invoiceTotal: number; paidAmount: number; balanceDue: number; customerMessage: string | null;
  createdByName: string; issuedByName: string | null; createdAt: string; issuedAt: string | null;
  lines: InvoiceLine[];
};
type EstimateLineDraft = { lineType: 'PART' | 'LABOUR' | 'OTHER'; description: string; quantity: string; unitPrice: string; reservationPublicId: string };
type QualityDraft = {
  brakesOk: boolean; lightsOk: boolean; hornOk: boolean; noVisibleLeaks: boolean;
  roadTestOk: boolean; toolsRemoved: boolean; customerConcernResolved: boolean; notes: string;
};
type CustomerOption = { publicId: string; fullName: string; phone: string | null; currentVehicleCount: number };
type VehicleOption = {
  publicId: string; modelName: string; variantName: string | null; colourName: string | null;
  chassisNumber: string; engineNumber: string; stockStatus: string;
};
type Assignment = {
  publicId: string; assignmentRole: string; staffPublicId: string; staffName: string;
  staffStatus: string; assignedAt: string; unassignedAt: string | null; note: string | null;
};
type StaffOption = { publicId: string; fullName: string; status: string; assignmentRole: string };
type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

const appointmentStatuses = ['REQUESTED', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED'];
const jobCardStatuses = ['OPEN', 'INSPECTING', 'ESTIMATE_PENDING', 'AWAITING_APPROVAL', 'APPROVED',
  'IN_PROGRESS', 'QUALITY_CHECK', 'READY_FOR_COLLECTION', 'INVOICED', 'DELIVERED', 'CANCELLED'];

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as T & { message?: string; detail?: string; error?: string };
  if (!response.ok) throw new Error(payload.message ?? payload.detail ?? payload.error ?? `Request failed (${response.status}).`);
  return payload as T;
}

function localInputTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formattedDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' :
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function prettyStatus(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function quantity(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function money(value: number | null | undefined) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function WorkshopWorkspace({ token, staff }: { token: string; staff: StaffSummary }) {
  const canReadAppointments = staff.permissions.includes('workshop.appointment.read');
  const canManageAppointments = staff.permissions.includes('workshop.appointment.manage');
  const canCheckIn = staff.permissions.includes('workshop.jobcard.checkin');
  const canManageInspection = staff.permissions.includes('workshop.manage');
  const canAssign = staff.permissions.includes('workshop.jobcard.assign');
  const canCreateEstimate = staff.permissions.includes('workshop.estimate.create');
  const canApproveEstimate = staff.permissions.includes('workshop.approve_estimate');
  const canStartWork = staff.permissions.includes('workshop.jobcard.work');
  const canQualityCheck = staff.permissions.includes('workshop.quality_check');
  const canReadParts = staff.permissions.includes('parts.read');
  const canReadInvoice = staff.permissions.includes('finance.read');
  const canIssueInvoice = staff.permissions.includes('finance.invoice');
  const canRecordPayment = staff.permissions.includes('finance.payment');
  const canReversePayment = staff.permissions.includes('finance.payment.reverse');
  const canDeliverVehicle = staff.permissions.includes('workshop.jobcard.deliver');

  const [activeTab, setActiveTab] = useState<'appointments' | 'jobCards'>('appointments');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentTotal, setAppointmentTotal] = useState(0);
  const [appointmentPage, setAppointmentPage] = useState(0);
  const [appointmentStatus, setAppointmentStatus] = useState('');
  const [appointmentQueryInput, setAppointmentQueryInput] = useState('');
  const [appointmentQuery, setAppointmentQuery] = useState('');
  const [loadingAppointments, setLoadingAppointments] = useState(true);

  const [jobCards, setJobCards] = useState<JobCard[]>([]);
  const [jobCardTotal, setJobCardTotal] = useState(0);
  const [jobCardPage, setJobCardPage] = useState(0);
  const [jobCardStatus, setJobCardStatus] = useState('');
  const [jobCardQueryInput, setJobCardQueryInput] = useState('');
  const [jobCardQuery, setJobCardQuery] = useState('');
  const [loadingJobCards, setLoadingJobCards] = useState(true);

  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [scheduledFor, setScheduledFor] = useState(() => localInputTime(new Date(Date.now() + 86_400_000)));
  const [slotMinutes, setSlotMinutes] = useState(60);
  const [concern, setConcern] = useState('');
  const [language, setLanguage] = useState<'hi' | 'en' | 'hinglish'>('hi');
  const [staffNotes, setStaffNotes] = useState('');
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCreateAppointment, setShowCreateAppointment] = useState(false);

  const [selectedAppointment, setSelectedAppointment] = useState('');
  const [cancelReasons, setCancelReasons] = useState<Record<string, string>>({});
  const [checkinDrafts, setCheckinDrafts] = useState<Record<string, { odometer: string; fuel: string; notes: string }>>({});
  const [busyId, setBusyId] = useState('');
  const [selectedJobCardId, setSelectedJobCardId] = useState('');
  const [selectedJobCard, setSelectedJobCard] = useState<JobCard | null>(null);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([]);
  const [inspectionDrafts, setInspectionDrafts] = useState<Record<string, { status: InspectionItem['status']; notes: string }>>({});
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [partReservations, setPartReservations] = useState<PartReservationOption[]>([]);
  const [estimateLines, setEstimateLines] = useState<EstimateLineDraft[]>([
    { lineType: 'PART', description: '', quantity: '1', unitPrice: '', reservationPublicId: '' },
  ]);
  const [estimateDiscount, setEstimateDiscount] = useState('0');
  const [estimateMessage, setEstimateMessage] = useState('');
  const [decisionValue, setDecisionValue] = useState<'APPROVED' | 'DECLINED' | 'REVISION_REQUESTED'>('APPROVED');
  const [evidenceMethod, setEvidenceMethod] = useState<'OTP' | 'SIGNED_FORM' | 'IN_PERSON' | 'PHONE_RECORD' | 'WRITTEN_MESSAGE'>('SIGNED_FORM');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [qualityDraft, setQualityDraft] = useState<QualityDraft>({
    brakesOk: false, lightsOk: false, hornOk: false, noVisibleLeaks: false,
    roadTestOk: false, toolsRemoved: false, customerConcernResolved: false, notes: '',
  });
  const [assignmentRole, setAssignmentRole] = useState<'TECHNICIAN' | 'SERVICE_ADVISOR' | 'QUALITY_INSPECTOR'>('TECHNICIAN');
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [staffSearchInput, setStaffSearchInput] = useState('');
  const [selectedStaff, setSelectedStaff] = useState('');
  const [assignmentNote, setAssignmentNote] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoicePayments, setInvoicePayments] = useState<Payment[]>([]);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER'>('UPI');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() =>
    globalThis.crypto?.randomUUID?.() ?? `qe-pay-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalReference, setReversalReference] = useState('');
  const [deliveredToName, setDeliveredToName] = useState('');
  const [deliveryAcknowledged, setDeliveryAcknowledged] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'IN_PERSON' | 'SIGNED_FORM' | 'OTP_REFERENCE' | 'WRITTEN_MESSAGE'>('IN_PERSON');
  const [deliveryReference, setDeliveryReference] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAppointments = useCallback(async () => {
    setLoadingAppointments(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(appointmentPage), pageSize: '25' });
      if (appointmentStatus) params.set('status', appointmentStatus);
      if (appointmentQuery) params.set('q', appointmentQuery);
      const result = await request<Page<Appointment>>(`/api/v1/admin/workshop/appointments?${params.toString()}`, token);
      setAppointments(result.items ?? []);
      setAppointmentTotal(result.total ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appointments could not be loaded.');
    } finally { setLoadingAppointments(false); }
  }, [token, appointmentPage, appointmentStatus, appointmentQuery]);

  const loadJobCards = useCallback(async () => {
    setLoadingJobCards(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(jobCardPage), pageSize: '25' });
      if (jobCardStatus) params.set('status', jobCardStatus);
      if (jobCardQuery) params.set('q', jobCardQuery);
      const result = await request<Page<JobCard>>(`/api/v1/admin/workshop/job-cards?${params.toString()}`, token);
      setJobCards(result.items ?? []);
      setJobCardTotal(result.total ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Job cards could not be loaded.');
    } finally { setLoadingJobCards(false); }
  }, [token, jobCardPage, jobCardStatus, jobCardQuery]);

  const loadCustomers = useCallback(async (query: string) => {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      const options = await request<CustomerOption[]>(
        `/api/v1/admin/workshop/customers${params.size ? `?${params.toString()}` : ''}`, token);
      setCustomers(options);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Customer options could not be loaded.');
    }
  }, [token]);

  useEffect(() => { void loadAppointments(); }, [loadAppointments]);
  useEffect(() => { void loadJobCards(); }, [loadJobCards]);
  useEffect(() => { void loadCustomers(''); }, [loadCustomers]);

  useEffect(() => {
    if (!selectedCustomer) {
      setVehicles([]);
      setSelectedVehicle('');
      return;
    }
    let cancelled = false;
    request<VehicleOption[]>(`/api/v1/admin/workshop/customers/${selectedCustomer}/vehicles`, token)
      .then((result) => {
        if (cancelled) return;
        setVehicles(result);
        setSelectedVehicle((current) => result.some((vehicle) => vehicle.publicId === current) ? current : '');
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Current vehicle ownership could not be verified.');
      });
    return () => { cancelled = true; };
  }, [token, selectedCustomer]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setMessage('');
    try {
      if (!selectedCustomer || !selectedVehicle) throw new Error('Select a customer and one of their currently linked vehicles.');
      const scheduledDate = new Date(scheduledFor);
      if (Number.isNaN(scheduledDate.getTime())) throw new Error('Choose a valid appointment date and time.');
      if (!concern.trim()) throw new Error('Describe the customer-reported concern.');
      const created = await request<Appointment>('/api/v1/admin/workshop/appointments', token, {
        method: 'POST',
        body: JSON.stringify({
          customerPublicId: selectedCustomer, vehiclePublicId: selectedVehicle,
          scheduledFor: scheduledDate.toISOString(), slotMinutes, customerConcern: concern.trim(),
          customerLanguage: language, source: 'STAFF', staffNotes: staffNotes.trim() || null,
        }),
      });
      setMessage(`Appointment ${created.appointmentCode} created in Requested status.`);
      setConcern(''); setStaffNotes(''); setShowCreateAppointment(false);
      setAppointmentStatus(''); setAppointmentQuery(''); setAppointmentQueryInput('');
      setAppointmentPage(0);
      await loadCustomers('');
      await loadAppointments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appointment could not be created.');
    } finally { setSaving(false); }
  }

  async function confirmAppointment(appointment: Appointment) {
    setBusyId(appointment.publicId); setError(''); setMessage('');
    try {
      const result = await request<Appointment>(`/api/v1/admin/workshop/appointments/${appointment.publicId}/confirm`, token, {
        method: 'POST', body: JSON.stringify({ note: 'Confirmation recorded by dealership staff.' }),
      });
      setMessage(`Appointment ${result.appointmentCode} confirmed.`);
      await loadAppointments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Appointment could not be confirmed.'); }
    finally { setBusyId(''); }
  }

  async function cancelAppointment(appointment: Appointment) {
    const reason = (cancelReasons[appointment.publicId] ?? '').trim();
    if (!reason) {
      setError('Enter a reason before cancelling an appointment.');
      return;
    }
    setBusyId(appointment.publicId); setError(''); setMessage('');
    try {
      await request<Appointment>(`/api/v1/admin/workshop/appointments/${appointment.publicId}/cancel`, token, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      setMessage(`Appointment ${appointment.appointmentCode} cancelled and audited.`);
      await loadAppointments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Appointment could not be cancelled.'); }
    finally { setBusyId(''); }
  }

  async function checkInAppointment(appointment: Appointment) {
    const draft = checkinDrafts[appointment.publicId] ?? { odometer: '', fuel: '', notes: '' };
    setBusyId(appointment.publicId); setError(''); setMessage('');
    try {
      const job = await request<JobCard>(`/api/v1/admin/workshop/appointments/${appointment.publicId}/check-in`, token, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: draft.odometer.trim() ? Number(draft.odometer) : null,
          fuelLevelPercent: draft.fuel.trim() ? Number(draft.fuel) : null,
          checkinNotes: draft.notes.trim() || null,
        }),
      });
      setMessage(`Checked in successfully. Job card ${job.jobCardCode} was created.`);
      setSelectedAppointment('');
      setSelectedJobCardId(job.publicId);
      setActiveTab('jobCards');
      await Promise.all([loadAppointments(), loadJobCards()]);
      await openJobCard(job.publicId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Vehicle could not be checked in.'); }
    finally { setBusyId(''); }
  }

  async function refreshBilling(jobCardPublicId: string) {
    const invoices = await request<Invoice[]>(
      `/api/v1/admin/workshop/job-cards/${jobCardPublicId}/invoices`, token);
    const chosen = invoices.find((item) => item.status === 'ISSUED')
      ?? invoices.find((item) => item.status === 'DRAFT');
    if (!chosen) {
      setInvoice(null);
      setInvoicePayments([]);
      return null;
    }
    const [current, payments] = await Promise.all([
      request<Invoice>(`/api/v1/admin/workshop/invoices/${chosen.publicId}`, token),
      chosen.status === 'ISSUED'
        ? request<Payment[]>(`/api/v1/admin/workshop/invoices/${chosen.publicId}/payments`, token)
        : Promise.resolve([] as Payment[]),
    ]);
    setInvoice(current);
    setInvoicePayments(payments);
    return current;
  }

  async function loadPartReservations(jobCardPublicId: string) {
    if (!canReadParts) {
      setPartReservations([]);
      return;
    }
    try {
      const result = await request<PartReservationOption[]>(
        `/api/v1/admin/job-cards/${jobCardPublicId}/part-reservations`, token);
      setPartReservations(result ?? []);
    } catch (cause) {
      setPartReservations([]);
      setError(cause instanceof Error ? cause.message : 'Part reservation snapshots could not be loaded.');
    }
  }

  async function openJobCard(publicId: string) {
    setSelectedJobCardId(publicId);
    setInvoice(null);
    setError('');
    try {
      const [card, items, currentAssignments, currentEstimates] = await Promise.all([
        request<JobCard>(`/api/v1/admin/workshop/job-cards/${publicId}`, token),
        request<InspectionItem[]>(`/api/v1/admin/workshop/job-cards/${publicId}/inspection`, token),
        request<Assignment[]>(`/api/v1/admin/workshop/job-cards/${publicId}/assignments`, token),
        request<Estimate[]>(`/api/v1/admin/workshop/job-cards/${publicId}/estimates`, token),
      ]);
      setSelectedJobCard(card);
      setInspectionItems(items);
      setInspectionDrafts(Object.fromEntries(items.map((item) => [item.publicId, { status: item.status, notes: item.notes ?? '' }])));
      setAssignments(currentAssignments);
      setEstimates(currentEstimates);
      await loadPartReservations(publicId);
      if (card.status === 'APPROVED' || card.status === 'IN_PROGRESS') {
        const activeEstimate = currentEstimates.find((estimate) => estimate.status === 'APPROVED');
        if (activeEstimate) {
          setEstimateLines(activeEstimate.lines.map((line) => ({
            lineType: line.lineType,
            description: line.description,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            reservationPublicId: line.sourceReservationPublicId ?? '',
          })));
          setEstimateDiscount(String(activeEstimate.discountAmount));
          setEstimateMessage(activeEstimate.customerMessage ?? '');
        } else {
          setEstimateLines([{ lineType: 'PART', description: '', quantity: '1', unitPrice: '', reservationPublicId: '' }]);
          setEstimateDiscount('0');
          setEstimateMessage('');
        }
      } else if (card.status === 'ESTIMATE_PENDING') {
        setEstimateLines([{ lineType: 'PART', description: '', quantity: '1', unitPrice: '', reservationPublicId: '' }]);
        setEstimateDiscount('0');
        setEstimateMessage('');
      }
      setQualityDraft({
        brakesOk: false, lightsOk: false, hornOk: false, noVisibleLeaks: false,
        roadTestOk: false, toolsRemoved: false, customerConcernResolved: false, notes: '',
      });
      if (card.customerName && !deliveredToName.trim()) setDeliveredToName(card.customerName);
      if (canReadInvoice && ['INVOICED', 'DELIVERED'].includes(card.status)) {
        setLoadingInvoice(true);
        try {
          await refreshBilling(publicId);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Invoice details could not be loaded.');
        } finally {
          setLoadingInvoice(false);
        }
      } else {
        setInvoice(null);
        setInvoicePayments([]);
        setLoadingInvoice(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Job card details could not be loaded.');
    }
  }

  async function saveInspection(item: InspectionItem) {
    const draft = inspectionDrafts[item.publicId] ?? { status: item.status, notes: item.notes ?? '' };
    setBusyId(item.publicId); setError(''); setMessage('');
    try {
      const updated = await request<InspectionItem>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCardId}/inspection/${item.publicId}`, token, {
          method: 'PUT', body: JSON.stringify({ status: draft.status, notes: draft.notes.trim() || null }),
        });
      setInspectionItems((current) => current.map((value) => value.publicId === updated.publicId ? updated : value));
      setInspectionDrafts((current) => ({ ...current, [updated.publicId]: { status: updated.status, notes: updated.notes ?? '' } }));
      setMessage(`Inspection item “${updated.label}” saved.`);
      if (selectedJobCardId) await openJobCard(selectedJobCardId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Inspection item could not be saved.'); }
    finally { setBusyId(''); }
  }

  async function completeInspection() {
    if (!selectedJobCard) return;
    setBusyId(selectedJobCard.publicId); setError(''); setMessage('');
    try {
      const updated = await request<JobCard>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/complete-inspection`, token, {
          method: 'POST', body: JSON.stringify({ note: 'Inspection checklist reviewed by dealership staff.' }),
        });
      setSelectedJobCard(updated);
      setMessage(`Inspection completed. ${updated.jobCardCode} is now awaiting an estimate.`);
      await loadJobCards();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Inspection could not be completed.'); }
    finally { setBusyId(''); }
  }

  function updateEstimateLine(index: number, key: keyof EstimateLineDraft, value: string) {
    setEstimateLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (key === 'lineType' && value !== 'PART') {
        return { ...line, lineType: value as EstimateLineDraft['lineType'], reservationPublicId: '' };
      }
      return { ...line, [key]: value };
    }));
  }

  function selectPartReservation(index: number, publicId: string) {
    const reservation = partReservations.find((item) => item.publicId === publicId);
    if (!reservation) {
      updateEstimateLine(index, 'reservationPublicId', '');
      return;
    }
    const estimatedQuantity = reservation.quantityReserved - reservation.quantityReturned - reservation.quantityReleased;
    setEstimateLines((current) => current.map((line, lineIndex) => lineIndex === index ? {
      ...line,
      lineType: 'PART',
      reservationPublicId: reservation.publicId,
      description: `${reservation.skuCode} — ${reservation.partName}`,
      quantity: estimatedQuantity.toFixed(3),
    } : line));
  }

  async function createEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobCard) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const validLines = estimateLines.filter((line) => line.description.trim() && line.unitPrice.trim());
      if (validLines.length === 0) throw new Error('Add at least one described line item with a unit price.');
      const body = {
        lines: validLines.map((line) => ({
          lineType: line.lineType,
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          reservationPublicId: line.reservationPublicId || null,
        })),
        discountAmount: Number(estimateDiscount || 0),
        customerMessage: estimateMessage.trim() || null,
      };
      const created = await request<Estimate>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/estimates`, token, {
          method: 'POST', body: JSON.stringify(body),
        });
      setEstimateLines([{ lineType: 'PART', description: '', quantity: '1', unitPrice: '', reservationPublicId: '' }]);
      setEstimateDiscount('0');
      setEstimateMessage('');
      setMessage(`Estimate revision ${created.revision} submitted and awaiting a recorded customer decision.`);
      await Promise.all([loadJobCards(), openJobCard(selectedJobCard.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Estimate could not be submitted.');
    } finally { setSaving(false); }
  }

  async function recordEstimateDecision(estimate: Estimate) {
    setBusyId(estimate.publicId); setError(''); setMessage('');
    try {
      const saved = await request<Estimate>(
        `/api/v1/admin/workshop/job-cards/${estimate.jobCardPublicId}/estimates/${estimate.publicId}/decision`, token, {
          method: 'POST',
          body: JSON.stringify({
            decision: decisionValue,
            evidenceMethod,
            evidenceReference: evidenceReference.trim() || null,
            note: evidenceNote.trim() || null,
          }),
        });
      setMessage(`Estimate revision ${saved.revision} decision ${prettyStatus(saved.decisions[0]?.decision ?? decisionValue)} recorded.`);
      setEvidenceReference(''); setEvidenceNote('');
      await Promise.all([loadJobCards(), openJobCard(estimate.jobCardPublicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Estimate decision could not be saved.');
    } finally { setBusyId(''); }
  }

  async function startApprovedWork() {
    if (!selectedJobCard) return;
    setBusyId(selectedJobCard.publicId); setError(''); setMessage('');
    try {
      const updated = await request<JobCard>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/start-work`, token, {
          method: 'POST', body: JSON.stringify({ note: 'Repair work started after checking estimate approval.' }),
        });
      setSelectedJobCard(updated);
      setMessage(`Work started for ${updated.jobCardCode}.`);
      await Promise.all([loadJobCards(), openJobCard(updated.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Work could not be started.');
    } finally { setBusyId(''); }
  }

  async function submitQualityCheck() {
    if (!selectedJobCard) return;
    setBusyId(selectedJobCard.publicId); setError(''); setMessage('');
    try {
      const updated = await request<JobCard>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/quality-check`, token, {
          method: 'POST', body: JSON.stringify({
            ...qualityDraft, notes: qualityDraft.notes.trim() || null,
          }),
        });
      setSelectedJobCard(updated);
      setMessage(updated.status === 'READY_FOR_COLLECTION'
        ? 'Quality check passed. The job is ready for collection, but final handover remains blocked until invoice/payment is recorded.'
        : 'Quality check failed. Corrective work is required before another quality check.');
      await Promise.all([loadJobCards(), openJobCard(updated.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Quality check could not be recorded.');
    } finally { setBusyId(''); }
  }

  async function issueInvoice() {
    if (!selectedJobCard) return;
    setBusyId(selectedJobCard.publicId); setError(''); setMessage('');
    try {
      const approvedEstimate = estimates.find((estimate) => estimate.status === 'APPROVED');
      const draft = await request<Invoice>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/invoices`, token, {
          method: 'POST',
          body: JSON.stringify({ customerMessage: approvedEstimate?.customerMessage ?? null }),
        });
      const issued = draft.status === 'DRAFT'
        ? await request<Invoice>(`/api/v1/admin/workshop/invoices/${draft.publicId}/issue`, token, { method: 'POST' })
        : draft;
      await refreshBilling(selectedJobCard.publicId);
      const updatedCard = await request<JobCard>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}`, token);
      setSelectedJobCard(updatedCard);
      setMessage(`Operational invoice ${issued.invoiceNumber} issued. It is not a GST tax invoice.`);
      await loadJobCards();
      if (!deliveredToName.trim()) setDeliveredToName(issued.customerName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invoice could not be issued.');
    } finally { setBusyId(''); }
  }

  async function recordInvoicePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice || !selectedJobCard) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive payment amount.');
      return;
    }
    if (['UPI', 'BANK_TRANSFER', 'CARD'].includes(paymentMethod) && !paymentReference.trim()) {
      setError('A payment reference is required for UPI, bank-transfer and card entries.');
      return;
    }
    setBusyId(invoice.publicId); setError(''); setMessage('');
    try {
      const payment = await request<Payment>(
        `/api/v1/admin/workshop/invoices/${invoice.publicId}/payments`, token, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: paymentIdempotencyKey,
            paymentMethod, amount,
            paymentReference: paymentReference.trim() || null,
            note: paymentNote.trim() || null,
          }),
        });
      const updatedInvoice = await request<Invoice>(`/api/v1/admin/workshop/invoices/${invoice.publicId}`, token);
      const payments = await request<Payment[]>(`/api/v1/admin/workshop/invoices/${invoice.publicId}/payments`, token);
      setInvoice(updatedInvoice);
      setInvoicePayments(payments);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNote('');
      setPaymentIdempotencyKey(globalThis.crypto?.randomUUID?.()
        ?? `qe-pay-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      setMessage(`Receipt ${payment.receiptNumber} recorded or recovered. Balance due: ₹${Number(updatedInvoice.balanceDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment could not be recorded.');
      // Keep the same idempotency key after an unknown-outcome failure so the retry cannot duplicate the receipt.
    } finally { setBusyId(''); }
  }

  async function reverseInvoicePayment(payment: Payment) {
    if (!invoice) return;
    const reason = reversalReason.trim();
    if (!reason) {
      setError('Enter a reason before reversing a payment.');
      return;
    }
    setBusyId(payment.publicId); setError(''); setMessage('');
    try {
      const reversed = await request<Payment>(
        `/api/v1/admin/workshop/payments/${payment.publicId}/reverse`, token, {
          method: 'POST',
          body: JSON.stringify({
            reason,
            externalReference: reversalReference.trim() || null,
          }),
        });
      const updatedInvoice = await request<Invoice>(`/api/v1/admin/workshop/invoices/${invoice.publicId}`, token);
      const payments = await request<Payment[]>(`/api/v1/admin/workshop/invoices/${invoice.publicId}/payments`, token);
      setInvoice(updatedInvoice);
      setInvoicePayments(payments);
      setReversalReason('');
      setReversalReference('');
      setMessage(`Receipt ${reversed.receiptNumber} is now ${reversed.status.toLowerCase()}. Reversal evidence remains in the ledger.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment reversal could not be recorded.');
    } finally { setBusyId(''); }
  }

  async function handoverVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobCard || !invoice) return;
    if (Number(invoice.balanceDue) !== 0) {
      setError('The invoice must be fully settled before handover.');
      return;
    }
    if (!deliveryAcknowledged) {
      setError('Record customer acknowledgement before completing handover.');
      return;
    }
    setBusyId(selectedJobCard.publicId); setError(''); setMessage('');
    try {
      await request<unknown>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/deliver`, token, {
          method: 'POST',
          body: JSON.stringify({
            deliveredToName: deliveredToName.trim(),
            customerAcknowledged: deliveryAcknowledged,
            acknowledgementMethod: deliveryMethod,
            acknowledgementReference: deliveryReference.trim() || null,
            note: deliveryNote.trim() || null,
          }),
        });
      const delivered = await request<JobCard>(
        `/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}`, token);
      setSelectedJobCard(delivered);
      await refreshBilling(selectedJobCard.publicId);
      setMessage(`Vehicle handed over and acknowledgement recorded for ${delivered.jobCardCode}.`);
      await loadJobCards();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vehicle handover could not be completed.');
    } finally { setBusyId(''); }
  }

  async function loadAssignableStaff() {
    try {
      const params = new URLSearchParams({ assignmentRole });
      if (staffSearchInput.trim()) params.set('q', staffSearchInput.trim());
      const result = await request<StaffOption[]>(`/api/v1/admin/workshop/staff-options?${params.toString()}`, token);
      setStaffOptions(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Assignable staff could not be loaded.'); }
  }

  async function assignStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJobCard || !selectedStaff) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await request<Assignment>(`/api/v1/admin/workshop/job-cards/${selectedJobCard.publicId}/assignment`, token, {
        method: 'PUT',
        body: JSON.stringify({ staffPublicId: selectedStaff, assignmentRole, note: assignmentNote.trim() || null }),
      });
      setSelectedStaff(''); setAssignmentNote('');
      setMessage(`${prettyStatus(assignmentRole)} assignment saved.`);
      await openJobCard(selectedJobCard.publicId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff could not be assigned.'); }
    finally { setSaving(false); }
  }

  function searchAppointments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppointmentPage(0); setAppointmentQuery(appointmentQueryInput.trim());
  }

  function searchJobCards(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJobCardPage(0); setJobCardQuery(jobCardQueryInput.trim());
  }

  function searchCustomers() {
    const query = customerSearchInput.trim();
    setCustomerSearch(query);
    void loadCustomers(query);
  }

  const estimateSubtotalPreview = estimateLines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    return sum + (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? Math.max(0, quantity) * Math.max(0, unitPrice) : 0);
  }, 0);
  const hasActiveTechnician = assignments.some((assignment) =>
    assignment.assignmentRole === 'TECHNICIAN' && assignment.unassignedAt === null);
  const isAssignedQualityInspector = assignments.some((assignment) =>
    assignment.assignmentRole === 'QUALITY_INSPECTOR'
      && assignment.staffPublicId === staff.staffPublicId
      && assignment.unassignedAt === null);

  if (!staff.permissions.includes('workshop.read') && !canReadAppointments) {
    return <section className="module-landing"><div className="module-symbol">⚙</div><div className="eyebrow">ACCESS CONTROL</div><h1>Workshop</h1><p>Your assigned role does not include access to service appointments or job cards.</p></section>;
  }

  return (
    <section className="workshop-workspace">
      <div className="workshop-heading">
        <div><div className="eyebrow">SERVICE CENTRE OPERATIONS</div><h1>Workshop</h1><p>Appointment intake, checked-in bikes and traceable inspection work.</p></div>
        {canManageAppointments && activeTab === 'appointments' && <button className="primary-button" type="button" onClick={() => setShowCreateAppointment((value) => !value)}>{showCreateAppointment ? 'Close form' : '+ New appointment'}</button>}
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {message && <div className="notice notice-success" role="status">{message}</div>}

      <div className="workshop-tabs" role="tablist" aria-label="Workshop views">
        <button type="button" className={activeTab === 'appointments' ? 'workshop-tab active' : 'workshop-tab'} onClick={() => setActiveTab('appointments')}>Appointments <span>{appointmentTotal}</span></button>
        <button type="button" className={activeTab === 'jobCards' ? 'workshop-tab active' : 'workshop-tab'} onClick={() => setActiveTab('jobCards')}>Job cards <span>{jobCardTotal}</span></button>
      </div>

      {activeTab === 'appointments' ? (
        <>
          {showCreateAppointment && canManageAppointments && <form className="customer-form-card workshop-create-form" onSubmit={createAppointment}>
            <div className="form-card-heading"><div><h2>New service appointment</h2><p>Only the customer's currently linked vehicle can be booked for this dealership.</p></div><span className="form-step">WORKSHOP INTAKE</span></div>
            <div className="customer-form-grid">
              <label className="field-span-two">Customer *
                <div className="workshop-customer-search">
                  <input aria-label="Search customers for appointment" maxLength={100} value={customerSearchInput}
                    onChange={(event) => setCustomerSearchInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchCustomers(); } }}
                    placeholder="Search name, phone or customer code" />
                  <button className="secondary-button" type="button" onClick={searchCustomers}>Find customer</button>
                  {customerSearch && <button className="text-button" type="button" onClick={() => { setCustomerSearchInput(''); setCustomerSearch(''); void loadCustomers(''); }}>Clear</button>}
                </div>
                <span className="workshop-field-hint">{customerSearch ? `Search results for “${customerSearch}”.` : 'Choose from active customers with a currently linked vehicle.'}</span>
                <select required value={selectedCustomer} onChange={(event) => { setSelectedCustomer(event.target.value); setSelectedVehicle(''); }}>
                  <option value="">Choose a customer…</option>
                  {customers.map((customer) => <option key={customer.publicId} value={customer.publicId}>{customer.fullName}{customer.phone ? ` · ${customer.phone}` : ''} · ${customer.currentVehicleCount} linked bike(s)</option>)}
                </select>
              </label>
              <label className="field-span-two">Currently owned vehicle *
                <select required value={selectedVehicle} onChange={(event) => setSelectedVehicle(event.target.value)} disabled={!selectedCustomer || vehicles.length === 0}>
                  <option value="">Choose a linked bike…</option>
                  {vehicles.map((vehicle) => <option key={vehicle.publicId} value={vehicle.publicId}>{vehicle.modelName}{vehicle.variantName ? ` · ${vehicle.variantName}` : ''}{vehicle.colourName ? ` · ${vehicle.colourName}` : ''} · Chassis {vehicle.chassisNumber}</option>)}
                </select>
                {selectedCustomer && vehicles.length === 0 && <span className="workshop-field-hint">No currently owned vehicle is linked to this customer.</span>}
              </label>
              <label>Appointment date and time *
                <input type="datetime-local" required value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
              </label>
              <label>Slot duration
                <select value={slotMinutes} onChange={(event) => setSlotMinutes(Number(event.target.value))}><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>90 minutes</option><option value={120}>2 hours</option></select>
              </label>
              <label>Preferred language
                <select value={language} onChange={(event) => setLanguage(event.target.value as 'hi' | 'en' | 'hinglish')}><option value="hi">हिन्दी</option><option value="en">English</option><option value="hinglish">Hinglish</option></select>
              </label>
              <label className="field-span-two">Customer-reported concern *
                <textarea required rows={3} maxLength={3000} value={concern} onChange={(event) => setConcern(event.target.value)} placeholder="Describe what the customer says needs attention." />
              </label>
              <label className="field-span-two">Internal staff note <span className="optional-label">Optional</span>
                <textarea rows={2} maxLength={3000} value={staffNotes} onChange={(event) => setStaffNotes(event.target.value)} placeholder="Internal context for the service advisor" />
              </label>
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowCreateAppointment(false)}>Cancel</button><button type="submit" className="primary-button" disabled={saving || customers.length === 0}>{saving ? 'Saving…' : 'Create appointment'}</button></div>
          </form>}

          <div className="workshop-queue-card">
            <div className="workshop-list-toolbar">
              <div><h2>Appointment queue</h2><p>One source of truth for requested, confirmed, cancelled and checked-in visits.</p></div>
              <form className="search-form" onSubmit={searchAppointments}>
                <input value={appointmentQueryInput} onChange={(event) => setAppointmentQueryInput(event.target.value)} placeholder="Customer, code or chassis" aria-label="Search appointments" maxLength={100} />
                <button type="submit" className="secondary-button">Search</button>
              </form>
            </div>
            <div className="workshop-filter-row">
              <label>Status <select value={appointmentStatus} onChange={(event) => { setAppointmentPage(0); setAppointmentStatus(event.target.value); }}><option value="">All appointment statuses</option>{appointmentStatuses.map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}</select></label>
              <button type="button" className="text-button" onClick={() => { setAppointmentStatus(''); setAppointmentQuery(''); setAppointmentQueryInput(''); setAppointmentPage(0); }}>Clear filters</button>
            </div>
            <div className="workshop-list">
              {loadingAppointments ? <div className="studio-empty">Loading appointments…</div>
                : appointments.length === 0 ? <div className="studio-empty">No appointments match the current filters.</div>
                : appointments.map((appointment) => <article className="appointment-row" key={appointment.publicId}>
                  <div className="appointment-calendar"><strong>{new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(new Date(appointment.scheduledFor))}</strong><span>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(appointment.scheduledFor))}</span></div>
                  <div className="appointment-info"><div className="appointment-title"><strong>{appointment.customerName}</strong><span className={`status-chip status-${appointment.status.toLowerCase()}`}>{prettyStatus(appointment.status)}</span></div>
                    <p>{appointment.modelName}{appointment.variantName ? ` · ${appointment.variantName}` : ''} · {appointment.appointmentCode}</p>
                    <p>{appointment.customerConcern}</p><div className="appointment-meta"><span>{formattedDate(appointment.scheduledFor)}</span><span>{appointment.slotMinutes} min</span><span>{appointment.customerPhone || 'No phone recorded'}</span></div>
                    {appointment.statusReason && <div className="appointment-reason">Note: {appointment.statusReason}</div>}
                    {selectedAppointment === appointment.publicId && appointment.status !== 'CHECKED_IN' && canCheckIn && ['REQUESTED','CONFIRMED'].includes(appointment.status) && <div className="checkin-inline">
                      <label>Odometer (km)<input type="number" min={0} value={checkinDrafts[appointment.publicId]?.odometer ?? ''} onChange={(event) => setCheckinDrafts((current) => ({ ...current, [appointment.publicId]: { ...(current[appointment.publicId] ?? {odometer:'',fuel:'',notes:''}), odometer: event.target.value } }))} /></label>
                      <label>Fuel level (%)<input type="number" min={0} max={100} value={checkinDrafts[appointment.publicId]?.fuel ?? ''} onChange={(event) => setCheckinDrafts((current) => ({ ...current, [appointment.publicId]: { ...(current[appointment.publicId] ?? {odometer:'',fuel:'',notes:''}), fuel: event.target.value } }))} /></label>
                      <label className="checkin-notes">Check-in note<input maxLength={3000} value={checkinDrafts[appointment.publicId]?.notes ?? ''} onChange={(event) => setCheckinDrafts((current) => ({ ...current, [appointment.publicId]: { ...(current[appointment.publicId] ?? {odometer:'',fuel:'',notes:''}), notes: event.target.value } }))} placeholder="Condition and items received" /></label>
                    </div>}
                    {selectedAppointment === appointment.publicId && ['REQUESTED','CONFIRMED'].includes(appointment.status) && canManageAppointments && <label className="cancel-reason-input">Cancellation reason<input maxLength={500} value={cancelReasons[appointment.publicId] ?? ''} onChange={(event) => setCancelReasons((current) => ({ ...current, [appointment.publicId]: event.target.value }))} placeholder="Required if cancelling this appointment" /></label>}
                  </div>
                  <div className="appointment-actions">
                    <span className="appointment-created">Added {formattedDate(appointment.createdAt)}</span>
                    {canManageAppointments && appointment.status === 'REQUESTED' && <button type="button" className="subtle-action" disabled={busyId === appointment.publicId} onClick={() => void confirmAppointment(appointment)}>Confirm</button>}
                    {canCheckIn && ['REQUESTED','CONFIRMED'].includes(appointment.status) && <button type="button" className="subtle-action receive-action-button" onClick={() => setSelectedAppointment((current) => current === appointment.publicId ? '' : appointment.publicId)}>{selectedAppointment === appointment.publicId ? 'Close check-in' : 'Check in bike'}</button>}
                    {canManageAppointments && ['REQUESTED','CONFIRMED'].includes(appointment.status) && <button type="button" className="text-button danger-link" disabled={busyId === appointment.publicId || !(cancelReasons[appointment.publicId] ?? '').trim()} onClick={() => void cancelAppointment(appointment)}>Cancel</button>}
                    {appointment.status === 'CHECKED_IN' && <button type="button" className="subtle-action" onClick={() => { setActiveTab('jobCards'); }}>View job cards</button>}
                    {selectedAppointment === appointment.publicId && canCheckIn && ['REQUESTED','CONFIRMED'].includes(appointment.status) && <button type="button" className="primary-button" disabled={busyId === appointment.publicId} onClick={() => void checkInAppointment(appointment)}>{busyId === appointment.publicId ? 'Checking in…' : 'Create job card'}</button>}
                  </div>
                </article>)}
            </div>
            <div className="workshop-pagination"><span>{appointmentTotal ? `Showing ${appointmentPage * 25 + 1}–${Math.min((appointmentPage + 1) * 25, appointmentTotal)} of ${appointmentTotal}` : 'No records'}</span><div><button type="button" disabled={appointmentPage <= 0 || loadingAppointments} onClick={() => setAppointmentPage((page) => page - 1)}>← Previous</button><span>Page {appointmentPage + 1}</span><button type="button" disabled={(appointmentPage + 1) * 25 >= appointmentTotal || loadingAppointments} onClick={() => setAppointmentPage((page) => page + 1)}>Next →</button></div></div>
          </div>
        </>
      ) : (
        <div className="workshop-job-card-area">
          <div className="workshop-queue-card">
            <div className="workshop-list-toolbar">
              <div><h2>Workshop job cards</h2><p>Each job card is created once at check-in and tracks inspection progress.</p></div>
              <form className="search-form" onSubmit={searchJobCards}><input value={jobCardQueryInput} onChange={(event) => setJobCardQueryInput(event.target.value)} placeholder="Job code, customer or chassis" aria-label="Search job cards" maxLength={100} /><button type="submit" className="secondary-button">Search</button></form>
            </div>
            <div className="workshop-filter-row"><label>Status <select value={jobCardStatus} onChange={(event) => { setJobCardPage(0); setJobCardStatus(event.target.value); }}><option value="">All job-card statuses</option>{jobCardStatuses.map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}</select></label><button type="button" className="text-button" onClick={() => { setJobCardStatus(''); setJobCardQuery(''); setJobCardQueryInput(''); setJobCardPage(0); }}>Clear filters</button></div>
            <div className="workshop-list">
              {loadingJobCards ? <div className="studio-empty">Loading job cards…</div>
                : jobCards.length === 0 ? <div className="studio-empty">No workshop job cards found. Check a vehicle in from the Appointments tab to start one.</div>
                : jobCards.map((job) => <button type="button" className={selectedJobCardId === job.publicId ? 'job-card-list-row active' : 'job-card-list-row'} key={job.publicId} onClick={() => void openJobCard(job.publicId)}>
                  <span className="job-card-list-icon">JC</span><span className="job-card-list-main"><strong>{job.jobCardCode} · {job.customerName}</strong><span>{job.modelName}{job.variantName ? ` · ${job.variantName}` : ''} · {job.chassisNumber}</span><small>{formattedDate(job.checkedInAt)} · {job.pendingInspectionCount} inspection item(s) pending</small></span><span className={`status-chip status-${job.status.toLowerCase()}`}>{prettyStatus(job.status)}</span>
                </button>)}
            </div>
            <div className="workshop-pagination"><span>{jobCardTotal ? `Showing ${jobCardPage * 25 + 1}–${Math.min((jobCardPage + 1) * 25, jobCardTotal)} of ${jobCardTotal}` : 'No records'}</span><div><button type="button" disabled={jobCardPage <= 0 || loadingJobCards} onClick={() => setJobCardPage((page) => page - 1)}>← Previous</button><span>Page {jobCardPage + 1}</span><button type="button" disabled={(jobCardPage + 1) * 25 >= jobCardTotal || loadingJobCards} onClick={() => setJobCardPage((page) => page + 1)}>Next →</button></div></div>
          </div>

          {selectedJobCard && <section className="workshop-job-detail surface-card">
            <div className="job-detail-heading"><div><div className="eyebrow">JOB CARD DETAILS</div><h2>{selectedJobCard.jobCardCode}</h2><p>{selectedJobCard.customerName} · {selectedJobCard.modelName}{selectedJobCard.variantName ? ` · ${selectedJobCard.variantName}` : ''}</p></div><span className={`status-chip status-${selectedJobCard.status.toLowerCase()}`}>{prettyStatus(selectedJobCard.status)}</span></div>
            <div className="job-detail-summary"><div><span>Chassis number</span><strong>{selectedJobCard.chassisNumber}</strong></div><div><span>Engine number</span><strong>{selectedJobCard.engineNumber}</strong></div><div><span>Odometer</span><strong>{selectedJobCard.odometerKm === null ? 'Not recorded' : `${selectedJobCard.odometerKm.toLocaleString('en-IN')} km`}</strong></div><div><span>Check-in</span><strong>{formattedDate(selectedJobCard.checkedInAt)}</strong></div></div>
            <div className="job-detail-concern"><strong>Customer concern</strong><p>{selectedJobCard.customerConcern}</p>{selectedJobCard.checkinNotes && <small>Check-in note: {selectedJobCard.checkinNotes}</small>}</div>

            <div className="inspection-heading"><div><h3>Inspection checklist</h3><p>{selectedJobCard.pendingInspectionCount} of {selectedJobCard.inspectionCount} items pending</p></div><span className="studio-count">Checklist · step 1</span></div>
            {inspectionItems.map((item) => {
              const draft = inspectionDrafts[item.publicId] ?? { status: item.status, notes: item.notes ?? '' };
              return <div className="inspection-item-row" key={item.publicId}>
                <div className="inspection-item-copy"><strong>{item.label}</strong><small>{item.checkedByName ? `Updated by ${item.checkedByName}` : 'Not checked yet'}</small></div>
                <select aria-label={`Result for ${item.label}`} disabled={!canManageInspection || selectedJobCard.status !== 'INSPECTING'} value={draft.status} onChange={(event) => setInspectionDrafts((current) => ({ ...current, [item.publicId]: { ...draft, status: event.target.value as InspectionItem['status'] } }))}>
                  <option value="PENDING">Pending</option><option value="OK">OK</option><option value="ATTENTION">Needs attention</option><option value="NOT_APPLICABLE">N/A</option>
                </select>
                <input aria-label={`Notes for ${item.label}`} disabled={!canManageInspection || selectedJobCard.status !== 'INSPECTING'} maxLength={1000} value={draft.notes} placeholder="Inspection notes" onChange={(event) => setInspectionDrafts((current) => ({ ...current, [item.publicId]: { ...draft, notes: event.target.value } }))} />
                {canManageInspection && selectedJobCard.status === 'INSPECTING' && <button type="button" className="subtle-action" disabled={busyId === item.publicId} onClick={() => void saveInspection(item)}>{busyId === item.publicId ? 'Saving…' : 'Save'}</button>}
              </div>;
            })}
            {canManageInspection && selectedJobCard.status === 'INSPECTING' && <div className="inspection-complete-row"><span>All seven checklist items must have a result before the estimate step can begin.</span><button type="button" className="primary-button" disabled={busyId === selectedJobCard.publicId || selectedJobCard.pendingInspectionCount > 0} onClick={() => void completeInspection()}>{busyId === selectedJobCard.publicId ? 'Completing…' : 'Complete inspection'}</button></div>}
            {['ESTIMATE_PENDING', 'APPROVED', 'IN_PROGRESS'].includes(selectedJobCard.status) && canCreateEstimate && <section className="estimate-create-section">
              <div className="inspection-heading"><div><h3>{selectedJobCard.status === 'ESTIMATE_PENDING' ? 'Create service estimate' : 'Create estimate revision'}</h3><p>{selectedJobCard.status === 'ESTIMATE_PENDING'
                ? 'Submit the initial estimate after inspection.'
                : 'Submitting a revision pauses the job until the customer decision is recorded. Existing approved revisions remain in history.'}</p></div><span className="studio-count">Revision {estimates.length + 1}</span></div>
              <form className="estimate-form" onSubmit={createEstimate}>
                {estimateLines.map((line, index) => <div className="estimate-line-edit-row" key={index}>
                  <label>Type<select value={line.lineType} onChange={(event) => updateEstimateLine(index, 'lineType', event.target.value as EstimateLineDraft['lineType'])}><option value="PART">Part</option><option value="LABOUR">Labour</option><option value="OTHER">Other</option></select></label>
                  {canReadParts && line.lineType === 'PART' && <label className="estimate-description">Link job-card reservation
                    <select value={line.reservationPublicId} onChange={(event) => selectPartReservation(index, event.target.value)}>
                      <option value="">Manual part line (no stock link)</option>
                      {partReservations.filter((reservation) =>
                        reservation.quantityReserved - reservation.quantityReturned - reservation.quantityReleased > 0
                        && reservation.status !== 'CANCELLED').map((reservation) =>
                        <option key={reservation.publicId} value={reservation.publicId}>
                          {reservation.reservationCode} · {reservation.skuCode} · qty {quantity(
                            reservation.quantityReserved - reservation.quantityReturned - reservation.quantityReleased)} · cost snapshot {money(reservation.unitCostSnapshot)}
                        </option>)}
                    </select>
                  </label>}
                  <label className="estimate-description">Description<input required maxLength={300} value={line.description} onChange={(event) => updateEstimateLine(index, 'description', event.target.value)} placeholder="Part / labour / charge" /></label>
                  <label>Qty<input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateEstimateLine(index, 'quantity', event.target.value)} /></label>
                  <label>Customer unit price (₹)<input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateEstimateLine(index, 'unitPrice', event.target.value)} placeholder="0.00" /></label>
                  {line.reservationPublicId && <p className="estimate-part-cost-note">Internal snapshot only: {partReservations.find((item) => item.publicId === line.reservationPublicId)?.quantityIssued ?? 0} issued, {partReservations.find((item) => item.publicId === line.reservationPublicId)?.quantityReturned ?? 0} returned, {partReservations.find((item) => item.publicId === line.reservationPublicId)?.quantityReleased ?? 0} released. The snapshot cost is not the customer selling price.</p>}
                  {estimateLines.length > 1 && <button type="button" className="text-button danger-link" onClick={() => setEstimateLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>Remove</button>}
                </div>)}
                <button type="button" className="secondary-button estimate-add-line" disabled={estimateLines.length >= 100}
                  onClick={() => setEstimateLines((current) => [...current, { lineType: 'PART', description: '', quantity: '1', unitPrice: '', reservationPublicId: '' }])}>+ Add line item</button>
                <div className="estimate-footer-fields">
                  <label>Discount (₹)<input type="number" min="0" step="0.01" value={estimateDiscount} onChange={(event) => setEstimateDiscount(event.target.value)} /></label>
                  <label>Message to customer<textarea rows={2} maxLength={2000} value={estimateMessage} onChange={(event) => setEstimateMessage(event.target.value)} placeholder="Clarify what the estimate includes." /></label>
                  <div className="estimate-total-preview"><span>Estimated subtotal before discount</span><strong>₹{estimateSubtotalPreview.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                </div>
                <div className="estimate-submit-row"><span>Prices are set by dealership staff. This workflow does not add GST/tax. Linked reservation quantities/cost are snapshotted into this revision.</span><button className="primary-button" type="submit" disabled={saving || estimateLines.every((line) => !line.description.trim() || !line.unitPrice.trim())}>{saving ? 'Submitting…' : 'Submit estimate revision for decision'}</button></div>
              </form>
            </section>}
            {selectedJobCard.status === 'ESTIMATE_PENDING' && !canCreateEstimate && <div className="workshop-next-stage">Inspection completed. This role can view the job card but cannot create an estimate.</div>}

            {estimates.length > 0 && <section className="estimate-history-section">
              <div className="inspection-heading"><div><h3>Estimate history</h3><p>Revisions and recorded decisions remain available for audit.</p></div><span className="studio-count">{estimates.length} revision(s)</span></div>
              {estimates.map((estimate) => <article className="estimate-history-card" key={estimate.publicId}>
                <div className="estimate-history-heading"><div><strong>Revision {estimate.revision}</strong><span>Submitted by {estimate.createdByName} · {formattedDate(estimate.submittedAt)}</span></div><div className="estimate-history-total"><span className={`campaign-status status-${estimate.status.toLowerCase()}`}>{prettyStatus(estimate.status)}</span><strong>₹{Number(estimate.estimatedTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div></div>
                <div className="estimate-line-table">
                  {estimate.lines.map((line) => <div className="estimate-line-history-row" key={line.lineNumber}><span>{line.lineNumber}. {line.description}<small>{prettyStatus(line.lineType)} · {line.quantity} × ₹{Number(line.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>{line.sourceReservationPublicId && <small>Reservation {line.sourceReservationCode} · frozen quantity snapshot: {quantity(line.sourceQuantityReserved)} reserved, {quantity(line.sourceQuantityIssued)} issued, {quantity(line.sourceQuantityReturned)} returned, {quantity(line.sourceQuantityReleased)} released · stock cost snapshot {money(line.sourceUnitCostSnapshot)} at {formattedDate(line.sourceSnapshotAt)}</small>}</span><strong>₹{Number(line.lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>)}
                </div>
                <div className="estimate-breakdown"><span>Parts ₹{Number(estimate.partsSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>Labour ₹{Number(estimate.labourSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>Other ₹{Number(estimate.otherSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span>Discount ₹{Number(estimate.discountAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                {estimate.customerMessage && <p className="estimate-customer-message">{estimate.customerMessage}</p>}
                {estimate.decisions.map((decision, index) => <div className="estimate-decision-history" key={`${decision.recordedAt}-${index}`}><strong>{prettyStatus(decision.decision)}</strong><span>{decision.evidenceMethod}{decision.evidenceReference ? ` · ${decision.evidenceReference}` : ''}</span><small>Recorded by {decision.recordedByName} · {formattedDate(decision.recordedAt)}{decision.note ? ` · ${decision.note}` : ''}</small></div>)}
                {estimate.status === 'AWAITING_CUSTOMER' && canApproveEstimate && <div className="estimate-decision-panel">
                  <div className="inspection-heading"><div><h3>Record customer decision</h3><p>This records evidence provided by dealership staff; it does not independently verify an external OTP.</p></div></div>
                  <div className="estimate-decision-fields">
                    <label>Decision<select value={decisionValue} onChange={(event) => setDecisionValue(event.target.value as typeof decisionValue)}><option value="APPROVED">Approved</option><option value="DECLINED">Declined</option><option value="REVISION_REQUESTED">Revision requested</option></select></label>
                    <label>Evidence method<select value={evidenceMethod} onChange={(event) => setEvidenceMethod(event.target.value as typeof evidenceMethod)}><option value="SIGNED_FORM">Signed form</option><option value="OTP">OTP reference</option><option value="IN_PERSON">In person</option><option value="PHONE_RECORD">Phone record</option><option value="WRITTEN_MESSAGE">Written message</option></select></label>
                    <label>Evidence reference<input maxLength={160} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder={evidenceMethod === 'OTP' || evidenceMethod === 'SIGNED_FORM' ? 'Required reference' : 'Optional reference'} /></label>
                    <label>Decision note<input maxLength={1000} value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} placeholder="Decision notes or customer context" /></label>
                  </div>
                  <button type="button" className="primary-button" disabled={busyId === estimate.publicId} onClick={() => void recordEstimateDecision(estimate)}>{busyId === estimate.publicId ? 'Recording…' : 'Record customer decision'}</button>
                </div>}
              </article>)}
            </section>}

            {selectedJobCard.status === 'APPROVED' && canStartWork && <div className="workshop-next-stage workshop-stage-action">
              <div><strong>Estimate approved</strong><span>{hasActiveTechnician ? 'A technician is assigned. Work may now begin.' : 'Assign a technician before starting work.'}</span></div>
              <button className="primary-button" type="button" disabled={!hasActiveTechnician || busyId === selectedJobCard.publicId} onClick={() => void startApprovedWork()}>{busyId === selectedJobCard.publicId ? 'Starting…' : 'Start repair work'}</button>
            </div>}

            {selectedJobCard.status === 'IN_PROGRESS' && canQualityCheck && <section className="quality-check-section">
              <div className="inspection-heading"><div><h3>Final quality check</h3><p>Only the assigned quality inspector can record this result. Any failed item keeps the job in progress.</p></div></div>
              {isAssignedQualityInspector ? <>
                <div className="quality-check-grid">
                  {([
                    ['brakesOk', 'Brakes operate correctly'],
                    ['lightsOk', 'Lights and indicators work'],
                    ['hornOk', 'Horn works'],
                    ['noVisibleLeaks', 'No visible leaks'],
                    ['roadTestOk', 'Road test passed'],
                    ['toolsRemoved', 'Tools and loose items removed'],
                    ['customerConcernResolved', 'Customer concern addressed'],
                  ] as const).map(([key, label]) => <label className="quality-check-option" key={key}><input type="checkbox" checked={qualityDraft[key]} onChange={(event) => setQualityDraft((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}
                </div>
                <label className="quality-check-notes">Quality notes<textarea rows={2} maxLength={1500} value={qualityDraft.notes} onChange={(event) => setQualityDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Record result and corrective work if any." /></label>
                <button type="button" className="primary-button quality-check-submit" disabled={busyId === selectedJobCard.publicId} onClick={() => void submitQualityCheck()}>{busyId === selectedJobCard.publicId ? 'Saving quality check…' : 'Record quality check'}</button>
              </> : <div className="workshop-field-hint">Assign yourself as the quality inspector, or ask an authorized manager/service advisor to assign the inspector.</div>}
            </section>}

            {selectedJobCard.status === 'READY_FOR_COLLECTION' && <section className="billing-section">
              <div className="inspection-heading"><div><h3>Operational invoice</h3><p>Quality check passed. Issue the invoice from the approved estimate revision before collecting payment.</p></div><span className="studio-count">Billing · step 1</span></div>
              {canIssueInvoice
                ? <div className="billing-action-row"><span>This is an operational service invoice. GST/tax invoice fields and statutory compliance are not implemented by this workflow.</span><button type="button" className="primary-button" disabled={busyId === selectedJobCard.publicId} onClick={() => void issueInvoice()}>{busyId === selectedJobCard.publicId ? 'Issuing…' : 'Issue operational invoice'}</button></div>
                : <div className="workshop-field-hint">Your role can view this job, but cannot issue an invoice.</div>}
            </section>}

            {(selectedJobCard.status === 'INVOICED' || selectedJobCard.status === 'DELIVERED') && <section className="billing-section">
              <div className="inspection-heading"><div><h3>Invoice and payments</h3><p>Operational invoice snapshot, recorded receipts and outstanding balance.</p></div><span className="studio-count">Billing · step 2</span></div>
              {loadingInvoice && <div className="studio-empty">Loading invoice and payment history…</div>}
              {!canReadInvoice && <div className="workshop-field-hint">Invoice details are restricted to staff with finance-read permission.</div>}
              {canReadInvoice && !loadingInvoice && !invoice && <div className="studio-empty">No issued invoice is available for this job card. Refresh or contact an authorized service advisor.</div>}
              {invoice && <>
                <div className="invoice-not-tax-banner"><strong>Operational record only</strong><span>Operational service invoice — not a GST tax invoice. GST treatment and statutory tax fields are not implemented here.</span><small>Invoice {invoice.invoiceNumber} · approved estimate revision {invoice.estimateRevision} · issued {formattedDate(invoice.issuedAt)}</small></div>
                <div className="invoice-parties">
                  <div><span>Customer</span><strong>{invoice.customerName}</strong><small>{invoice.customerPhone || 'No phone recorded'}</small></div>
                  <div><span>Vehicle</span><strong>{invoice.modelName}{invoice.variantName ? ' · ' + invoice.variantName : ''}</strong><small>Chassis {invoice.chassisNumber}</small></div>
                </div>
                <div className="invoice-line-list">
                  {invoice.lines.map((line) => <div className="invoice-line-row" key={line.lineNumber}>
                    <div><strong>{line.description}</strong><small>{prettyStatus(line.lineType)} · {line.quantity} × ₹{Number(line.unitPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small></div>
                    <strong>₹{Number(line.lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>)}
                </div>
                <div className="invoice-totals">
                  <div><span>Parts subtotal</span><strong>₹{Number(invoice.partsSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div><span>Labour subtotal</span><strong>₹{Number(invoice.labourSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div><span>Other charges</span><strong>₹{Number(invoice.otherSubtotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div><span>Discount</span><strong>−₹{Number(invoice.discountAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div className="invoice-total-row"><span>Invoice total</span><strong>₹{Number(invoice.invoiceTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div><span>Payments recorded</span><strong>₹{Number(invoice.paidAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                  <div className={Number(invoice.balanceDue) > 0 ? 'invoice-balance-row due' : 'invoice-balance-row settled'}><span>Balance due</span><strong>₹{Number(invoice.balanceDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                </div>

                {canRecordPayment && selectedJobCard.status === 'INVOICED' && Number(invoice.balanceDue) > 0 && <form className="billing-payment-form" onSubmit={recordInvoicePayment}>
                  <div className="inspection-heading"><div><h3>Record a payment</h3><p>Partial payments are supported. A receipt is created once per idempotency key.</p></div></div>
                  <div className="billing-payment-fields">
                    <label>Amount (₹)<input required type="number" min="0.01" max={Number(invoice.balanceDue)} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
                    <label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
                    <label>Payment reference<input maxLength={160} required={["UPI", "BANK_TRANSFER", "CARD"].includes(paymentMethod)} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder={["UPI", "BANK_TRANSFER", "CARD"].includes(paymentMethod) ? "Required bank / transaction reference" : "Optional reference"} /></label>
                    <label>Receipt note<input maxLength={1000} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Optional payment note" /></label>
                  </div>
                  <div className="billing-submit-row"><span>If a request times out, retry without changing the details. This screen reuses the same key until a successful response.</span><button type="submit" className="primary-button" disabled={busyId === invoice.publicId || !paymentAmount.trim()}>{busyId === invoice.publicId ? 'Recording…' : 'Record payment and receipt'}</button></div>
                </form>}
                {canReadInvoice && invoicePayments.length > 0 && <div className="invoice-payment-history">
                  <div className="inspection-heading"><div><h3>Receipt history</h3><p>Reversals remain visible and are excluded from the paid balance.</p></div><span className="studio-count">{invoicePayments.length} receipt(s)</span></div>
                  {invoicePayments.map((payment) => <article className="invoice-payment-row" key={payment.publicId}>
                    <div className="invoice-payment-symbol">{payment.status === 'REVERSED' ? '↶' : '₹'}</div>
                    <div className="invoice-payment-copy"><strong>{payment.receiptNumber} · ₹{Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><span>{prettyStatus(payment.paymentMethod)} · recorded by {payment.recordedByName} · {formattedDate(payment.recordedAt)}</span>{payment.paymentReference && <small>Reference: {payment.paymentReference}</small>}{payment.note && <small>{payment.note}</small>}{payment.status === 'REVERSED' && <small className="invoice-reversal-note">Reversed by {payment.reversedByName || 'authorized staff'} · {formattedDate(payment.reversedAt)} · {payment.reversalReason}{payment.reversalReference ? ' · ' + payment.reversalReference : ''}</small>}</div>
                    <span className={payment.status === 'REVERSED' ? 'campaign-status status-cancelled' : 'campaign-status status-sent'}>{prettyStatus(payment.status)}</span>
                    {canReversePayment && selectedJobCard.status !== 'DELIVERED' && payment.status === 'RECORDED' && <button type="button" className="text-button danger-link" disabled={busyId === payment.publicId} onClick={() => void reverseInvoicePayment(payment)}>Reverse</button>}
                  </article>)}
                  {canReversePayment && selectedJobCard.status === 'INVOICED' && invoicePayments.some((payment) => payment.status === 'RECORDED') && <div className="invoice-reversal-form">
                    <label>Reversal reason<input required maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Required audit reason" /></label>
                    <label>External reversal reference<input maxLength={160} value={reversalReference} onChange={(event) => setReversalReference(event.target.value)} placeholder="Optional reference" /></label>
                    <small>Choose Reverse on the specific receipt above after entering the reason. Reversals after vehicle handover require a separate refund/credit workflow.</small>
                  </div>}
                </div>}

                {selectedJobCard.status === 'INVOICED' && Number(invoice.balanceDue) === 0 && canDeliverVehicle && <form className="billing-handover-form" onSubmit={handoverVehicle}>
                  <div className="inspection-heading"><div><h3>Vehicle handover</h3><p>Only available after quality pass and full settlement. Record who received the vehicle and acknowledgement evidence.</p></div><span className="studio-count">Final step</span></div>
                  <div className="billing-payment-fields">
                    <label>Person receiving vehicle<input required maxLength={160} value={deliveredToName} onChange={(event) => setDeliveredToName(event.target.value)} /></label>
                    <label>Acknowledgement method<select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value as typeof deliveryMethod)}><option value="IN_PERSON">In person</option><option value="SIGNED_FORM">Signed form</option><option value="OTP_REFERENCE">OTP reference</option><option value="WRITTEN_MESSAGE">Written message</option></select></label>
                    <label>Evidence reference<input maxLength={160} required={deliveryMethod === 'SIGNED_FORM' || deliveryMethod === 'OTP_REFERENCE'} value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} placeholder="Required for signed form / OTP reference" /></label>
                    <label>Handover note<input maxLength={1000} value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} placeholder="Optional handover details" /></label>
                  </div>
                  <label className="delivery-acknowledgement"><input type="checkbox" checked={deliveryAcknowledged} onChange={(event) => setDeliveryAcknowledged(event.target.checked)} /> Customer acknowledgement received. I have recorded the receiver and evidence method above.</label>
                  <div className="billing-submit-row"><span>Payment recording is not a payment-provider confirmation. This is a staff-recorded operational receipt.</span><button type="submit" className="primary-button" disabled={busyId === selectedJobCard.publicId || !deliveryAcknowledged}>{busyId === selectedJobCard.publicId ? 'Recording handover…' : 'Complete vehicle handover'}</button></div>
                </form>}

                {selectedJobCard.status === 'INVOICED' && Number(invoice.balanceDue) > 0 && <div className="workshop-next-stage"><strong>Handover blocked.</strong> Receive and record the remaining balance of ₹{Number(invoice.balanceDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} before the vehicle can be handed over.</div>}
                {selectedJobCard.status === 'DELIVERED' && <div className="workshop-next-stage"><strong>Vehicle handed over.</strong> The invoice was settled and an acknowledgement-backed handover record was saved. Receipt reversals now require a separate refund/credit workflow.</div>}
              </>}
            </section>}


            {canAssign && <div className="assignment-section">
              <div className="inspection-heading"><div><h3>Team assignments</h3><p>Assignment changes are recorded in the job history.</p></div></div>
              <div className="active-assignments">{assignments.filter((assignment) => assignment.unassignedAt === null).map((assignment) => <div className="active-assignment" key={assignment.publicId}><span>{prettyStatus(assignment.assignmentRole)}</span><strong>{assignment.staffName}</strong><small>Assigned {formattedDate(assignment.assignedAt)}</small></div>)}{assignments.filter((assignment) => assignment.unassignedAt === null).length === 0 && <span className="assignment-empty">No active assignments.</span>}</div>
              <form className="assignment-form" onSubmit={assignStaff}>
                <label>Assignment role<select value={assignmentRole} onChange={(event) => { setAssignmentRole(event.target.value as typeof assignmentRole); setSelectedStaff(''); setStaffOptions([]); }}><option value="TECHNICIAN">Technician</option><option value="SERVICE_ADVISOR">Service advisor</option><option value="QUALITY_INSPECTOR">Quality inspector</option></select></label>
                <label>Find staff<input value={staffSearchInput} onChange={(event) => setStaffSearchInput(event.target.value)} maxLength={100} placeholder="Search name or email" /></label>
                <button type="button" className="secondary-button" onClick={() => void loadAssignableStaff()}>Find staff</button>
                <label className="assignment-staff-select">Staff member<select required value={selectedStaff} onChange={(event) => setSelectedStaff(event.target.value)}><option value="">Choose active staff…</option>{staffOptions.map((option) => <option key={option.publicId} value={option.publicId}>{option.fullName}</option>)}</select></label>
                <label>Assignment note<input maxLength={500} value={assignmentNote} onChange={(event) => setAssignmentNote(event.target.value)} placeholder="Optional handover note" /></label>
                <button type="submit" className="primary-button" disabled={saving || !selectedStaff}>{saving ? 'Assigning…' : 'Assign staff'}</button>
              </form>
            </div>}
          </section>}
        </div>
      )}
    </section>
  );
}
