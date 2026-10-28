import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'lucky_bajaj_customer_access_token';

type Customer = {
  publicId: string; customerCode: string; fullName: string; phone: string | null;
  email: string | null; preferredLanguage: string; dealershipCode: string; dealershipName: string;
};
type PortalSession = { accessToken: string; expiresAt: string; customer: Customer };
type Vehicle = {
  publicId: string; modelName: string; variantName: string | null; colourName: string | null;
  modelYear: number | null; chassisNumber: string; engineNumber: string; ownershipStartedAt: string;
};
type ServiceHistory = {
  jobCardPublicId: string; jobCardCode: string; status: string; customerConcern: string;
  modelName: string; variantName: string | null; colourName: string | null; chassisNumber: string;
  checkedInAt: string; completedAt: string | null; deliveredAt: string | null;
  invoiceNumber: string | null; invoiceStatus: string | null; invoiceIssuedAt: string | null;
  invoiceTotal: number; paidAmount: number; balanceDue: number; invoiceNotice: string;
};
type Appointment = {
  publicId: string; appointmentCode: string; vehiclePublicId: string; modelName: string;
  variantName: string | null; colourName: string | null; chassisNumber: string;
  scheduledFor: string; slotMinutes: number; customerConcern: string; customerLanguage: string;
  source: string; status: string; statusReason: string | null; checkedInAt: string | null;
  createdAt: string; updatedAt: string;
};
type CustomerNotification = {
  recipientPublicId: string; campaignPublicId: string; title: string; summary: string;
  contentDocumentJson: string; senderName: string; status: string; createdAt: string; readAt: string | null;
};
type NotificationPage = { items: CustomerNotification[]; page: number; pageSize: number; total: number; unreadCount: number };
type TabKey = 'home' | 'vehicles' | 'service' | 'appointments' | 'notifications';

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'home', label: 'Home', icon: '⌂' },
  { key: 'vehicles', label: 'My bikes', icon: '◈' },
  { key: 'service', label: 'Service', icon: '⚙' },
  { key: 'appointments', label: 'Visits', icon: '▦' },
  { key: 'notifications', label: 'Updates', icon: '✧' },
];

async function api<T>(path: string, token?: string, options: { method?: string; body?: string } = {}): Promise<T> {
  if (!API_BASE_URL) throw new Error('This app build has no customer API address configured. Build with EXPO_PUBLIC_API_BASE_URL.');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(API_BASE_URL + path, { method: options.method || 'GET', headers, body: options.body });
  const raw = await response.text();
  let data: unknown = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    let message = 'Request failed (' + response.status + ').';
    if (typeof data === 'object' && data !== null && 'message' in data) {
      message = String((data as { message: unknown }).message);
    } else if (typeof data === 'string' && data) {
      message = data;
    }
    throw new Error(message);
  }
  return data as T;
}

function money(value: number | null | undefined) {
  return '₹' + Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function quantityDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function pretty(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}
function cleanError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function GlassCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.glassCard, style]}>{children}</View>;
}
function Field({ label, value, onChangeText, placeholder, secureTextEntry, autoCapitalize = 'none', keyboardType, multiline }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  secureTextEntry?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'phone-pad'; multiline?: boolean;
}) {
  return <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder}
      placeholderTextColor="#8995A8" secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize} keyboardType={keyboardType}
      multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'}
      style={[styles.input, multiline && styles.multilineInput]}
    />
  </View>;
}
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [
    styles.primaryButton, (pressed || disabled) && styles.buttonPressed, disabled && styles.disabledButton,
  ]}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}
function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const okay = ['confirmed', 'completed', 'delivered', 'ready_for_collection', 'issued'].includes(normalized);
  const warning = ['requested', 'pending', 'in_progress', 'awaiting_approval', 'invoiced'].includes(normalized);
  return <View style={[styles.statusPill, okay ? styles.statusOkay : warning ? styles.statusWarning : styles.statusNeutral]}>
    <Text style={[styles.statusText, okay ? styles.statusOkayText : warning ? styles.statusWarningText : styles.statusNeutralText]}>{pretty(value)}</Text>
  </View>;
}

