import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../apiClient';
import { printFinanceDocument } from '../finance/printFinanceDocument';
import type { StaffSummary } from '../auth/StaffLogin';

type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
type Customer = {
  publicId: string; customerCode: string; fullName: string; phone: string | null; email: string | null; status: string;
};
type VehicleModel = {
  publicId: string; modelCode: string; modelName: string; variantName: string | null;
  colourName: string | null; active: boolean; availableCount: number;
};
type VehicleUnit = {
  publicId: string; modelPublicId: string; modelCode: string; modelName: string;
  variantName: string | null; colourName: string | null; chassisNumber: string;
  engineNumber: string; stockStatus: string;
};
type Enquiry = {
  publicId: string; enquiryCode: string; customerPublicId: string; customerCode: string;
  customerName: string; customerPhone: string | null; customerEmail: string | null;
  interestedModelPublicId: string | null; modelCode: string | null; modelName: string | null;
  variantName: string | null; colourName: string | null; assignedStaffPublicId: string | null;
  assignedStaffName: string | null; status: string; leadSource: string; contactPreference: string;
  nextFollowUpAt: string | null; lastContactedAt: string | null; notes: string | null;
  createdAt: string; updatedAt: string;
};
type Activity = {
  publicId: string; activityType: string; fromStatus: string | null; toStatus: string | null;
  note: string | null; followUpAt: string | null; referenceType: string | null;
  referenceId: string | null; actorName: string; createdAt: string;
};
type TestRide = {
  publicId: string; testRideCode: string; status: string; enquiryPublicId: string; enquiryCode: string;
  customerName: string; vehiclePublicId: string; modelCode: string; modelName: string;
  variantName: string | null; colourName: string | null; chassisNumber: string; engineNumber: string;
  scheduledStart: string; scheduledEnd: string; notes: string | null; createdByName: string;
  checkedOutByName: string | null; completedByName: string | null; checkedOutAt: string | null;
  completedAt: string | null; cancelledAt: string | null; cancellationReason: string | null;
};
type Booking = {
  publicId: string; bookingCode: string; enquiryPublicId: string; enquiryCode: string;
  customerPublicId: string; customerCode: string; customerName: string; customerPhone: string | null;
  vehiclePublicId: string; modelCode: string; modelName: string; variantName: string | null;
  colourName: string | null; chassisNumber: string; engineNumber: string; vehicleStockStatus: string;
  status: string; notes: string | null; createdByName: string; createdAt: string;
  cancelledAt: string | null; cancellationReason: string | null;
};
type SaleInvoiceLine = {
  lineNumber: number; lineType: string; description: string; quantity: number;
  unitPrice: number; discountAmount: number; lineTotal: number;
};
type SaleInvoice = {
  publicId: string; invoiceNumber: string; bookingPublicId: string; bookingCode: string; bookingStatus: string;
  customerPublicId: string; customerCode: string; customerName: string; customerPhone: string | null;
  vehiclePublicId: string; modelCode: string; modelName: string; variantName: string | null; colourName: string | null;
  chassisNumber: string; engineNumber: string; status: string; invoiceTotal: number; paidAmount: number;
  balanceDue: number; documentNotice: string; customerMessage: string | null; createdByName: string;
  issuedByName: string | null; createdAt: string; issuedAt: string | null; cancelledAt: string | null;
  cancellationReason: string | null; lines: SaleInvoiceLine[];
};
type SalePayment = {
  publicId: string; receiptNumber: string; paymentMethod: string; amount: number; paymentReference: string | null;
  note: string | null; status: string; recordedByName: string; recordedAt: string;
  reversalReason: string | null; reversalReference: string | null; reversedByName: string | null; reversedAt: string | null;
};
type SaleHandover = {
  publicId: string; bookingPublicId: string; bookingCode: string; invoicePublicId: string; invoiceNumber: string;
  deliveredToName: string; customerAcknowledged: boolean; acknowledgementMethod: string;
  acknowledgementReference: string | null; note: string | null; deliveredAt: string; deliveredByName: string;
  customerName: string; chassisNumber: string; engineNumber: string; stockStatus: string; invoiceTotal: number;
};
type SaleAddOnDraft = {
  lineType: 'ACCESSORY' | 'OTHER'; description: string; quantity: string; unitPrice: string; discountAmount: string;
};
type EnquiryDetail = { enquiry: Enquiry; activities: Activity[]; testRides: TestRide[]; bookings: Booking[] };
type EnquiryForm = {
  customerPublicId: string; interestedModelPublicId: string; leadSource: string; contactPreference: string;
  nextFollowUpAt: string; note: string;
};

const emptyEnquiry: EnquiryForm = {
  customerPublicId: '', interestedModelPublicId: '', leadSource: 'WALK_IN',
  contactPreference: 'CALL', nextFollowUpAt: '', note: '',
};

function localDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not set'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}
function titleCase(value: string | null | undefined) {
  return (value ?? '').replaceAll('_', ' ').toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
function statusClass(value: string) {
  return 'sales-status status-' + value.toLowerCase().replaceAll('_', '-');
}
function money(value: number | null | undefined) {
  return '₹' + Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function newSaleKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


export default function SalesWorkspace({ token, staff }: { token: string; staff: StaffSummary }) {
  const canRead = staff.permissions.includes('sales.read');
  const canManage = staff.permissions.includes('sales.manage');
  const [activeTab, setActiveTab] = useState<'enquiries' | 'bookings'>('enquiries');
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [availableUnits, setAvailableUnits] = useState<VehicleUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<EnquiryForm>(emptyEnquiry);
  const [detail, setDetail] = useState<EnquiryDetail | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [testRideVehicleId, setTestRideVehicleId] = useState('');
  const [testRideStart, setTestRideStart] = useState(() => localDateTime(new Date(Date.now() + 60 * 60 * 1000)));
  const [testRideEnd, setTestRideEnd] = useState(() => localDateTime(new Date(Date.now() + 90 * 60 * 1000)));
  const [testRideNote, setTestRideNote] = useState('');
  const [bookingVehicleId, setBookingVehicleId] = useState('');
  const [bookingNote, setBookingNote] = useState('');
  const [rideCancelReason, setRideCancelReason] = useState('');
  const [bookingCancelReason, setBookingCancelReason] = useState('');
  const canReadSaleFinance = staff.permissions.includes('finance.read');
  const canIssueSaleInvoice = staff.permissions.includes('finance.invoice');
  const canRecordSalePayment = staff.permissions.includes('finance.payment');
  const canDeliverSale = staff.permissions.includes('sales.deliver');
  const [saleBooking, setSaleBooking] = useState<Booking | null>(null);
  const [saleInvoice, setSaleInvoice] = useState<SaleInvoice | null>(null);
  const [salePayments, setSalePayments] = useState<SalePayment[]>([]);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleBusy, setSaleBusy] = useState('');
  const [saleVehiclePrice, setSaleVehiclePrice] = useState('');
  const [saleVehicleDiscount, setSaleVehicleDiscount] = useState('0');
  const [saleCustomerMessage, setSaleCustomerMessage] = useState('');
  const [saleAddOns, setSaleAddOns] = useState<SaleAddOnDraft[]>([]);
  const [saleInvoiceKey, setSaleInvoiceKey] = useState(newSaleKey);
  const [salePaymentAmount, setSalePaymentAmount] = useState('');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CARD' | 'OTHER'>('UPI');
  const [salePaymentReference, setSalePaymentReference] = useState('');
  const [salePaymentNote, setSalePaymentNote] = useState('');
  const [salePaymentKey, setSalePaymentKey] = useState(newSaleKey);
  const [saleReversalReason, setSaleReversalReason] = useState('');
  const [saleReversalReference, setSaleReversalReference] = useState('');
  const [saleReceiverName, setSaleReceiverName] = useState('');
  const [saleAcknowledged, setSaleAcknowledged] = useState(false);
  const [saleAcknowledgementMethod, setSaleAcknowledgementMethod] =
    useState<'IN_PERSON' | 'SIGNED_FORM' | 'OTP_REFERENCE' | 'WRITTEN_MESSAGE'>('IN_PERSON');
  const [saleAcknowledgementReference, setSaleAcknowledgementReference] = useState('');
  const [saleHandoverNote, setSaleHandoverNote] = useState('');



  const loadReferenceData = useCallback(async () => {
    const [customerPage, modelPage, unitPage] = await Promise.all([
      apiFetch<Page<Customer>>('/api/v1/admin/customers?page=0&pageSize=100', token),
      apiFetch<Page<VehicleModel>>('/api/v1/admin/vehicle-models?page=0&pageSize=100', token),
      apiFetch<Page<VehicleUnit>>('/api/v1/admin/vehicle-units?page=0&pageSize=100&status=AVAILABLE', token),
    ]);
    setCustomers(customerPage.items ?? []);
    setModels((modelPage.items ?? []).filter((model) => model.active));
    setAvailableUnits(unitPage.items ?? []);
    setCreateForm((current) => ({
      ...current,
      customerPublicId: current.customerPublicId || customerPage.items?.[0]?.publicId || '',
      interestedModelPublicId: current.interestedModelPublicId || '',
    }));
    setTestRideVehicleId((current) => current || unitPage.items?.[0]?.publicId || '');
    setBookingVehicleId((current) => current || unitPage.items?.[0]?.publicId || '');
  }, [token]);

  const loadEnquiries = useCallback(async (search = query, status = statusFilter) => {
    const params = new URLSearchParams({ page: '0', pageSize: '100' });
    if (search.trim()) params.set('q', search.trim());
    if (status) params.set('status', status);
    const result = await apiFetch<Page<Enquiry>>('/api/v1/admin/sales/enquiries?' + params.toString(), token);
    setEnquiries(result.items ?? []);
  }, [token, query, statusFilter]);

  const loadBookings = useCallback(async (search = query) => {
    const params = new URLSearchParams({ page: '0', pageSize: '100' });
    if (search.trim()) params.set('q', search.trim());
    const result = await apiFetch<Page<Booking>>('/api/v1/admin/sales/bookings?' + params.toString(), token);
    setBookings(result.items ?? []);
  }, [token, query]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadEnquiries(), loadBookings(), loadReferenceData()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sales workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [loadEnquiries, loadBookings, loadReferenceData]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function openEnquiry(publicId: string) {
    setError('');
    try {
      const value = await apiFetch<EnquiryDetail>('/api/v1/admin/sales/enquiries/' + publicId, token);
      setDetail(value);
      setNextStatus(value.enquiry.status);
      setFollowUpAt(value.enquiry.nextFollowUpAt ? localDateTime(new Date(value.enquiry.nextFollowUpAt)) : '');
      setTestRideVehicleId((current) => current || availableUnits[0]?.publicId || '');
      setBookingVehicleId((current) => current || availableUnits[0]?.publicId || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enquiry details could not be loaded.');
    }
  }

  async function refreshSaleTransaction(booking: Booking, invoiceId?: string) {
    const invoice = invoiceId
      ? await apiFetch<SaleInvoice>('/api/v1/admin/sales/invoices/' + invoiceId, token)
      : await apiFetch<SaleInvoice>('/api/v1/admin/sales/bookings/' + booking.publicId + '/invoice', token);
    setSaleInvoice(invoice);
    if (canReadSaleFinance) {
      const payments = await apiFetch<SalePayment[]>(
        '/api/v1/admin/sales/invoices/' + invoice.publicId + '/payments', token);
      setSalePayments(payments ?? []);
    } else {
      setSalePayments([]);
    }
    if (!saleReceiverName.trim()) setSaleReceiverName(booking.customerName);
    return invoice;
  }

  async function openSaleTransaction(booking: Booking) {
    setSaleBooking(booking);
    setSaleInvoice(null);
    setSalePayments([]);
    setSaleError('');
    setSaleLoading(true);
    setSaleVehiclePrice('');
    setSaleVehicleDiscount('0');
    setSaleCustomerMessage('');
    setSaleAddOns([]);
    setSaleInvoiceKey(newSaleKey());
    setSaleReceiverName(booking.customerName);
    setSaleAcknowledged(false);
    setSaleHandoverNote('');
    try {
      await refreshSaleTransaction(booking);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sales invoice could not be loaded.';
      if (message.toLowerCase().includes('no sales invoice has been created')) {
        setSaleInvoice(null);
        setSalePayments([]);
      } else {
        setSaleError(message);
      }
    } finally {
      setSaleLoading(false);
    }
  }

  const [saleError, setSaleError] = useState('');

  async function createSaleInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saleBooking) return;
    const price = Number(saleVehiclePrice);
    const discount = Number(saleVehicleDiscount || 0);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(discount) || discount < 0 || discount > price) {
      setSaleError('Enter a positive vehicle price and a discount no greater than that price.');
      return;
    }
    let addOns: Array<{ lineType: 'ACCESSORY' | 'OTHER'; description: string; quantity: number; unitPrice: number; discountAmount: number }>;
    try {
      addOns = saleAddOns.map((line) => {
        if (!line.description.trim()) throw new Error('Describe every accessory or other charge.');
        const quantity = Number(line.quantity);
        const unitPrice = Number(line.unitPrice);
        const discountAmount = Number(line.discountAmount || 0);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0
            || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > quantity * unitPrice) {
          throw new Error('Check the quantity, unit price and discount for each add-on line.');
        }
        return {
          lineType: line.lineType, description: line.description.trim(), quantity, unitPrice, discountAmount,
        };
      });
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Check the accessory and additional-charge lines.');
      return;
    }
    setSaleBusy('invoice'); setSaleError(''); setError(''); setSuccess('');
    try {
      const draft = await apiFetch<SaleInvoice>(
        '/api/v1/admin/sales/bookings/' + saleBooking.publicId + '/invoice', token, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: saleInvoiceKey,
            vehiclePrice: price,
            vehicleDiscount: discount,
            customerMessage: saleCustomerMessage.trim() || null,
            addOns,
          }),
        });
      setSaleInvoice(draft);
      setSaleInvoiceKey(newSaleKey());
      setSuccess('Draft sales invoice ' + draft.invoiceNumber + ' saved. Verify pricing before issuing.');
      if (canReadSaleFinance) {
        const payments = await apiFetch<SalePayment[]>(
          '/api/v1/admin/sales/invoices/' + draft.publicId + '/payments', token);
        setSalePayments(payments ?? []);
      }
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Sales invoice could not be created.');
      // Retain idempotency key after an uncertain outcome so retry cannot make a duplicate draft.
    } finally {
      setSaleBusy('');
    }
  }

  async function issueSaleInvoice() {
    if (!saleInvoice) return;
    setSaleBusy('invoice'); setSaleError(''); setSuccess('');
    try {
      const issued = await apiFetch<SaleInvoice>(
        '/api/v1/admin/sales/invoices/' + saleInvoice.publicId + '/issue', token, { method: 'POST' });
      setSaleInvoice(issued);
      setSuccess('Sales invoice ' + issued.invoiceNumber + ' issued. This document is not a GST tax invoice.');
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Sales invoice could not be issued.');
    } finally {
      setSaleBusy('');
    }
  }

  async function cancelSaleInvoice() {
    if (!saleInvoice) return;
    const reason = window.prompt('Why is this sales invoice being cancelled?')?.trim();
    if (!reason) {
      setSaleError('A cancellation reason is required.');
      return;
    }
    setSaleBusy('invoice'); setSaleError(''); setSuccess('');
    try {
      const cancelled = await apiFetch<SaleInvoice>(
        '/api/v1/admin/sales/invoices/' + saleInvoice.publicId + '/cancel', token, {
          method: 'POST', body: JSON.stringify({ reason }),
        });
      setSaleInvoice(cancelled);
      setSalePayments([]);
      setSaleSuccessMessage('Sales invoice cancelled. You can prepare a replacement invoice for this still-active booking.');
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Sales invoice could not be cancelled.');
    } finally {
      setSaleBusy('');
    }
  }

  function setSaleSuccessMessage(value: string) {
    setSuccess(value);
  }

  async function recordSalePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saleInvoice) return;
    const amount = Number(salePaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSaleError('Enter a positive payment amount.');
      return;
    }
    if (['UPI', 'BANK_TRANSFER', 'CARD'].includes(salePaymentMethod) && !salePaymentReference.trim()) {
      setSaleError('A transaction reference is required for UPI, bank-transfer or card entries.');
      return;
    }
    setSaleBusy('payment'); setSaleError(''); setSuccess('');
    try {
      const payment = await apiFetch<SalePayment>(
        '/api/v1/admin/sales/invoices/' + saleInvoice.publicId + '/payments', token, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: salePaymentKey, paymentMethod: salePaymentMethod, amount,
            paymentReference: salePaymentReference.trim() || null, note: salePaymentNote.trim() || null,
          }),
        });
      const updated = await apiFetch<SaleInvoice>(
        '/api/v1/admin/sales/invoices/' + saleInvoice.publicId, token);
      const payments = canReadSaleFinance ? await apiFetch<SalePayment[]>(
        '/api/v1/admin/sales/invoices/' + saleInvoice.publicId + '/payments', token) : [];
      setSaleInvoice(updated);
      setSalePayments(payments ?? []);
      setSalePaymentAmount('');
      setSalePaymentReference('');
      setSalePaymentNote('');
      setSalePaymentKey(newSaleKey());
      setSuccess('Receipt ' + payment.receiptNumber + ' recorded/recovered. Outstanding balance: ' + money(updated.balanceDue) + '.');
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Sales payment could not be recorded.');
      // Retain the idempotency key after an unknown network outcome.
    } finally {
      setSaleBusy('');
    }
  }

  async function reverseSalePayment(payment: SalePayment) {
    const reason = saleReversalReason.trim();
    if (!reason) {
      setSaleError('Enter a reversal reason before reversing a receipt.');
      return;
    }
    setSaleBusy(payment.publicId); setSaleError(''); setSuccess('');
    try {
      const reversed = await apiFetch<SalePayment>(
        '/api/v1/admin/sales/payments/' + payment.publicId + '/reverse', token, {
          method: 'POST',
          body: JSON.stringify({ reason, externalReference: saleReversalReference.trim() || null }),
        });
      await refreshSaleTransaction(saleBooking!, saleInvoice?.publicId);
      setSaleReversalReason('');
      setSaleReversalReference('');
      setSuccess('Receipt ' + reversed.receiptNumber + ' reversed. Reason remains in the audit ledger.');
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Sales receipt could not be reversed.');
    } finally {
      setSaleBusy('');
    }
  }

  async function deliverSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saleBooking || !saleInvoice) return;
    if (Number(saleInvoice.balanceDue) !== 0) {
      setSaleError('The sales invoice must be fully settled before delivery.');
      return;
    }
    if (!saleAcknowledged) {
      setSaleError('Record customer acknowledgement before completing delivery.');
      return;
    }
    setSaleBusy('delivery'); setSaleError(''); setSuccess('');
    try {
      const handover = await apiFetch<SaleHandover>(
        '/api/v1/admin/sales/bookings/' + saleBooking.publicId + '/deliver', token, {
          method: 'POST',
          body: JSON.stringify({
            deliveredToName: saleReceiverName.trim(),
            customerAcknowledged: saleAcknowledged,
            acknowledgementMethod: saleAcknowledgementMethod,
            acknowledgementReference: saleAcknowledgementReference.trim() || null,
            note: saleHandoverNote.trim() || null,
          }),
        });
      setSuccess('Bike delivered to ' + handover.deliveredToName + '. Unit is now SOLD and the customer ownership link has been recorded.');
      const refreshedBooking = await apiFetch<Booking>(
        '/api/v1/admin/sales/bookings/' + saleBooking.publicId, token);
      setSaleBooking(refreshedBooking);
      await refreshSaleTransaction(refreshedBooking, saleInvoice.publicId);
      await Promise.all([refresh(), openEnquiry(refreshedBooking.enquiryPublicId)]);
    } catch (cause) {
      setSaleError(cause instanceof Error ? cause.message : 'Vehicle delivery could not be completed.');
    } finally {
      setSaleBusy('');
    }
  }

  async function createEnquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const created = await apiFetch<Enquiry>('/api/v1/admin/sales/enquiries', token, {
        method: 'POST',
        body: JSON.stringify({
          customerPublicId: createForm.customerPublicId,
          interestedModelPublicId: createForm.interestedModelPublicId || null,
          assignedStaffPublicId: null,
          leadSource: createForm.leadSource,
          contactPreference: createForm.contactPreference,
          nextFollowUpAt: createForm.nextFollowUpAt ? new Date(createForm.nextFollowUpAt).toISOString() : null,
          note: createForm.note.trim() || null,
        }),
      });
      setShowCreate(false);
      setCreateForm({ ...emptyEnquiry, customerPublicId: customers[0]?.publicId ?? '' });
      setSuccess('Enquiry ' + created.enquiryCode + ' created. Add the next action to keep the lead moving.');
      await Promise.all([loadEnquiries(), loadBookings(), loadReferenceData()]);
      await openEnquiry(created.publicId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sales enquiry could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function changeEnquiryStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusyId(detail.enquiry.publicId); setError(''); setSuccess('');
    try {
      await apiFetch<Enquiry>('/api/v1/admin/sales/enquiries/' + detail.enquiry.publicId + '/status', token, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, note: statusNote.trim() || null }),
      });
      setStatusNote('');
      setSuccess('Enquiry status saved to the activity history.');
      await Promise.all([loadEnquiries(), openEnquiry(detail.enquiry.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enquiry status could not be changed.');
    } finally {
      setBusyId('');
    }
  }

  async function setFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setBusyId(detail.enquiry.publicId); setError(''); setSuccess('');
    try {
      await apiFetch<Enquiry>('/api/v1/admin/sales/enquiries/' + detail.enquiry.publicId + '/follow-up', token, {
        method: 'POST',
        body: JSON.stringify({
          followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
          note: followUpNote.trim() || null,
        }),
      });
      setFollowUpNote('');
      setSuccess('Follow-up date saved.');
      await Promise.all([loadEnquiries(), openEnquiry(detail.enquiry.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Follow-up could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  async function scheduleTestRide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !testRideVehicleId) {
      setError('Choose an available bike for this test ride.');
      return;
    }
    setBusyId(detail.enquiry.publicId); setError(''); setSuccess('');
    try {
      const ride = await apiFetch<TestRide>(
        '/api/v1/admin/sales/enquiries/' + detail.enquiry.publicId + '/test-rides', token, {
          method: 'POST',
          body: JSON.stringify({
            vehicleUnitPublicId: testRideVehicleId,
            scheduledStart: new Date(testRideStart).toISOString(),
            scheduledEnd: new Date(testRideEnd).toISOString(),
            notes: testRideNote.trim() || null,
          }),
        });
      setTestRideNote('');
      setSuccess('Test ride ' + ride.testRideCode + ' scheduled.');
      await Promise.all([refresh(), openEnquiry(detail.enquiry.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test ride could not be scheduled.');
    } finally {
      setBusyId('');
    }
  }

  async function updateTestRide(ride: TestRide, action: 'check-out' | 'complete' | 'cancel') {
    const route = '/api/v1/admin/sales/test-rides/' + ride.publicId + '/' + action;
    const body = action === 'cancel'
      ? { reason: rideCancelReason.trim() }
      : { note: action === 'check-out' ? 'Bike checked out by dealership staff.' : 'Test ride completed and bike returned.' };
    if (action === 'cancel' && !rideCancelReason.trim()) {
      setError('Enter a reason before cancelling the test ride.');
      return;
    }
    setBusyId(ride.publicId); setError(''); setSuccess('');
    try {
      await apiFetch<TestRide>(route, token, { method: 'POST', body: JSON.stringify(body) });
      setRideCancelReason('');
      setSuccess('Test ride updated.');
      if (detail) await Promise.all([refresh(), openEnquiry(detail.enquiry.publicId)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Test ride could not be updated.');
    } finally {
      setBusyId('');
    }
  }

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !bookingVehicleId) {
      setError('Choose an available bike to reserve.');
      return;
    }
    setBusyId(detail.enquiry.publicId); setError(''); setSuccess('');
    try {
      const booking = await apiFetch<Booking>(
        '/api/v1/admin/sales/enquiries/' + detail.enquiry.publicId + '/bookings', token, {
          method: 'POST',
          body: JSON.stringify({
            vehicleUnitPublicId: bookingVehicleId,
            notes: bookingNote.trim() || null,
          }),
        });
      setBookingNote('');
      setSuccess('Bike reserved under booking ' + booking.bookingCode + '. This is a reservation, not a sale invoice.');
      await Promise.all([refresh(), openEnquiry(detail.enquiry.publicId)]);
      setActiveTab('bookings');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bike booking could not be created.');
    } finally {
      setBusyId('');
    }
  }

  async function cancelBooking(booking: Booking) {
    if (!bookingCancelReason.trim()) {
      setError('Enter a reason before cancelling this booking.');
      return;
    }
    setBusyId(booking.publicId); setError(''); setSuccess('');
    try {
      await apiFetch<Booking>('/api/v1/admin/sales/bookings/' + booking.publicId + '/cancel', token, {
        method: 'POST',
        body: JSON.stringify({ reason: bookingCancelReason.trim() }),
      });
      setBookingCancelReason('');
      setSuccess('Booking cancelled and the bike reservation released.');
      await refresh();
      if (detail?.enquiry.publicId === booking.enquiryPublicId) await openEnquiry(booking.enquiryPublicId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Booking could not be cancelled.');
    } finally {
      setBusyId('');
    }
  }

  if (!canRead) {
    return <section className="module-landing"><div className="module-symbol">↗</div><div className="eyebrow">ACCESS CONTROL</div><h1>Sales pipeline</h1><p>Your role does not include sales enquiry or booking access.</p></section>;
  }

  const selectedEnquiry = detail?.enquiry ?? null;
  const allowedStatuses = selectedEnquiry ? ({
    NEW: ['CONTACTED', 'QUALIFIED', 'LOST', 'CLOSED'],
    CONTACTED: ['QUALIFIED', 'TEST_RIDE_SCHEDULED', 'LOST', 'CLOSED'],
    QUALIFIED: ['CONTACTED', 'TEST_RIDE_SCHEDULED', 'LOST', 'CLOSED'],
    TEST_RIDE_SCHEDULED: ['CONTACTED', 'QUALIFIED', 'LOST', 'CLOSED'],
    LOST: ['CONTACTED', 'QUALIFIED'],
    CLOSED: ['CONTACTED', 'QUALIFIED'],
    BOOKED: [],
  } as Record<string, string[]>)[selectedEnquiry.status] ?? [] : [];
  const canReserveForSelected = selectedEnquiry
    && ['NEW', 'CONTACTED', 'QUALIFIED', 'TEST_RIDE_SCHEDULED'].includes(selectedEnquiry.status);
  const showAvailableUnits = availableUnits.length > 0;

  return (
    <section className="sales-workspace">
      <div className="sales-page-heading">
        <div><div className="eyebrow">CUSTOMER RELATIONSHIP & BIKE ALLOCATION</div><h1>Sales pipeline</h1><p>Track every enquiry, follow-up, test ride and individual-bike reservation. A booking reserves stock; it does not issue a sale invoice.</p></div>
        <div className="sales-heading-actions">
          <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
          {canManage && <button type="button" className="primary-button" onClick={() => { setShowCreate((value) => !value); setError(''); setSuccess(''); }} disabled={customers.length === 0}>{showCreate ? 'Close form' : '+ New enquiry'}</button>}
        </div>
      </div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      {showCreate && canManage && <form className="sales-form-card" onSubmit={createEnquiry}>
        <div className="sales-section-heading"><div><h2>New sales enquiry</h2><p>Choose an existing customer. Customer data stays in the shared customer register.</p></div><span className="sales-step">01 / ENQUIRY</span></div>
        {customers.length === 0 && <div className="sales-inline-warning">Create a customer record before adding a sales enquiry.</div>}
        <div className="sales-form-grid">
          <label>Customer *<select required value={createForm.customerPublicId} onChange={(event) => setCreateForm((current) => ({ ...current, customerPublicId: event.target.value }))}><option value="">Choose customer</option>{customers.filter((customer) => customer.status === 'ACTIVE').map((customer) => <option key={customer.publicId} value={customer.publicId}>{customer.customerCode} · {customer.fullName}{customer.phone ? ' · ' + customer.phone : ''}</option>)}</select></label>
          <label>Interested model<select value={createForm.interestedModelPublicId} onChange={(event) => setCreateForm((current) => ({ ...current, interestedModelPublicId: event.target.value }))}><option value="">Not decided yet</option>{models.map((model) => <option key={model.publicId} value={model.publicId}>{model.modelCode} · {model.modelName}{model.variantName ? ' · ' + model.variantName : ''}</option>)}</select></label>
          <label>Lead source<select value={createForm.leadSource} onChange={(event) => setCreateForm((current) => ({ ...current, leadSource: event.target.value }))}><option value="WALK_IN">Walk-in</option><option value="PHONE">Phone call</option><option value="WEBSITE">Website</option><option value="REFERRAL">Referral</option><option value="CAMPAIGN">Campaign</option><option value="SOCIAL_MEDIA">Social media</option><option value="OTHER">Other</option></select></label>
          <label>Preferred contact<select value={createForm.contactPreference} onChange={(event) => setCreateForm((current) => ({ ...current, contactPreference: event.target.value }))}><option value="CALL">Call</option><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="IN_PERSON">In person</option><option value="NONE">No preference recorded</option></select></label>
          <label>Next follow-up<input type="datetime-local" value={createForm.nextFollowUpAt} onChange={(event) => setCreateForm((current) => ({ ...current, nextFollowUpAt: event.target.value }))} /></label>
          <label className="sales-field-wide">Initial note<textarea rows={2} maxLength={2000} value={createForm.note} onChange={(event) => setCreateForm((current) => ({ ...current, note: event.target.value }))} placeholder="Bike interest, budget, expected purchase date or customer question" /></label>
        </div>
        <div className="sales-form-actions"><button type="button" className="secondary-button" onClick={() => { setShowCreate(false); setCreateForm(emptyEnquiry); }}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !createForm.customerPublicId}>{saving ? 'Saving enquiry…' : 'Create enquiry'}</button></div>
      </form>}

      <div className="sales-tabs" role="tablist" aria-label="Sales workspaces">
        <button type="button" className={activeTab === 'enquiries' ? 'sales-tab active' : 'sales-tab'} onClick={() => setActiveTab('enquiries')}>Enquiries <span>{enquiries.length}</span></button>
        <button type="button" className={activeTab === 'bookings' ? 'sales-tab active' : 'sales-tab'} onClick={() => setActiveTab('bookings')}>Bike bookings <span>{bookings.filter((booking) => booking.status === 'ACTIVE').length}</span></button>
      </div>

      {activeTab === 'enquiries' && <div className="sales-layout">
        <section className="sales-list-panel">
          <div className="sales-section-heading"><div><h2>Enquiry queue</h2><p>Follow-up dates are ordered first to keep due work visible.</p></div><span className="sales-counter">{enquiries.length} shown</span></div>
          <form className="sales-search" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); }}>
            <input aria-label="Search sales enquiries" value={queryInput} maxLength={100} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search enquiry, customer or model" />
            <button type="submit" className="secondary-button">Search</button>
            <button type="button" className="text-button" onClick={() => { setQueryInput(''); setQuery(''); }}>Clear</button>
          </form>
          <label className="sales-filter-label">Stage<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All stages</option><option value="NEW">New</option><option value="CONTACTED">Contacted</option><option value="QUALIFIED">Qualified</option><option value="TEST_RIDE_SCHEDULED">Test ride scheduled</option><option value="BOOKED">Booked</option><option value="LOST">Lost</option><option value="CLOSED">Closed</option></select></label>
          {loading ? <div className="studio-empty">Loading sales enquiries…</div>
            : enquiries.length === 0 ? <div className="studio-empty">No enquiries found. Start with a new enquiry after selecting or creating a customer.</div>
            : <div className="sales-enquiry-list">{enquiries.map((enquiry) => <button type="button" key={enquiry.publicId} className={selectedEnquiry?.publicId === enquiry.publicId ? 'sales-enquiry-card selected' : 'sales-enquiry-card'} onClick={() => void openEnquiry(enquiry.publicId)}>
              <div className="sales-enquiry-card-top"><strong>{enquiry.enquiryCode}</strong><span className={statusClass(enquiry.status)}>{titleCase(enquiry.status)}</span></div>
              <h3>{enquiry.customerName}</h3><p>{enquiry.modelName ? enquiry.modelName + (enquiry.variantName ? ' · ' + enquiry.variantName : '') : 'Model not selected'}</p>
              <div className="sales-enquiry-meta"><span>{enquiry.customerPhone || enquiry.customerEmail || 'No contact saved'}</span><small>{titleCase(enquiry.leadSource)}</small></div>
              <div className={enquiry.nextFollowUpAt && new Date(enquiry.nextFollowUpAt).getTime() < Date.now() ? 'sales-follow-up due' : 'sales-follow-up'}><span>Next follow-up</span><strong>{dateLabel(enquiry.nextFollowUpAt)}</strong></div>
            </button>)}</div>}
        </section>

        <section className="sales-detail-panel">
          {!selectedEnquiry && <div className="sales-detail-empty"><div className="sales-empty-icon">↗</div><h2>Choose an enquiry</h2><p>Open any lead to review the timeline, plan a follow-up, schedule a test ride or reserve a bike.</p></div>}
          {detail && selectedEnquiry && <>
            <div className="sales-detail-heading"><div><div className="eyebrow">ENQUIRY DETAIL</div><h2>{selectedEnquiry.customerName}</h2><p>{selectedEnquiry.enquiryCode} · {selectedEnquiry.customerCode}</p></div><span className={statusClass(selectedEnquiry.status)}>{titleCase(selectedEnquiry.status)}</span></div>
            <div className="sales-customer-summary">
              <div><span>Phone / email</span><strong>{selectedEnquiry.customerPhone || 'No phone'}{selectedEnquiry.customerEmail ? ' · ' + selectedEnquiry.customerEmail : ''}</strong></div>
              <div><span>Interested bike</span><strong>{selectedEnquiry.modelName || 'Not decided'}{selectedEnquiry.variantName ? ' · ' + selectedEnquiry.variantName : ''}</strong></div>
              <div><span>Lead source</span><strong>{titleCase(selectedEnquiry.leadSource)} · {titleCase(selectedEnquiry.contactPreference)}</strong></div>
              <div><span>Assigned staff</span><strong>{selectedEnquiry.assignedStaffName || 'Unassigned'}</strong></div>
            </div>

            {canManage && allowedStatuses.length > 0 && <form className="sales-action-card" onSubmit={changeEnquiryStatus}>
              <div className="sales-section-heading"><div><h3>Update lead stage</h3><p>Stage changes are appended to the timeline.</p></div></div>
              <div className="sales-inline-form">
                <label>Move to<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}><option value={selectedEnquiry.status}>{titleCase(selectedEnquiry.status)} (current)</option>{allowedStatuses.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}</select></label>
                <label>Activity note<input maxLength={2000} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="Call result or next action" /></label>
                <button type="submit" className="primary-button" disabled={busyId === selectedEnquiry.publicId || nextStatus === selectedEnquiry.status}>{busyId === selectedEnquiry.publicId ? 'Saving…' : 'Save stage'}</button>
              </div>
            </form>}

            {canManage && !['LOST', 'CLOSED', 'BOOKED'].includes(selectedEnquiry.status) && <form className="sales-action-card" onSubmit={setFollowUp}>
              <div className="sales-section-heading"><div><h3>Follow-up reminder</h3><p>{selectedEnquiry.nextFollowUpAt ? 'Current reminder: ' + dateLabel(selectedEnquiry.nextFollowUpAt) : 'No reminder is scheduled.'}</p></div></div>
              <div className="sales-inline-form">
                <label>Follow-up date and time<input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} /></label>
                <label>Reminder note<input maxLength={2000} value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} placeholder="What should staff do next?" /></label>
                <button type="submit" className="secondary-button" disabled={busyId === selectedEnquiry.publicId}>{busyId === selectedEnquiry.publicId ? 'Saving…' : 'Save reminder'}</button>
              </div>
            </form>}

            {canManage && !['LOST', 'CLOSED', 'BOOKED'].includes(selectedEnquiry.status) && <form className="sales-action-card" onSubmit={scheduleTestRide}>
              <div className="sales-section-heading"><div><h3>Schedule a test ride</h3><p>Ride time is checked against other reservations for this exact bike.</p></div><span className="sales-counter">Test ride</span></div>
              {!showAvailableUnits && <div className="sales-inline-warning">No available bike units found. Receive a bike in Bike inventory before scheduling a ride.</div>}
              <div className="sales-inline-form sales-inline-form-three">
                <label>Available bike<select required value={testRideVehicleId} onChange={(event) => setTestRideVehicleId(event.target.value)}><option value="">Choose bike</option>{availableUnits.map((unit) => <option key={unit.publicId} value={unit.publicId}>{unit.modelCode} · {unit.modelName}{unit.variantName ? ' · ' + unit.variantName : ''} · {unit.chassisNumber}</option>)}</select></label>
                <label>Start time<input required type="datetime-local" value={testRideStart} onChange={(event) => setTestRideStart(event.target.value)} /></label>
                <label>End time<input required type="datetime-local" value={testRideEnd} onChange={(event) => setTestRideEnd(event.target.value)} /></label>
              </div>
              <label className="sales-field-wide">Test ride note<input maxLength={1000} value={testRideNote} onChange={(event) => setTestRideNote(event.target.value)} placeholder="Optional route or customer request" /></label>
              <div className="sales-form-actions"><button type="submit" className="primary-button" disabled={busyId === selectedEnquiry.publicId || !testRideVehicleId}>{busyId === selectedEnquiry.publicId ? 'Scheduling…' : 'Schedule test ride'}</button></div>
            </form>}

            {detail.testRides.length > 0 && <section className="sales-history-card">
              <div className="sales-section-heading"><div><h3>Test rides</h3><p>Availability is checked at scheduling and check-out.</p></div><span className="sales-counter">{detail.testRides.length}</span></div>
              {detail.testRides.map((ride) => <article className="sales-ride-row" key={ride.publicId}>
                <div className="sales-record-symbol">↗</div><div className="sales-record-copy"><strong>{ride.testRideCode} · {ride.modelName}{ride.variantName ? ' · ' + ride.variantName : ''}</strong><span>{dateLabel(ride.scheduledStart)} – {dateLabel(ride.scheduledEnd)}</span><small>{ride.chassisNumber} · {ride.engineNumber}{ride.notes ? ' · ' + ride.notes : ''}</small>{ride.cancellationReason && <small className="sales-warning-text">Cancelled: {ride.cancellationReason}</small>}</div>
                <span className={statusClass(ride.status)}>{titleCase(ride.status)}</span>
                {canManage && ride.status === 'SCHEDULED' && <button type="button" className="subtle-action" disabled={busyId === ride.publicId} onClick={() => void updateTestRide(ride, 'check-out')}>Check out</button>}
                {canManage && ride.status === 'CHECKED_OUT' && <button type="button" className="subtle-action" disabled={busyId === ride.publicId} onClick={() => void updateTestRide(ride, 'complete')}>Complete</button>}
                {canManage && ['SCHEDULED', 'CHECKED_OUT'].includes(ride.status) && <button type="button" className="text-button danger-link" disabled={busyId === ride.publicId} onClick={() => void updateTestRide(ride, 'cancel')}>Cancel</button>}
              </article>)}
              {canManage && detail.testRides.some((ride) => ['SCHEDULED', 'CHECKED_OUT'].includes(ride.status)) && <div className="sales-inline-form"><label>Cancellation reason for selected ride<input maxLength={500} value={rideCancelReason} onChange={(event) => setRideCancelReason(event.target.value)} placeholder="Enter the reason before selecting Cancel" /></label><span className="sales-help-text">Cancel uses the reason above; each action is recorded against the enquiry.</span></div>}
            </section>}

            {canManage && canReserveForSelected && <form className="sales-action-card sales-booking-card" onSubmit={createBooking}>
              <div className="sales-section-heading"><div><h3>Reserve a bike</h3><p>This locks one available unit as RESERVED. Invoice, payment and customer delivery are separate later steps.</p></div><span className="sales-counter">Booking</span></div>
              {!showAvailableUnits && <div className="sales-inline-warning">No available units to reserve.</div>}
              <div className="sales-inline-form"><label>Available bike<select required value={bookingVehicleId} onChange={(event) => setBookingVehicleId(event.target.value)}><option value="">Choose bike</option>{availableUnits.map((unit) => <option key={unit.publicId} value={unit.publicId}>{unit.modelCode} · {unit.modelName}{unit.variantName ? ' · ' + unit.variantName : ''} · {unit.chassisNumber}</option>)}</select></label><label>Booking note<input maxLength={1000} value={bookingNote} onChange={(event) => setBookingNote(event.target.value)} placeholder="Optional selection / reservation note" /></label><button type="submit" className="primary-button" disabled={busyId === selectedEnquiry.publicId || !bookingVehicleId}>{busyId === selectedEnquiry.publicId ? 'Reserving…' : 'Reserve selected bike'}</button></div>
            </form>}

            {detail.bookings.length > 0 && <section className="sales-history-card">
              <div className="sales-section-heading"><div><h3>Booking history</h3><p>Bookings are not sales invoices.</p></div><span className="sales-counter">{detail.bookings.length}</span></div>
              {detail.bookings.map((booking) => <article className="sales-ride-row" key={booking.publicId}>
                <div className="sales-record-symbol">▤</div><div className="sales-record-copy"><strong>{booking.bookingCode} · {booking.modelName}{booking.variantName ? ' · ' + booking.variantName : ''}</strong><span>{booking.chassisNumber} · {booking.engineNumber}</span><small>{dateLabel(booking.createdAt)} · {booking.notes || 'No booking note'}</small>{booking.cancellationReason && <small className="sales-warning-text">{booking.cancellationReason}</small>}</div><span className={statusClass(booking.status)}>{titleCase(booking.status)}</span>
                {canManage && booking.status === 'ACTIVE' && <button type="button" className="text-button danger-link" disabled={busyId === booking.publicId || !bookingCancelReason.trim()} onClick={() => void cancelBooking(booking)}>Cancel booking</button>}
                {(booking.status === 'ACTIVE' || booking.status === 'CONVERTED_TO_SALE') && (canManage || canReadSaleFinance || canDeliverSale)
                  && <button type="button" className="subtle-action" onClick={() => void openSaleTransaction(booking)}>{booking.status === 'CONVERTED_TO_SALE' ? 'View completed sale' : 'Sales invoice / delivery'}</button>}
              </article>)}
              {canManage && detail.bookings.some((booking) => booking.status === 'ACTIVE') && <div className="sales-inline-form"><label>Cancellation reason<input maxLength={500} value={bookingCancelReason} onChange={(event) => setBookingCancelReason(event.target.value)} placeholder="Required to release reserved stock" /></label></div>}
            </section>}

            <section className="sales-history-card">
              <div className="sales-section-heading"><div><h3>Activity timeline</h3><p>Every status change and next action remains visible.</p></div><span className="sales-counter">{detail.activities.length} events</span></div>
              {detail.activities.length === 0 ? <div className="studio-empty">No activity recorded yet.</div> : <div className="sales-timeline">{detail.activities.map((activity) => <article className="sales-timeline-item" key={activity.publicId}>
                <div className="sales-timeline-dot"></div><div className="sales-timeline-copy"><div><strong>{titleCase(activity.activityType)}</strong><time>{dateLabel(activity.createdAt)}</time></div>{activity.fromStatus && activity.toStatus && <span>{titleCase(activity.fromStatus)} → {titleCase(activity.toStatus)}</span>}{activity.note && <p>{activity.note}</p>}{activity.followUpAt && <small>Follow-up: {dateLabel(activity.followUpAt)}</small>}<small>By {activity.actorName}</small></div>
              </article>)}</div>}
            </section>
          </>}
        </section>
      </div>}

      {saleBooking && <section className="sales-sale-workspace">
        <div className="sales-sale-heading">
          <div><div className="eyebrow">BOOKING TO DELIVERY</div><h2>Sales invoice & vehicle delivery</h2>
            <p>{saleBooking.bookingCode} · {saleBooking.customerName} · {saleBooking.modelName}{saleBooking.variantName ? ' · ' + saleBooking.variantName : ''}</p>
            <small>{saleBooking.chassisNumber} · {saleBooking.engineNumber}</small>
          </div>
          <button type="button" className="secondary-button" onClick={() => { setSaleBooking(null); setSaleInvoice(null); setSalePayments([]); setSaleError(''); }}>Close</button>
        </div>
        {saleError && <div className="notice notice-error" role="alert">{saleError}</div>}
        {saleLoading ? <div className="studio-empty">Loading sales transaction…</div> : <>
          {!saleInvoice && saleBooking.status === 'ACTIVE' && canManage && <form className="sales-sale-form" onSubmit={createSaleInvoice}>
            <div className="sales-section-heading"><div><h3>Prepare vehicle sale invoice</h3><p>Enter the agreed selling price and discount. Prices remain separate from the dealership's purchase cost.</p></div><span className="sales-counter">Draft</span></div>
            <div className="sales-sale-fields">
              <label>Agreed vehicle price (₹)<input required type="number" min="0.01" step="0.01" value={saleVehiclePrice} onChange={(event) => setSaleVehiclePrice(event.target.value)} placeholder="Enter agreed price" /></label>
              <label>Vehicle discount (₹)<input required type="number" min="0" step="0.01" value={saleVehicleDiscount} onChange={(event) => setSaleVehicleDiscount(event.target.value)} /></label>
              <label className="sales-sale-wide">Customer-facing note<textarea rows={2} maxLength={2000} value={saleCustomerMessage} onChange={(event) => setSaleCustomerMessage(event.target.value)} placeholder="Optional sale note (not tax terms)" /></label>
            </div>
            <div className="sales-sale-addons">
              <div className="sales-section-heading"><div><h3>Accessories / other agreed charges</h3><p>Optional line items; each line is saved into the invoice snapshot.</p></div><button type="button" className="secondary-button" disabled={saleAddOns.length >= 50} onClick={() => setSaleAddOns((current) => [...current, { lineType: 'ACCESSORY', description: '', quantity: '1', unitPrice: '', discountAmount: '0' }])}>+ Add line</button></div>
              {saleAddOns.map((line, index) => <div className="sales-sale-addon-row" key={index}>
                <label>Type<select value={line.lineType} onChange={(event) => setSaleAddOns((current) => current.map((item, i) => i === index ? { ...item, lineType: event.target.value as SaleAddOnDraft['lineType'] } : item))}><option value="ACCESSORY">Accessory</option><option value="OTHER">Other</option></select></label>
                <label className="sales-sale-addon-description">Description<input required maxLength={300} value={line.description} onChange={(event) => setSaleAddOns((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} /></label>
                <label>Qty<input type="number" required min="0.001" step="0.001" value={line.quantity} onChange={(event) => setSaleAddOns((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} /></label>
                <label>Unit price (₹)<input type="number" required min="0" step="0.01" value={line.unitPrice} onChange={(event) => setSaleAddOns((current) => current.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} /></label>
                <label>Discount (₹)<input type="number" min="0" step="0.01" value={line.discountAmount} onChange={(event) => setSaleAddOns((current) => current.map((item, i) => i === index ? { ...item, discountAmount: event.target.value } : item))} /></label>
                <button type="button" className="text-button danger-link" onClick={() => setSaleAddOns((current) => current.filter((_, i) => i !== index))}>Remove</button>
              </div>)}
            </div>
            <div className="sales-sale-disclaimer"><strong>Operational invoice only</strong><span>This workflow is not a GST tax invoice and does not apply statutory tax treatment. Use the dealership's approved tax process until GST/e-invoicing integration is implemented.</span></div>
            <div className="sales-form-actions"><button type="submit" className="primary-button" disabled={saleBusy === 'invoice' || !saleVehiclePrice.trim()}>{saleBusy === 'invoice' ? 'Saving draft…' : 'Create draft invoice'}</button></div>
          </form>}

          {saleInvoice && <div className="sales-sale-invoice-card">
            <div className="sales-sale-invoice-top">
              <div><div className="eyebrow">SALES INVOICE</div><h3>{saleInvoice.invoiceNumber}</h3><span>{saleInvoice.modelName}{saleInvoice.variantName ? ' · ' + saleInvoice.variantName : ''} · chassis {saleInvoice.chassisNumber}</span><small>Created {dateLabel(saleInvoice.createdAt)}{saleInvoice.issuedAt ? ' · Issued ' + dateLabel(saleInvoice.issuedAt) : ''}</small></div>
              <div className="sales-sale-invoice-status"><span className={statusClass(saleInvoice.status)}>{titleCase(saleInvoice.status)}</span><strong>{money(saleInvoice.invoiceTotal)}</strong></div>
            </div>
            <div className="finance-document-actions"><button type="button" className="finance-small-button finance-small-button-muted" onClick={() => printFinanceDocument({
 title:'Sales operational invoice',documentNumber:saleInvoice.invoiceNumber,subtitle:saleInvoice.customerName+' · '+saleInvoice.modelName,
 fields:[
 {label:'Customer',value:saleInvoice.customerName},{label:'Phone',value:saleInvoice.customerPhone||'Not recorded'},
 {label:'Vehicle',value:saleInvoice.modelName+(saleInvoice.variantName?' · '+saleInvoice.variantName:'')},
 {label:'Chassis',value:saleInvoice.chassisNumber},{label:'Status',value:titleCase(saleInvoice.status)},
 {label:'Issue date',value:dateLabel(saleInvoice.issuedAt)},{label:'Invoice total',value:money(saleInvoice.invoiceTotal)},
 {label:'Payments recorded',value:money(saleInvoice.paidAmount)},{label:'Balance due',value:money(saleInvoice.balanceDue)}],
 lines:saleInvoice.lines.map(line=>({description:line.description,detail:titleCase(line.lineType)+' · '+line.quantity+' × '+money(line.unitPrice),amount:money(line.lineTotal)})),
 note:'Operational record only — not a GST tax invoice. No statutory tax calculation is represented.'
 })}>Print / Save PDF</button></div><div className="sales-sale-warning"><strong>Not a GST tax invoice</strong><span>{saleInvoice.documentNotice}</span></div>
            <div className="sales-sale-lines">{saleInvoice.lines.map((line) => <div className="sales-sale-line" key={line.lineNumber}>
              <div><strong>{line.description}</strong><small>{titleCase(line.lineType)} · {line.quantity} × {money(line.unitPrice)}{line.discountAmount > 0 ? ' · discount ' + money(line.discountAmount) : ''}</small></div><strong>{money(line.lineTotal)}</strong>
            </div>)}</div>
            {saleInvoice.customerMessage && <p className="sales-sale-customer-message">{saleInvoice.customerMessage}</p>}
            <div className="sales-sale-totals">
              <div><span>Invoice total</span><strong>{money(saleInvoice.invoiceTotal)}</strong></div>
              <div><span>Payments recorded</span><strong>{money(saleInvoice.paidAmount)}</strong></div>
              <div className={saleInvoice.balanceDue > 0 ? 'sales-sale-balance due' : 'sales-sale-balance settled'}><span>Balance due</span><strong>{money(saleInvoice.balanceDue)}</strong></div>
            </div>
            {saleInvoice.status === 'DRAFT' && <div className="sales-sale-actions">
              {canIssueSaleInvoice && <button type="button" className="primary-button" disabled={saleBusy === 'invoice'} onClick={() => void issueSaleInvoice()}>{saleBusy === 'invoice' ? 'Issuing…' : 'Issue invoice'}</button>}
              {canIssueSaleInvoice && saleBooking.status === 'ACTIVE' && <button type="button" className="text-button danger-link" disabled={saleBusy === 'invoice'} onClick={() => void cancelSaleInvoice()}>Cancel draft / invoice</button>}
              {!canIssueSaleInvoice && <small>Your role can prepare the draft but cannot issue an invoice. Ask finance staff to issue it.</small>}
            </div>}
            {saleInvoice.status === 'ISSUED' && saleBooking.status === 'ACTIVE' && canRecordSalePayment && saleInvoice.balanceDue > 0 && <form className="sales-sale-form sales-sale-payment-form" onSubmit={recordSalePayment}>
              <div className="sales-section-heading"><div><h3>Record payment</h3><p>Partial receipts are supported. Recording here is not gateway verification.</p></div><span className="sales-counter">Collection</span></div>
              <div className="sales-sale-fields">
                <label>Amount (₹)<input required type="number" min="0.01" max={saleInvoice.balanceDue} step="0.01" value={salePaymentAmount} onChange={(event) => setSalePaymentAmount(event.target.value)} /></label>
                <label>Method<select value={salePaymentMethod} onChange={(event) => setSalePaymentMethod(event.target.value as typeof salePaymentMethod)}><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
                <label>Payment reference<input required={['UPI', 'BANK_TRANSFER', 'CARD'].includes(salePaymentMethod)} maxLength={160} value={salePaymentReference} onChange={(event) => setSalePaymentReference(event.target.value)} placeholder={['UPI', 'BANK_TRANSFER', 'CARD'].includes(salePaymentMethod) ? 'Required transaction reference' : 'Optional reference'} /></label>
                <label>Receipt note<input maxLength={1000} value={salePaymentNote} onChange={(event) => setSalePaymentNote(event.target.value)} placeholder="Optional note" /></label>
              </div>
              <div className="sales-form-actions"><small>If the response times out, retry without changing the fields. The same idempotency key is reused.</small><button type="submit" className="primary-button" disabled={saleBusy === 'payment' || !salePaymentAmount.trim()}>{saleBusy === 'payment' ? 'Recording…' : 'Record payment'}</button></div>
            </form>}
            {canReadSaleFinance && salePayments.length > 0 && <section className="sales-sale-payment-history">
              <div className="sales-section-heading"><div><h3>Receipt history</h3><p>Reversals remain in history and are excluded from paid balance.</p></div><span className="sales-counter">{salePayments.length} receipt(s)</span></div>
              {salePayments.map((payment) => <article className="sales-sale-payment" key={payment.publicId}>
                <div className="sales-record-symbol">{payment.status === 'REVERSED' ? '↶' : '₹'}</div>
                <div className="sales-record-copy"><strong>{payment.receiptNumber} · {money(payment.amount)}</strong><span>{titleCase(payment.paymentMethod)} · {payment.recordedByName} · {dateLabel(payment.recordedAt)}</span>{payment.paymentReference && <small>Reference: {payment.paymentReference}</small>}{payment.note && <small>{payment.note}</small>}{payment.status === 'REVERSED' && <small className="sales-warning-text">Reversed by {payment.reversedByName || 'staff'} · {dateLabel(payment.reversedAt)} · {payment.reversalReason}{payment.reversalReference ? ' · ' + payment.reversalReference : ''}</small>}</div>
                <span className={statusClass(payment.status)}>{titleCase(payment.status)}</span>
                <button type="button" className="finance-small-button finance-small-button-muted" onClick={() => printFinanceDocument({
 title:'Sales payment receipt',documentNumber:payment.receiptNumber,subtitle:saleInvoice.customerName+' · invoice '+saleInvoice.invoiceNumber,
 fields:[
 {label:'Customer',value:saleInvoice.customerName},{label:'Invoice number',value:saleInvoice.invoiceNumber},
 {label:'Amount received',value:money(payment.amount)},{label:'Payment method',value:titleCase(payment.paymentMethod)},
 {label:'Reference',value:payment.paymentReference||'Not recorded'},{label:'Recorded on',value:dateLabel(payment.recordedAt)},
 {label:'Recorded by',value:payment.recordedByName},{label:'Status',value:titleCase(payment.status)},
 {label:'Reversal reason',value:payment.reversalReason||'—'}],
 note:'Manual operational payment record. This receipt does not independently verify bank, UPI or card settlement.'
 })}>Print receipt / PDF</button>
                {payment.status === 'RECORDED' && saleBooking.status === 'ACTIVE' && canRecordSalePayment && <button type="button" className="text-button danger-link" disabled={saleBusy === payment.publicId} onClick={() => void reverseSalePayment(payment)}>Reverse</button>}
              </article>)}
              {saleBooking.status === 'ACTIVE' && salePayments.some((payment) => payment.status === 'RECORDED') && canRecordSalePayment && <div className="sales-sale-reversal-fields">
                <label>Reason for reversal<input required maxLength={500} value={saleReversalReason} onChange={(event) => setSaleReversalReason(event.target.value)} placeholder="Required before selecting Reverse" /></label>
                <label>External reversal reference<input maxLength={160} value={saleReversalReference} onChange={(event) => setSaleReversalReference(event.target.value)} placeholder="Optional reference" /></label>
              </div>}
            </section>}
            {saleInvoice.status === 'CANCELLED' && saleBooking.status === 'ACTIVE' && canManage && <div className="sales-inline-warning">This invoice was cancelled. You can create a replacement invoice for this active booking.</div>}
          </div>}

          {saleInvoice?.status === 'ISSUED' && saleBooking.status === 'ACTIVE' && saleInvoice.balanceDue === 0 && canDeliverSale && <form className="sales-sale-form sales-sale-delivery-form" onSubmit={deliverSale}>
            <div className="sales-section-heading"><div><h3>Deliver vehicle</h3><p>Available only after the issued sales invoice is fully paid and customer acknowledgement is recorded.</p></div><span className="sales-counter">Final step</span></div>
            <div className="sales-sale-fields">
              <label>Person receiving the bike<input required maxLength={160} value={saleReceiverName} onChange={(event) => setSaleReceiverName(event.target.value)} /></label>
              <label>Acknowledgement method<select value={saleAcknowledgementMethod} onChange={(event) => setSaleAcknowledgementMethod(event.target.value as typeof saleAcknowledgementMethod)}><option value="IN_PERSON">In person</option><option value="SIGNED_FORM">Signed form</option><option value="OTP_REFERENCE">OTP reference</option><option value="WRITTEN_MESSAGE">Written message</option></select></label>
              <label>Evidence reference<input required={saleAcknowledgementMethod === 'SIGNED_FORM' || saleAcknowledgementMethod === 'OTP_REFERENCE'} maxLength={160} value={saleAcknowledgementReference} onChange={(event) => setSaleAcknowledgementReference(event.target.value)} placeholder="Required for signed-form / OTP reference" /></label>
              <label>Delivery note<input maxLength={1000} value={saleHandoverNote} onChange={(event) => setSaleHandoverNote(event.target.value)} placeholder="Optional handover note" /></label>
            </div>
            <label className="sales-sale-ack"><input type="checkbox" checked={saleAcknowledged} onChange={(event) => setSaleAcknowledged(event.target.checked)} /> Customer acknowledgement received. I have checked the receiver and the selected evidence method.</label>
            <div className="sales-form-actions"><small>Delivery marks this chassis SOLD and links the bike to the purchasing customer. No tax invoice or payment gateway verification is implied.</small><button type="submit" className="primary-button" disabled={saleBusy === 'delivery' || !saleAcknowledged || !saleReceiverName.trim()}>{saleBusy === 'delivery' ? 'Delivering…' : 'Complete vehicle delivery'}</button></div>
          </form>}
          {saleBooking.status === 'CONVERTED_TO_SALE' && <div className="sales-sale-complete"><strong>Sale completed</strong><span>The booking has been converted, the vehicle is SOLD and the customer ownership history was recorded.</span></div>}
          {saleBooking.status === 'ACTIVE' && saleInvoice?.status === 'ISSUED' && saleInvoice.balanceDue > 0 && <div className="sales-sale-balance-note">Delivery is blocked until the outstanding balance of {money(saleInvoice.balanceDue)} is fully recorded against the issued invoice.</div>}
        </>}
      </section>}

      {activeTab === 'bookings' && <section className="sales-list-panel sales-bookings-panel">
        <div className="sales-section-heading"><div><h2>Bike bookings</h2><p>Active bookings hold one specific vehicle unit. Cancelling releases that unit and records a movement.</p></div><span className="sales-counter">{bookings.length} records</span></div>
        <form className="sales-search" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); }}>
          <input aria-label="Search bike bookings" value={queryInput} maxLength={100} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search booking, enquiry, customer or chassis" />
          <button type="submit" className="secondary-button">Search</button>
          <button type="button" className="text-button" onClick={() => { setQueryInput(''); setQuery(''); }}>Clear</button>
        </form>
        {loading ? <div className="studio-empty">Loading bookings…</div>
          : bookings.length === 0 ? <div className="studio-empty">No bike bookings yet. Qualify an enquiry and reserve an available bike to start.</div>
          : <div className="sales-table-wrap"><table className="sales-table"><thead><tr><th>Booking</th><th>Customer</th><th>Bike / chassis</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>
            {bookings.map((booking) => <tr key={booking.publicId}>
              <td><strong>{booking.bookingCode}</strong><small>{booking.enquiryCode}</small></td>
              <td><strong>{booking.customerName}</strong><small>{booking.customerPhone || 'No phone'}</small></td>
              <td><strong>{booking.modelName}{booking.variantName ? ' · ' + booking.variantName : ''}</strong><small>{booking.chassisNumber} · {booking.engineNumber}</small></td>
              <td><span className={statusClass(booking.status)}>{titleCase(booking.status)}</span></td>
              <td>{dateLabel(booking.createdAt)}</td>
              <td className="sales-booking-actions"><button type="button" className="text-button" onClick={() => { setActiveTab('enquiries'); void openEnquiry(booking.enquiryPublicId); }}>Open enquiry</button>{(booking.status === 'ACTIVE' || booking.status === 'CONVERTED_TO_SALE') && (canManage || canReadSaleFinance || canDeliverSale) && <button type="button" className="text-button" onClick={() => void openSaleTransaction(booking)}>{booking.status === 'CONVERTED_TO_SALE' ? 'View sale' : 'Sale / invoice'}</button>}</td>
            </tr>)}
          </tbody></table></div>}
      </section>}
    </section>
  );
}