export default function App() {
  const [token, setToken] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'activate'>('login');
  const [tab, setTab] = useState<TabKey>('home');
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [history, setHistory] = useState<ServiceHistory[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NotificationPage>({ items: [], page: 0, pageSize: 50, total: 0, unreadCount: 0 });

  const [loginForm, setLoginForm] = useState({ dealershipCode: '', customerCode: '', password: '' });
  const [activationForm, setActivationForm] = useState({ activationToken: '', password: '', confirmPassword: '' });
  const [appointmentVehicle, setAppointmentVehicle] = useState('');
  const [appointmentConcern, setAppointmentConcern] = useState('');
  const [appointmentDate, setAppointmentDate] = useState(() => new Date(Date.now() + 48 * 60 * 60 * 1000));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [appointmentDuration, setAppointmentDuration] = useState('60');
  const [cancelReason, setCancelReason] = useState('');

  const nextAppointment = useMemo(() => appointments
    .filter((item) => ['REQUESTED', 'CONFIRMED'].includes(item.status) && new Date(item.scheduledFor).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0], [appointments]);

  const clearLocalSession = useCallback(async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken('');
    setCustomer(null);
    setVehicles([]);
    setHistory([]);
    setAppointments([]);
    setNotifications({ items: [], page: 0, pageSize: 50, total: 0, unreadCount: 0 });
  }, []);

  const loadPortalData = useCallback(async (sessionToken: string) => {
    setLoadingData(true);
    setError('');
    try {
      const [profile, currentVehicles, serviceHistory, currentAppointments, inbox] = await Promise.all([
        api<Customer>('/api/v1/customer/auth/me', sessionToken),
        api<Vehicle[]>('/api/v1/customer/vehicles', sessionToken),
        api<ServiceHistory[]>('/api/v1/customer/service-history', sessionToken),
        api<Appointment[]>('/api/v1/customer/appointments', sessionToken),
        api<NotificationPage>('/api/v1/customer/notifications?page=0&pageSize=50', sessionToken),
      ]);
      setCustomer(profile);
      setVehicles(currentVehicles);
      setHistory(serviceHistory);
      setAppointments(currentAppointments);
      setNotifications(inbox);
      setAppointmentVehicle((current) => current || currentVehicles[0]?.publicId || '');
    } catch (cause) {
      setError(cleanError(cause, 'Your customer data could not be loaded.'));
      if (cause instanceof Error && /401|unauthori[sz]ed|expired/i.test(cause.message)) await clearLocalSession();
    } finally { setLoadingData(false); }
  }, [clearLocalSession]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TOKEN_KEY).then((saved) => {
      if (!cancelled && saved) setToken(saved);
    }).catch(() => {
      if (!cancelled) setError('This device could not read the saved session.');
    }).finally(() => { if (!cancelled) setBooting(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (token) void loadPortalData(token);
  }, [token, loadPortalData]);

  async function saveSession(session: PortalSession) {
    await AsyncStorage.setItem(TOKEN_KEY, session.accessToken);
    setToken(session.accessToken);
    setCustomer(session.customer);
    setLoginForm((current) => ({ ...current, password: '' }));
    setActivationForm({ activationToken: '', password: '', confirmPassword: '' });
    setError('');
  }

  async function signIn() {
    setSaving(true); setError(''); setSuccess('');
    try {
      const session = await api<PortalSession>('/api/v1/customer/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({
          dealershipCode: loginForm.dealershipCode.trim().toUpperCase(),
          customerCode: loginForm.customerCode.trim().toUpperCase(),
          password: loginForm.password,
        }),
      });
      await saveSession(session);
      setSuccess('Signed in securely to Lucky Bajaj.');
    } catch (cause) {
      setError(cleanError(cause, 'Sign-in failed.'));
    } finally { setSaving(false); }
  }

  async function activateAccount() {
    if (activationForm.password !== activationForm.confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true); setError(''); setSuccess('');
    try {
      const session = await api<PortalSession>('/api/v1/customer/auth/activate', undefined, {
        method: 'POST',
        body: JSON.stringify({
          activationToken: activationForm.activationToken.trim(),
          password: activationForm.password,
        }),
      });
      await saveSession(session);
      setSuccess('Your customer account is active.');
    } catch (cause) {
      setError(cleanError(cause, 'Account activation failed.'));
    } finally { setSaving(false); }
  }

  async function signOut() {
    const oldToken = token;
    setSaving(true);
    try {
      await api<{ success: boolean }>('/api/v1/customer/auth/logout', oldToken, { method: 'POST' });
    } catch { /* local credentials are cleared even if the network is unavailable */ }
    await clearLocalSession();
    setSaving(false);
    setSuccess('Signed out on this device.');
  }

  async function refreshData() {
    if (token) await loadPortalData(token);
  }

  async function submitAppointment() {
    if (!appointmentVehicle) { setError('Link a bike to your profile before requesting service.'); return; }
    if (!appointmentConcern.trim()) { setError('Briefly describe what your bike needs.'); return; }
    if (appointmentDate.getTime() <= Date.now()) { setError('Choose a future date and time.'); return; }
    const minutes = Number(appointmentDuration);
    if (![30, 45, 60, 90, 120].includes(minutes)) { setError('Choose a supported service duration.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const created = await api<Appointment>('/api/v1/customer/appointments', token, {
        method: 'POST',
        body: JSON.stringify({
          vehiclePublicId: appointmentVehicle,
          scheduledFor: appointmentDate.toISOString(),
          slotMinutes: minutes,
          customerConcern: appointmentConcern.trim(),
          customerLanguage: customer?.preferredLanguage || 'en',
        }),
      });
      setAppointments((current) => [created, ...current]);
      setAppointmentConcern('');
      setSuccess('Service request ' + created.appointmentCode + ' was sent for dealership confirmation.');
      setTab('appointments');
    } catch (cause) {
      setError(cleanError(cause, 'Service request could not be submitted.'));
    } finally { setSaving(false); }
  }

  async function cancelAppointment(item: Appointment) {
    if (!cancelReason.trim()) { setError('Enter a reason before cancelling.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>('/api/v1/customer/appointments/' + item.publicId + '/cancel', token, {
        method: 'POST', body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      setAppointments((current) => current.map((old) => old.publicId === updated.publicId ? updated : old));
      setCancelReason('');
      setSuccess('Appointment ' + updated.appointmentCode + ' was cancelled.');
    } catch (cause) {
      setError(cleanError(cause, 'Appointment could not be cancelled.'));
    } finally { setSaving(false); }
  }

  async function updateNotification(item: CustomerNotification, action: 'read' | 'unread' | 'dismiss') {
    setError(''); setSuccess('');
    try {
      await api<unknown>('/api/v1/customer/notifications/' + item.recipientPublicId + '/' + action, token, { method: 'POST' });
      const refreshed = await api<NotificationPage>('/api/v1/customer/notifications?page=0&pageSize=50', token);
      setNotifications(refreshed);
      setSuccess(action === 'dismiss' ? 'Update dismissed.' : action === 'read' ? 'Marked as read.' : 'Marked as unread.');
    } catch (cause) {
      setError(cleanError(cause, 'Update could not be changed.'));
    }
  }

  function onAppointmentDateChange(_event: DateTimePickerEvent, date?: Date) {
    setShowDatePicker(Platform.OS === 'ios');
    if (date) setAppointmentDate((current) => {
      const next = new Date(current);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }
  function onAppointmentTimeChange(_event: DateTimePickerEvent, date?: Date) {
    setShowTimePicker(Platform.OS === 'ios');
    if (date) setAppointmentDate((current) => {
      const next = new Date(current);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  if (booting) {
    return <View style={styles.centered}><ActivityIndicator size="large" color="#F27B38" /><Text style={styles.muted}>Opening your Lucky Bajaj account…</Text></View>;
  }

  if (!token) {
    return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <View pointerEvents="none" style={styles.glowWarm} />
      <View pointerEvents="none" style={styles.glowCool} />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandLockup}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>LB</Text></View>
          <View><Text style={styles.brandName}>LUCKY BAJAJ</Text><Text style={styles.brandCaption}>A QuantaEdge customer experience</Text></View>
        </View>
        <View style={styles.authIntro}>
          <Text style={styles.eyebrow}>CUSTOMER CARE, CONNECTED</Text>
          <Text style={styles.heroTitle}>Every ride deserves <Text style={styles.heroAccent}>better care.</Text></Text>
          <Text style={styles.heroSubtitle}>Your bikes, workshop visits and dealership updates, together in one clear place.</Text>
        </View>
        <GlassCard style={styles.authCard}>
          <View style={styles.authSwitch}>
            <Pressable onPress={() => { setAuthMode('login'); setError(''); }} style={[styles.authSwitchButton, authMode === 'login' && styles.authSwitchActive]}><Text style={[styles.authSwitchText, authMode === 'login' && styles.authSwitchTextActive]}>Sign in</Text></Pressable>
            <Pressable onPress={() => { setAuthMode('activate'); setError(''); }} style={[styles.authSwitchButton, authMode === 'activate' && styles.authSwitchActive]}><Text style={[styles.authSwitchText, authMode === 'activate' && styles.authSwitchTextActive]}>Activate account</Text></Pressable>
          </View>
          {authMode === 'login' ? <>
            <Field label="Dealership code" value={loginForm.dealershipCode} onChangeText={(value) => setLoginForm((old) => ({ ...old, dealershipCode: value }))} placeholder="Your dealership code" autoCapitalize="characters" />
            <Field label="Customer code" value={loginForm.customerCode} onChangeText={(value) => setLoginForm((old) => ({ ...old, customerCode: value }))} placeholder="Your customer code" autoCapitalize="characters" />
            <Field label="Password" value={loginForm.password} onChangeText={(value) => setLoginForm((old) => ({ ...old, password: value }))} placeholder="Enter your password" secureTextEntry />
            <PrimaryButton label={saving ? 'Signing in…' : 'Sign in securely'} onPress={() => void signIn()} disabled={saving || !loginForm.dealershipCode.trim() || !loginForm.customerCode.trim() || !loginForm.password} />
          </> : <>
            <Field label="One-time activation token" value={activationForm.activationToken} onChangeText={(value) => setActivationForm((old) => ({ ...old, activationToken: value }))} placeholder="Token provided by the dealership" autoCapitalize="none" />
            <Field label="Create password (12+ characters)" value={activationForm.password} onChangeText={(value) => setActivationForm((old) => ({ ...old, password: value }))} placeholder="Create a strong password" secureTextEntry />
            <Field label="Confirm password" value={activationForm.confirmPassword} onChangeText={(value) => setActivationForm((old) => ({ ...old, confirmPassword: value }))} placeholder="Repeat your password" secureTextEntry />
            <PrimaryButton label={saving ? 'Activating…' : 'Activate my account'} onPress={() => void activateAccount()} disabled={saving || activationForm.activationToken.trim().length < 8 || activationForm.password.length < 12 || !activationForm.confirmPassword} />
          </>}
          {error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}
          {success ? <Text accessibilityRole="alert" style={styles.successText}>{success}</Text> : null}
          <Text style={styles.securityNote}>Only vehicles and service records linked to your verified customer profile are shown.</Text>
        </GlassCard>
        <Text style={styles.footerNote}>PRIVATE CUSTOMER ACCESS  ·  POWERED BY QUANTAEDGE</Text>
      </ScrollView>
    </KeyboardAvoidingView>;
  }

  return <View style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <View pointerEvents="none" style={styles.glowWarm} />
    <View pointerEvents="none" style={styles.glowCool} />
    <View style={styles.topBar}>
      <View style={styles.brandMarkSmall}><Text style={styles.brandMarkText}>LB</Text></View>
      <View style={styles.topBarCopy}><Text style={styles.brandName}>LUCKY BAJAJ</Text><Text style={styles.brandCaption}>Customer care</Text></View>
      <Pressable onPress={() => void refreshData()} style={styles.iconButton}><Text style={styles.iconButtonText}>↻</Text></Pressable>
      <Pressable onPress={() => void signOut()} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.mainScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.greetingBlock}>
        <Text style={styles.eyebrow}>{customer?.dealershipName || 'LUCKY BAJAJ AGENCY'}</Text>
        <Text style={styles.greeting}>Hello, {customer?.fullName?.split(' ')[0] || 'there'}.</Text>
        <Text style={styles.greetingSub}>Your ride care, in one place.</Text>
      </View>
      {error ? <View style={styles.inlineError}><Text style={styles.errorText}>{error}</Text></View> : null}
      {success ? <View style={styles.inlineSuccess}><Text style={styles.successText}>{success}</Text></View> : null}
      {loadingData ? <View style={styles.loadingPanel}><ActivityIndicator color="#F27B38" /><Text style={styles.muted}>Syncing your customer records…</Text></View> : null}

      {!loadingData && tab === 'home' && <>
        <GlassCard style={styles.heroCard}>
          <Text style={styles.heroCardLabel}>YOUR CUSTOMER SPACE</Text>
          <Text style={styles.heroCardTitle}>More rides. Less worry.</Text>
          <Text style={styles.heroCardCopy}>Keep an eye on your bike, request workshop service and stay connected with your dealership.</Text>
          <PrimaryButton label="Request a service visit" onPress={() => setTab('appointments')} />
          <View style={styles.heroOrnament}><View style={styles.orbitLarge} /><View style={styles.orbitSmall} /><View style={styles.orbitDot} /></View>
        </GlassCard>
        <View style={styles.metricsRow}>
          <GlassCard style={styles.metric}><Text style={styles.metricNumber}>{vehicles.length}</Text><Text style={styles.metricLabel}>My bikes</Text></GlassCard>
          <GlassCard style={styles.metric}><Text style={styles.metricNumber}>{appointments.filter((item) => ['REQUESTED', 'CONFIRMED'].includes(item.status)).length}</Text><Text style={styles.metricLabel}>Open visits</Text></GlassCard>
          <GlassCard style={styles.metric}><Text style={styles.metricNumber}>{notifications.unreadCount}</Text><Text style={styles.metricLabel}>Unread updates</Text></GlassCard>
        </View>
        <GlassCard style={styles.contentCard}>
          <SectionHeading title="My bikes" subtitle="Vehicles linked to your customer record" action="View all" onAction={() => setTab('vehicles')} />
          {vehicles.length === 0 ? <EmptyText text="No bikes are linked to your account yet. Please contact the dealership to verify your customer record." /> : vehicles.slice(0, 3).map((vehicle) =>
            <VehicleRow vehicle={vehicle} key={vehicle.publicId} onPress={() => { setAppointmentVehicle(vehicle.publicId); setTab('appointments'); }} />)}
        </GlassCard>
        <GlassCard style={styles.contentCard}>
          <SectionHeading title="Next service visit" subtitle="Your upcoming workshop appointment" action="View visits" onAction={() => setTab('appointments')} />
          {nextAppointment ? <><Text style={styles.cardTitle}>{nextAppointment.modelName}{nextAppointment.variantName ? ' · ' + nextAppointment.variantName : ''}</Text><Text style={styles.cardDetail}>{quantityDate(nextAppointment.scheduledFor)}</Text><Text style={styles.bodyText}>{nextAppointment.customerConcern}</Text><StatusPill value={nextAppointment.status} /></> : <EmptyText text="No upcoming appointment. Request a service visit whenever your bike needs care." />}
        </GlassCard>
        <GlassCard style={styles.contentCard}>
          <SectionHeading title="Latest updates" subtitle="Messages from your dealership" action="Open inbox" onAction={() => setTab('notifications')} />
          {notifications.items.slice(0, 3).length === 0 ? <EmptyText text="Your dealership updates will appear here." /> : notifications.items.slice(0, 3).map((item) => <NotificationRow key={item.recipientPublicId} item={item} onRead={() => void updateNotification(item, item.readAt ? 'unread' : 'read')} onDismiss={() => void updateNotification(item, 'dismiss')} />)}
        </GlassCard>
      </>}

      {!loadingData && tab === 'vehicles' && <>
        <ScreenHeading title="My bikes" subtitle="Only vehicles linked to your verified customer profile are visible here." count={vehicles.length + ' linked'} />
        {vehicles.length === 0 ? <GlassCard><EmptyText text="No linked bikes found. Ask Lucky Bajaj to review your ownership record." /></GlassCard> : vehicles.map((vehicle) =>
          <GlassCard key={vehicle.publicId} style={styles.contentCard}><VehicleRow vehicle={vehicle} onPress={() => { setAppointmentVehicle(vehicle.publicId); setTab('appointments'); }} /><View style={styles.vehicleFacts}><Fact label="Chassis number" value={vehicle.chassisNumber} /><Fact label="Engine number" value={vehicle.engineNumber} /><Fact label="Linked since" value={quantityDate(vehicle.ownershipStartedAt)} /></View><PrimaryButton label="Book a service visit" onPress={() => { setAppointmentVehicle(vehicle.publicId); setTab('appointments'); }} /></GlassCard>)}
      </>}

      {!loadingData && tab === 'service' && <>
        <ScreenHeading title="Service history" subtitle="Track work recorded against your linked bikes." count={history.length + ' jobs'} />
        {history.length === 0 ? <GlassCard><EmptyText text="Your service history will appear after a workshop job is linked to your profile." /></GlassCard> : history.map((job) =>
          <GlassCard key={job.jobCardPublicId} style={styles.contentCard}>
            <View style={styles.rowBetween}><View style={styles.flexOne}><Text style={styles.eyebrow}>{job.jobCardCode}</Text><Text style={styles.cardTitle}>{job.modelName}{job.variantName ? ' · ' + job.variantName : ''}</Text></View><StatusPill value={job.status} /></View>
            <Text style={styles.bodyText}>{job.customerConcern}</Text>
            <View style={styles.timelineRow}><Fact label="Checked in" value={quantityDate(job.checkedInAt)} /><Fact label="Completed" value={quantityDate(job.completedAt)} /></View>
            <Fact label="Vehicle handover" value={quantityDate(job.deliveredAt)} />
            {job.invoiceNumber ? <View style={styles.invoiceBox}><Text style={styles.eyebrow}>OPERATIONAL INVOICE · {job.invoiceNumber}</Text><Text style={styles.invoiceTotal}>{money(job.invoiceTotal)}</Text><View style={styles.rowBetween}><Fact label="Recorded paid" value={money(job.paidAmount)} /><Fact label="Balance due" value={money(job.balanceDue)} /></View><Text style={styles.securityNote}>{job.invoiceNotice}</Text></View> : <Text style={styles.muted}>No issued operational invoice is recorded yet.</Text>}
          </GlassCard>)}
      </>}

      {!loadingData && tab === 'appointments' && <>
        <ScreenHeading title="Service visits" subtitle="Request a workshop appointment and follow its confirmation status." count={appointments.length + ' requests'} />
        <GlassCard style={styles.contentCard}>
          <Text style={styles.cardTitle}>Request a service visit</Text>
          {vehicles.length === 0 ? <EmptyText text="A bike must be linked to your customer account before a service appointment can be requested." /> : <>
            <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>Bike</Text><View style={styles.selectWrap}>{vehicles.map((vehicle) =>
              <Pressable key={vehicle.publicId} onPress={() => setAppointmentVehicle(vehicle.publicId)} style={[styles.vehicleSelect, appointmentVehicle === vehicle.publicId && styles.vehicleSelectActive]}><Text style={[styles.vehicleSelectTitle, appointmentVehicle === vehicle.publicId && styles.vehicleSelectTitleActive]}>{vehicle.modelName}{vehicle.variantName ? ' · ' + vehicle.variantName : ''}</Text><Text style={styles.vehicleSelectDetail}>Chassis ending {vehicle.chassisNumber.slice(-5)}</Text></Pressable>)}</View></View>
            <Text style={styles.fieldLabel}>Preferred date and time</Text>
            <View style={styles.dateRow}><Pressable style={styles.dateSelect} onPress={() => setShowDatePicker(true)}><Text style={styles.dateSelectLabel}>DATE</Text><Text style={styles.dateSelectValue}>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(appointmentDate)}</Text></Pressable><Pressable style={styles.dateSelect} onPress={() => setShowTimePicker(true)}><Text style={styles.dateSelectLabel}>TIME</Text><Text style={styles.dateSelectValue}>{new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(appointmentDate)}</Text></Pressable></View>
            {showDatePicker && <DateTimePicker value={appointmentDate} mode="date" minimumDate={new Date()} onChange={onAppointmentDateChange} />}
            {showTimePicker && <DateTimePicker value={appointmentDate} mode="time" onChange={onAppointmentTimeChange} />}
            <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>Expected visit length</Text><View style={styles.durationRow}>{['30', '45', '60', '90', '120'].map((value) => <Pressable key={value} onPress={() => setAppointmentDuration(value)} style={[styles.durationChip, appointmentDuration === value && styles.durationChipActive]}><Text style={[styles.durationChipText, appointmentDuration === value && styles.durationChipTextActive]}>{value}m</Text></Pressable>)}</View></View>
            <Field label="What does your bike need?" value={appointmentConcern} onChangeText={setAppointmentConcern} placeholder="Describe the issue or service needed" multiline />
            <PrimaryButton label={saving ? 'Submitting…' : 'Request appointment'} onPress={() => void submitAppointment()} disabled={saving || !appointmentConcern.trim()} />
          </>}
        </GlassCard>
        {appointments.length === 0 ? <GlassCard><EmptyText text="No appointments recorded yet." /></GlassCard> : appointments.map((item) =>
          <GlassCard key={item.publicId} style={styles.contentCard}>
            <View style={styles.rowBetween}><Text style={styles.eyebrow}>{item.appointmentCode}</Text><StatusPill value={item.status} /></View>
            <Text style={styles.cardTitle}>{item.modelName}{item.variantName ? ' · ' + item.variantName : ''}</Text>
            <Text style={styles.cardDetail}>{quantityDate(item.scheduledFor)} · {item.slotMinutes} minutes</Text>
            <Text style={styles.bodyText}>{item.customerConcern}</Text>
            {item.statusReason ? <Text style={styles.muted}>{item.statusReason}</Text> : null}
            {['REQUESTED', 'CONFIRMED'].includes(item.status) ? <><Field label="Cancellation reason" value={cancelReason} onChangeText={setCancelReason} placeholder="Reason for cancellation" /><SecondaryButton label="Cancel appointment" onPress={() => void cancelAppointment(item)} disabled={saving || !cancelReason.trim()} /></> : null}
          </GlassCard>)}
      </>}

      {!loadingData && tab === 'notifications' && <>
        <ScreenHeading title="Dealership updates" subtitle="Service reminders and messages shared with your customer account." count={notifications.unreadCount + ' unread'} />
        {notifications.items.length === 0 ? <GlassCard><EmptyText text="No notifications yet. Messages sent to your customer account will appear here." /></GlassCard> : notifications.items.map((item) =>
          <GlassCard key={item.recipientPublicId} style={styles.contentCard}><NotificationRow item={item} onRead={() => void updateNotification(item, item.readAt ? 'unread' : 'read')} onDismiss={() => void updateNotification(item, 'dismiss')} /></GlassCard>)}
      </>}
      <View style={styles.bottomNote}><Text style={styles.bottomNoteText}>YOUR DETAILS STAY WITH YOUR VERIFIED CUSTOMER RECORD</Text><Text style={styles.bottomNoteSub}>A QuantaEdge customer experience for Lucky Bajaj</Text></View>
    </ScrollView>
    <View style={styles.bottomNav}>{tabs.map((item) =>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} key={item.key} onPress={() => setTab(item.key)} style={[styles.bottomNavItem, tab === item.key && styles.bottomNavItemActive]}><Text style={[styles.bottomNavIcon, tab === item.key && styles.bottomNavIconActive]}>{item.icon}</Text><Text style={[styles.bottomNavLabel, tab === item.key && styles.bottomNavLabelActive]}>{item.label}</Text>{item.key === 'notifications' && notifications.unreadCount > 0 ? <View style={styles.unreadDot} /> : null}</Pressable>)}</View>
  </View>;
}

function ScreenHeading({ title, subtitle, count }: { title: string; subtitle: string; count: string }) {
  return <View style={styles.screenHeading}><View style={styles.flexOne}><Text style={styles.screenTitle}>{title}</Text><Text style={styles.screenSubtitle}>{subtitle}</Text></View><View style={styles.countPill}><Text style={styles.countPillText}>{count}</Text></View></View>;
}
function SectionHeading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action: string; onAction: () => void }) {
  return <View style={styles.sectionHeading}><View style={styles.flexOne}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View><Pressable onPress={onAction}><Text style={styles.linkText}>{action} ↗</Text></Pressable></View>;
}
function VehicleRow({ vehicle, onPress }: { vehicle: Vehicle; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.vehicleRow, pressed && styles.rowPressed]}>
    <View style={styles.bikeBadge}><Text style={styles.bikeBadgeText}>LB</Text></View>
    <View style={styles.flexOne}><Text style={styles.vehicleName}>{vehicle.modelName}{vehicle.variantName ? ' · ' + vehicle.variantName : ''}</Text><Text style={styles.vehicleMeta}>{vehicle.colourName || 'Colour not recorded'}{vehicle.modelYear ? ' · ' + vehicle.modelYear : ''}</Text><Text style={styles.vehicleChassis}>Chassis ending {vehicle.chassisNumber.slice(-5)}</Text></View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}
function NotificationRow({ item, onRead, onDismiss }: { item: CustomerNotification; onRead: () => void; onDismiss: () => void }) {
  return <View style={styles.notificationRow}>
    <View style={[styles.notificationIcon, !item.readAt && styles.notificationIconUnread]}><Text style={styles.notificationIconText}>✧</Text></View>
    <View style={styles.flexOne}><View style={styles.rowBetween}><Text style={styles.notificationTitle}>{item.title}</Text>{!item.readAt ? <View style={styles.unreadPill}><Text style={styles.unreadPillText}>NEW</Text></View> : null}</View><Text style={styles.notificationSummary}>{item.summary}</Text><Text style={styles.notificationMeta}>{item.senderName} · {quantityDate(item.createdAt)}</Text><View style={styles.notificationActions}><Pressable onPress={onRead}><Text style={styles.linkText}>{item.readAt ? 'Mark unread' : 'Mark read'}</Text></Pressable><Pressable onPress={onDismiss}><Text style={styles.dismissText}>Dismiss</Text></Pressable></View></View>
  </View>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}
function EmptyText({ text }: { text: string }) {
  return <View style={styles.emptyState}><View style={styles.emptyGlyph}><Text style={styles.emptyGlyphText}>◈</Text></View><Text style={styles.emptyText}>{text}</Text></View>;
}
function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.secondaryButton, disabled && styles.disabledButton]}><Text style={styles.secondaryButtonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EEF3FA' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#EEF3FA' },
  authScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingTop: 38, paddingBottom: 30 },
  mainScroll: { paddingHorizontal: 17, paddingTop: 15, paddingBottom: 24 },
  glowWarm: { position: 'absolute', top: -100, right: -90, width: 270, height: 270, borderRadius: 150, backgroundColor: 'rgba(255,179,126,0.24)' },
  glowCool: { position: 'absolute', top: 220, left: -140, width: 300, height: 300, borderRadius: 160, backgroundColor: 'rgba(136,183,246,0.18)' },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 38 },
  brandMark: { width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.86)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', shadowColor: '#71829A', shadowOpacity: 0.13, shadowRadius: 12, elevation: 3 },
  brandMarkSmall: { width: 37, height: 37, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#71829A', shadowOpacity: 0.1, shadowRadius: 9, elevation: 2 },
  brandMarkText: { color: '#D96525', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  brandName: { fontSize: 11, letterSpacing: 1.6, fontWeight: '900', color: '#26354D' },
  brandCaption: { marginTop: 4, fontSize: 9, color: '#8390A3', letterSpacing: 0.25 },
  authIntro: { marginBottom: 24 },
  eyebrow: { fontSize: 9, color: '#B65F2C', fontWeight: '800', letterSpacing: 1.35, marginBottom: 9 },
  heroTitle: { color: '#25344D', fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1.3, maxWidth: 350 },
  heroAccent: { color: '#E77739' },
  heroSubtitle: { color: '#75849A', fontSize: 13, lineHeight: 21, marginTop: 12, maxWidth: 360 },
  glassCard: { backgroundColor: 'rgba(255,255,255,0.78)', borderWidth: 1, borderTopColor: 'rgba(255,255,255,0.98)', borderLeftColor: 'rgba(255,255,255,0.96)', borderRightColor: 'rgba(220,230,242,0.85)', borderBottomColor: 'rgba(211,223,238,0.78)', borderRadius: 21, padding: 17, marginBottom: 13, shadowColor: '#61738F', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 17, elevation: 2, overflow: 'hidden' },
  authCard: { padding: 19 },
  authSwitch: { flexDirection: 'row', padding: 4, backgroundColor: 'rgba(226,233,244,0.72)', borderRadius: 11, marginBottom: 19 },
  authSwitchButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  authSwitchActive: { backgroundColor: 'rgba(255,255,255,0.95)', borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#64748B', shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  authSwitchText: { color: '#8490A3', fontSize: 11, fontWeight: '700' },
  authSwitchTextActive: { color: '#34435C' },
  fieldWrap: { marginBottom: 13, gap: 7 },
  fieldLabel: { color: '#606F85', fontSize: 10, fontWeight: '800' },
  input: { minHeight: 45, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(203,215,232,0.9)', backgroundColor: 'rgba(255,255,255,0.87)', color: '#293A52', fontSize: 12 },
  multilineInput: { minHeight: 88, paddingTop: 12 },
  primaryButton: { minHeight: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 11, backgroundColor: '#EB7837', paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#C95E23', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 8, elevation: 2, marginTop: 6 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  secondaryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#D9E2EF', backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 13, paddingVertical: 10, marginTop: 10 },
  secondaryButtonText: { color: '#54637B', fontSize: 10, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  securityNote: { color: '#8B96A8', fontSize: 9, lineHeight: 16, marginTop: 14 },
  footerNote: { color: '#98A3B2', textAlign: 'center', fontSize: 8, letterSpacing: 1.1, marginTop: 20 },
  pageTopSpacer: { height: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 17, paddingTop: Platform.OS === 'android' ? 10 : 15, paddingBottom: 10, gap: 9, backgroundColor: 'rgba(255,255,255,0.72)', borderBottomColor: 'rgba(255,255,255,0.9)', borderBottomWidth: 1 },
  topBarCopy: { flex: 1 },
  iconButton: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DCE5F0', backgroundColor: 'rgba(255,255,255,0.75)' },
  iconButtonText: { color: '#65758D', fontSize: 20 },
  signOutButton: { paddingVertical: 10, paddingHorizontal: 11, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.66)', borderWidth: 1, borderColor: '#E0E7F0' },
  signOutText: { color: '#647189', fontSize: 9, fontWeight: '800' },
  greetingBlock: { marginBottom: 17, paddingTop: 5 },
  greeting: { color: '#26364F', fontSize: 28, letterSpacing: -0.9, fontWeight: '800' },
  greetingSub: { color: '#8793A5', fontSize: 11, marginTop: 6 },
  heroCard: { backgroundColor: 'rgba(255,255,255,0.68)', minHeight: 190, padding: 20 },
  heroCardLabel: { color: '#B45C29', fontSize: 8, fontWeight: '900', letterSpacing: 1.6 },
  heroCardTitle: { color: '#26354E', fontSize: 25, fontWeight: '800', letterSpacing: -0.7, marginTop: 11, maxWidth: 250 },
  heroCardCopy: { color: '#718096', fontSize: 10, lineHeight: 17, maxWidth: 260, marginTop: 8, marginBottom: 8 },
  heroOrnament: { position: 'absolute', right: -22, top: 24, width: 130, height: 130, opacity: 0.8 },
  orbitLarge: { position: 'absolute', width: 117, height: 117, borderRadius: 60, borderWidth: 1, borderColor: 'rgba(232,132,75,0.24)', right: 0, top: 0 },
  orbitSmall: { position: 'absolute', width: 82, height: 82, borderRadius: 45, borderWidth: 1, borderColor: 'rgba(111,161,218,0.35)', right: 22, top: 20 },
  orbitDot: { position: 'absolute', width: 14, height: 14, borderRadius: 8, backgroundColor: 'rgba(239,133,71,0.45)', right: 40, top: 42 },
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  metric: { flex: 1, padding: 13, borderRadius: 16, alignItems: 'flex-start' },
  metricNumber: { color: '#273851', fontSize: 22, fontWeight: '800', letterSpacing: -0.7 },
  metricLabel: { color: '#8792A4', fontSize: 8, marginTop: 4, lineHeight: 12 },
  contentCard: { padding: 15 },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 13 },
  sectionTitle: { color: '#33425A', fontSize: 12, fontWeight: '800' },
  sectionSubtitle: { color: '#8995A7', fontSize: 8, marginTop: 4, lineHeight: 13 },
  linkText: { color: '#C7652D', fontSize: 9, fontWeight: '800' },
  flexOne: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10, borderBottomWidth: 1, borderBottomColor: '#EDF0F5' },
  rowPressed: { opacity: 0.7 },
  bikeBadge: { width: 41, height: 41, borderRadius: 13, borderWidth: 1, borderColor: '#FFFFFF', backgroundColor: 'rgba(240,245,252,0.85)', alignItems: 'center', justifyContent: 'center' },
  bikeBadgeText: { color: '#D56930', fontSize: 11, fontWeight: '900' },
  vehicleName: { color: '#3A4961', fontSize: 10, fontWeight: '800' },
  vehicleMeta: { color: '#808CA0', fontSize: 8, marginTop: 4 },
  vehicleChassis: { color: '#9AA4B2', fontSize: 7, marginTop: 4 },
  chevron: { color: '#AFB8C5', fontSize: 24 },
  statusPill: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  statusOkay: { backgroundColor: 'rgba(227,247,235,0.86)', borderColor: '#CCEAD8' },
  statusWarning: { backgroundColor: 'rgba(255,243,220,0.9)', borderColor: '#F4DFC0' },
  statusNeutral: { backgroundColor: 'rgba(235,240,247,0.9)', borderColor: '#DFE6F0' },
  statusText: { fontSize: 8, fontWeight: '800' },
  statusOkayText: { color: '#1A7B4D' },
  statusWarningText: { color: '#9C631C' },
  statusNeutralText: { color: '#64738B' },
  cardTitle: { color: '#35445C', fontSize: 11, fontWeight: '800', marginTop: 2 },
  cardDetail: { color: '#8491A4', fontSize: 9, marginTop: 7 },
  bodyText: { color: '#69788F', fontSize: 10, lineHeight: 16, marginTop: 8, marginBottom: 7 },
  vehicleFacts: { marginBottom: 10 },
  fact: { flex: 1, minWidth: 0, marginTop: 10, paddingRight: 8 },
  factLabel: { color: '#919BAC', fontSize: 8, marginBottom: 4 },
  factValue: { color: '#52627B', fontSize: 9, fontWeight: '700', lineHeight: 14 },
  timelineRow: { flexDirection: 'row', gap: 6 },
  invoiceBox: { marginTop: 12, padding: 12, backgroundColor: 'rgba(247,250,254,0.85)', borderWidth: 1, borderColor: '#E5EAF1', borderRadius: 12 },

  muted: { color: '#8A96A7', fontSize: 10, lineHeight: 17, marginTop: 8 },
  screenHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 16, marginTop: 5 },
  screenTitle: { color: '#293951', fontSize: 24, lineHeight: 29, letterSpacing: -0.7, fontWeight: '800' },
  screenSubtitle: { color: '#8491A4', fontSize: 10, lineHeight: 16, marginTop: 5 },
  countPill: { backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: '#E4EAF2', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 8 },
  countPillText: { color: '#64728A', fontSize: 8, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 12 },
  emptyGlyph: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(238,243,250,0.9)', alignItems: 'center', justifyContent: 'center' },
  emptyGlyphText: { color: '#C96B36', fontSize: 15 },
  emptyText: { color: '#8A96A7', fontSize: 9, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  vehicleSelect: { borderWidth: 1, borderColor: '#DFE6F0', backgroundColor: 'rgba(255,255,255,0.74)', borderRadius: 10, padding: 10, marginTop: 6 },
  vehicleSelectActive: { borderColor: '#F3B389', backgroundColor: 'rgba(255,243,233,0.9)' },
  vehicleSelectTitle: { color: '#5F6E84', fontSize: 9, fontWeight: '700' },
  vehicleSelectTitleActive: { color: '#B45B26' },
  vehicleSelectDetail: { color: '#98A2B1', fontSize: 7, marginTop: 4 },
  selectWrap: { marginBottom: 10 },
  dateRow: { flexDirection: 'row', gap: 8, marginTop: 7, marginBottom: 12 },
  dateSelect: { flex: 1, padding: 11, borderWidth: 1, borderRadius: 10, borderColor: '#DDE5EF', backgroundColor: 'rgba(255,255,255,0.82)' },
  dateSelectLabel: { color: '#9AA4B2', fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  dateSelectValue: { color: '#52627A', fontSize: 10, fontWeight: '800', marginTop: 6 },
  durationRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  durationChip: { borderRadius: 8, borderWidth: 1, borderColor: '#E0E6EF', backgroundColor: 'rgba(255,255,255,0.75)', paddingVertical: 8, paddingHorizontal: 11 },
  durationChipActive: { borderColor: '#F1B187', backgroundColor: '#FFF0E3' },
  durationChipText: { color: '#8B96A7', fontSize: 9, fontWeight: '700' },
  durationChipTextActive: { color: '#B95E2C' },
  notificationRow: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#EDF0F5' },
  notificationIcon: { width: 31, height: 31, borderRadius: 11, backgroundColor: '#F2F5F9', alignItems: 'center', justifyContent: 'center' },
  notificationIconUnread: { backgroundColor: '#FFF0E3' },
  notificationIconText: { color: '#B65F2C', fontSize: 14 },
  notificationTitle: { color: '#36455D', fontSize: 10, fontWeight: '800', flex: 1 },
  notificationSummary: { color: '#738198', fontSize: 9, lineHeight: 15, marginTop: 5 },
  notificationMeta: { color: '#9AA4B2', fontSize: 7, marginTop: 5 },
  notificationActions: { flexDirection: 'row', gap: 18, marginTop: 9 },
  dismissText: { color: '#9A7171', fontSize: 9, fontWeight: '700' },
  unreadPill: { backgroundColor: '#FFE8D4', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  unreadPillText: { color: '#BA5C22', fontSize: 7, fontWeight: '900' },
  inlineError: { padding: 10, backgroundColor: '#FFF1F0', borderColor: '#F3D3D0', borderWidth: 1, borderRadius: 10, marginBottom: 10 },
  inlineSuccess: { padding: 10, backgroundColor: '#EDF9F1', borderColor: '#CDEBD8', borderWidth: 1, borderRadius: 10, marginBottom: 10 },
  errorText: { color: '#B4433B', fontSize: 9, lineHeight: 16, marginTop: 5 },
  successText: { color: '#19784C', fontSize: 9, lineHeight: 16, marginTop: 5 },

  invoiceTotal: { color: '#31415A', fontSize: 22, fontWeight: '800', marginBottom: 6 },
  bottomNote: { alignItems: 'center', paddingVertical: 18, gap: 5 },
  bottomNoteText: { color: '#96A1B0', fontSize: 7, letterSpacing: 1.1, fontWeight: '800', textAlign: 'center' },
  bottomNoteSub: { color: '#A5AEBA', fontSize: 8 },
  bottomNav: { flexDirection: 'row', paddingTop: 7, paddingBottom: Platform.OS === 'android' ? 8 : 17, paddingHorizontal: 4, backgroundColor: 'rgba(255,255,255,0.84)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.95)' },
  bottomNavItem: { flex: 1, minHeight: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 2 },
  bottomNavItemActive: { backgroundColor: 'rgba(255,237,222,0.78)' },
  bottomNavIcon: { fontSize: 17, color: '#97A1B0' },
  bottomNavIconActive: { color: '#D76B32' },
  bottomNavLabel: { color: '#8692A5', fontSize: 7, fontWeight: '700' },
  bottomNavLabelActive: { color: '#B95E2C' },
  unreadDot: { position: 'absolute', top: 2, right: 17, width: 6, height: 6, borderRadius: 4, backgroundColor: '#E8753B' },
});
