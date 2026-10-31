import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, Image, KeyboardAvoidingView, Linking, Platform, Pressable,
  RefreshControl, SafeAreaView, ScrollView, Share, StatusBar, Text, TextInput,
  useWindowDimensions, View, type StyleProp, type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { EditionBackdrop, EditionContentTarget, GlassOverlay } from './GlassEffects';
import { C, S } from './theme';

WebBrowser.maybeCompleteAuthSession();

const API_BASE_URL = String(Constants.expoConfig?.extra?.apiBaseUrl || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://lucky-bajaj-api.onrender.com/').trim().replace(/\/+$/, '');
const CUSTOMER_WEB_URL = String(Constants.expoConfig?.extra?.customerWebUrl || process.env.EXPO_PUBLIC_CUSTOMER_WEB_URL || 'https://lucky-bajaj-customer-web.onrender.com').trim().replace(/\/+$/, '');
const PARTS_CART_KEY_PREFIX = 'lucky_bajaj_parts_cart_v1:';
const TOKEN_KEY = 'lucky_bajaj_customer_access_token';
const PENDING_KEY = 'lucky_bajaj_pending_showroom_intent';

type Screen = 'showroom' | 'bike' | 'signin' | 'signup' | 'home' | 'garage' | 'service' | 'appointments' | 'profile' | 'addresses' | 'purchases' | 'requests' | 'parts' | 'cart' | 'updates' | 'more' | 'privacy' | 'terms';
type Action = 'TEST_RIDE' | 'PURCHASE';
type Customer = { publicId: string; customerCode: string; fullName: string; phone: string | null; alternatePhone?: string | null; email: string | null; preferredLanguage: 'hi' | 'en' | 'hinglish'; profilePhotoAvailable?: boolean; dealershipCode: string; dealershipName: string };
type Session = { accessToken: string; expiresAt: string; customer: Customer };
type Bike = { manufacturer: string; modelCode: string; modelName: string; family: string; category: string; engineCc: number; maxPower: string; maxTorque: string; gearbox: string | null; braking: string | null; frontSuspension: string | null; rearSuspension: string | null; fuelTankLitres: number | null; groundClearanceMm: number | null; kerbWeightKg: number | null; rideCharacter: string; highlights: string[]; heroImageUrl: string; officialModelUrl: string; officialSpecsUrl: string; exShowroomPrice: number | null; priceCity: string; priceSourceUrl: string; priceVerifiedAt: string | null; inventoryModelPublicId: string | null; availableUnits: number; expectedUnits: number; reservedUnits: number; availabilityStatus: string; expectedAvailableOn: string | null };
type Catalogue = { manufacturer: string; dealershipCode: string | null; dealershipName: string | null; priceReferenceCity: string; servedAt: string; bikes: Bike[] };
type OnRoadQuote = { quoteType: 'ESTIMATE'; modelCode: string; modelName: string; city: string; state: string; calculatedFor: string; effectiveFrom: string; effectiveTo: string | null; breakdown: Array<{ label: string; amount: number; calculation: string }>; estimatedOnRoadTotal: number; sourceUrl: string; note: string | null; disclaimer: string };
type Promotion = { publicId: string; modelCode: string | null; modelName: string | null; title: string; summary: string; terms: string | null; startsOn: string; endsOn: string | null; sourceUrl: string; published: boolean; disclaimer: string };
type Vehicle = { publicId: string; modelName: string; variantName: string | null; colourName: string | null; modelYear: number | null; chassisNumber: string; engineNumber: string; ownershipStartedAt: string };
type Service = { jobCardPublicId: string; jobCardCode: string; status: string; customerConcern: string; modelName: string; variantName: string | null; colourName: string | null; chassisNumber: string; checkedInAt: string; completedAt: string | null; deliveredAt: string | null; invoiceNumber: string | null; invoiceStatus: string | null; invoiceIssuedAt: string | null; invoiceTotal: number; paidAmount: number; balanceDue: number; invoiceNotice: string };
type Appointment = { publicId: string; appointmentCode: string; vehiclePublicId: string; modelName: string; variantName: string | null; colourName: string | null; chassisNumber: string; scheduledFor: string; slotMinutes: number; customerConcern: string; customerLanguage: string; source: string; status: string; statusReason: string | null; checkedInAt: string | null; createdAt: string; updatedAt: string };
type Notice = { recipientPublicId: string; campaignPublicId: string; title: string; summary: string; contentDocumentJson: string; senderName: string; status: string; createdAt: string; readAt: string | null };
type NoticePage = { items: Notice[]; page: number; pageSize: number; total: number; unreadCount: number };
type SalesRequest = { publicId: string; requestCode: string; requestType: Action; modelCode: string; modelName: string; preferredAt: string | null; notes: string | null; status: string; createdAt: string; updatedAt: string; enquiryCode: string | null; enquiryStatus: string | null; testRideCode: string | null; testRideStatus: string | null; testRideScheduledStart: string | null; bookingCode: string | null; bookingStatus: string | null; invoiceNumber: string | null; invoiceStatus: string | null; invoiceTotal: number | null; paidAmount: number; creditedAmount: number | null; balanceDue: number | null; deliveredAt: string | null };
type Address = { publicId: string; label: 'HOME' | 'WORK' | 'OTHER'; recipientName: string; phone: string; addressLine1: string; addressLine2: string | null; landmark: string | null; locality: string | null; city: string; district: string | null; state: string; postalCode: string; country: string; isDefaultDelivery: boolean; createdAt: string; updatedAt: string };
type AddressDraft = { label: Address['label']; recipientName: string; phone: string; addressLine1: string; addressLine2: string; landmark: string; locality: string; city: string; district: string; state: string; postalCode: string; country: string; isDefaultDelivery: boolean };
type Purchase = { publicId: string; invoiceNumber: string; modelName: string; variantName: string | null; colourName: string | null; modelYear: number | null; invoiceTotal: number; paidAmount: number; creditedAmount: number; balanceDue: number; invoiceIssuedAt: string | null; deliveredAt: string; deliveredToName: string };
type Part = { publicId: string; skuCode: string; partName: string; description: string | null; unitOfMeasure: string; retailPrice: number | null; fitmentModelCodes: string[]; imageUrl: string | null; quantityAvailable: number; available: boolean; availabilityStatus: string; fitmentVerified: boolean; category: string; partNumber: string | null; sourceUrl: string | null; sourceVerifiedAt: string | null; sourceDataStatus: string };
type PartFilters = { categories: string[]; motorcycleModels: Array<{ modelCode: string; modelName: string; family: string; category: string }> };
type OrderLine = { partPublicId: string; skuCode: string; partName: string; unitOfMeasure: string; quantity: number; unitPrice: number; lineTotal: number };
type RetailOrder = { publicId: string; orderCode: string; status: string; paymentMethod: string; paymentStatus: string; orderTotal: number; fulfillmentMethod: 'PICKUP' | 'DELIVERY'; deliveryAddress: string | null; deliveryFee: number; deliveryQuoteStatus: string; deliveryQuoteNote: string | null; deliveryQuotedAt: string | null; customerNote: string | null; createdAt: string; updatedAt: string; cancelledAt: string | null; fulfilledAt: string | null; returnedAt: string | null; returnReason: string | null; restockedOnReturn: boolean | null; lines: OrderLine[] };
type CartLine = { partPublicId: string; quantity: number };
type Intent = { action: Action; modelCode: string; modelName: string; selectedAt: string; idempotencyKey: string; preferredAt: string | null };
type ProfileDraft = { fullName: string; phone: string; alternatePhone: string; email: string; preferredLanguage: Customer['preferredLanguage'] };
const PRIVACY_SECTIONS = [
  { title: 'Information used by the customer app', paragraphs: [
    'Depending on the features you use, this may include your name and contact details, customer code or username, dealership association, linked motorcycle and vehicle identifiers, service history, appointment requests, sales or test-ride enquiries, spare-parts orders and customer notifications.',
    'Information may be supplied by you, recorded by authorised Lucky Bajaj Agency staff, or created when you use a customer-portal feature.',
  ]},
  { title: 'How the information is used', paragraphs: [
    'The app uses these records to verify your access, show the customer information linked to your account, handle vehicle and service enquiries, manage appointments and spare-parts requests, send relevant updates, protect the service and maintain operational records.',
  ]},
  { title: 'Access and service providers', paragraphs: [
    'Your customer records are intended for Lucky Bajaj Agency workflows and are available to dealership staff according to their access permissions. QuantaEdge provides the software that operates this customer app. When you choose Google sign-in, Google processes the sign-in interaction and provides the verified identity information used by the login flow.',
    'Links to Bajaj Auto or other third-party websites open services operated by those parties and are governed by their own policies.',
  ]},
  { title: 'Sessions and record retention', paragraphs: [
    'The app stores the customer access token in secure device storage and sends it only with authenticated requests to the Lucky Bajaj API. Customer, vehicle, service and transaction-related records are stored by the application on behalf of the dealership and are retained as needed for customer service, operational records and applicable legal obligations.',
  ]},
  { title: 'Your questions and requests', paragraphs: [
    'For a question about your information or to request access or correction, contact Lucky Bajaj Agency through the dealership channel that manages your customer or service record. Please do not send your password, sign-in code or Google authentication credentials when asking for help.',
  ]},
  { title: 'Updates', paragraphs: [
    'This notice describes the Lucky Bajaj customer app and its currently implemented features. It may be updated when the service or applicable requirements change. Check this page for the latest version.',
  ]},
];
const TERMS_SECTIONS = [
  { title: 'Catalogue, specifications and prices', paragraphs: [
    'Motorcycle specifications, images, offers and reference prices are provided to help you explore the Bajaj range. Manufacturer sources, verification dates and price notes are shown where available. Reference prices and location-based on-road estimates are not a final dealer quotation; the dealership must confirm the applicable model, variant, location, charges, offer terms and current price.',
  ]},
  { title: 'Enquiries and test rides', paragraphs: [
    'Submitting a purchase enquiry or test-ride request sends a request to Lucky Bajaj Agency. It does not reserve a physical motorcycle, confirm stock, book a test-ride slot or complete a sale. The dealership will review availability and confirm the next steps.',
  ]},
  { title: 'Customer portal and service records', paragraphs: [
    'Use the account assigned or activated for you and keep your sign-in details private. The portal displays customer and vehicle records linked to your authenticated account. If a record appears incorrect, ask the dealership to review its source record.',
  ]},
  { title: 'Spare parts and fulfilment', paragraphs: [
    'Parts availability, pricing, delivery charges and fulfilment arrangements are subject to dealership confirmation. If a delivery quote is presented, review and accept it before the order can proceed through the applicable fulfilment flow. A request or status displayed by the website is not, by itself, proof that an external payment has been collected or verified.',
  ]},
  { title: 'External links and availability', paragraphs: [
    'Links to manufacturer information and other external sites are provided for convenience; the destination site controls its own content and terms. Catalogue content and website features can change as dealership records and official sources are updated.',
  ]},
  { title: 'Questions', paragraphs: [
    'For help with a request, vehicle record, service appointment or order, contact Lucky Bajaj Agency through the dealership channel handling that request. These terms do not remove rights that apply under relevant law.',
  ]},
];
function NotificationContent({ raw, token, onNavigate }: { raw: string; token: string; onNavigate: (screen: Screen) => void }) {
  let blocks: Array<Record<string, unknown>> = [];
  try {
    const doc = JSON.parse(raw || '{}') as { version?: unknown; blocks?: unknown; content?: unknown };
    const source = Array.isArray(doc.blocks) ? doc.blocks : Array.isArray(doc.content) ? doc.content : [];
    blocks = source.filter((block): block is Record<string, unknown> => typeof block === 'object' && block !== null);
  } catch { return <Text style={S.meta}>This update contains a message from the dealership.</Text>; }

  const textOf = (block: Record<string, unknown>, key: string, fallback = '') =>
    typeof block[key] === 'string' ? String(block[key]) : fallback;
  const imageFor = (block: Record<string, unknown>, key: string, height = 180) => {
    const assetId = textOf(block, 'assetId').trim();
    if (!assetId || !token) return null;
    return <Image
      accessible
      accessibilityLabel={textOf(block, 'alt', textOf(block, 'title', 'Dealership image'))}
      source={{
        uri: path('/api/v1/customer/notifications/media/' + encodeURIComponent(assetId)),
        headers: { Authorization: 'Bearer ' + token },
      }}
      resizeMode="cover"
      style={{ width: '100%', height, borderRadius: 12, backgroundColor: C.canvas }}
    />;
  };
  const resolveTarget = (value: string): (() => void) | null => {
    const target = value.trim();
    if (!target) return null;
    if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
      && !target.split('/').some(segment => segment === '..')) {
      const routePath = (target.split(/[?#]/, 1)[0] || '/').replace(/\/+$/, '') || '/';
      const routes: Record<string, Screen> = {
        '/': 'home',
        '/home': 'home',
        '/vehicles': 'garage',
        '/garage': 'garage',
        '/service-history': 'service',
        '/service': 'service',
        '/appointments': 'appointments',
        '/profile': 'profile',
        '/addresses': 'addresses',
        '/purchases': 'purchases',
        '/orders': 'purchases',
        '/requests': 'requests',
        '/test-rides': 'requests',
        '/parts': 'parts',
        '/cart': 'cart',
        '/notifications': 'updates',
        '/updates': 'updates',
      };
      const route = routes[routePath];
      return route ? () => onNavigate(route) : null;
    }
    try {
      const url = new URL(target);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        return () => { void Linking.openURL(url.toString()).catch(() => undefined); };
      }
    } catch { /* Unsupported destination: never pass an unsafe URL to Linking. */ }
    return null;
  };

  const renderBlocks = (items: Array<Record<string, unknown>>, parentKey = 'notice'): ReactNode[] =>
    items.map((block, index) => {
      const key = parentKey + '-' + index;
      const type = String(block.type || '');
      const text = (name: string, fallback = '') => textOf(block, name, fallback);
      const action = resolveTarget(text('target'));
      const childrenSource = Array.isArray(block.blocks) ? block.blocks : Array.isArray(block.items) ? block.items : [];
      const children = childrenSource.filter((item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null);

      if (type === 'hero') return <View key={key} style={S.innerCard}>
        {text('eyebrow') ? <Text style={S.eyebrow}>{text('eyebrow')}</Text> : null}
        {imageFor(block, key, 190)}
        <Text style={S.cardTitle}>{text('title', 'Your dealership update')}</Text>
        {text('subtitle') ? <Text style={S.body}>{text('subtitle')}</Text> : null}
      </View>;
      if (type === 'richText' || ['paragraph', 'text', 'heading', 'title', 'quote', 'listItem'].includes(type)) {
        const body = text('text') || text('body');
        if (!body) return null;
        return <Text key={key} style={type === 'heading' || type === 'title' ? S.cardTitle : S.body}>{body}</Text>;
      }
      if (type === 'image' || type === 'animation') return <View key={key} style={S.innerCard}>
        {imageFor(block, key, 200) || <Text style={S.meta}>Image will appear when it is available to your customer account.</Text>}
        {text('caption') ? <Text style={S.meta}>{text('caption')}</Text> : null}
      </View>;
      if (type === 'video') return <View key={key} style={S.innerCard}>
        <Text style={S.meta}>{text('caption') || 'Video content is not available in this app version.'}</Text>
      </View>;
      if (type === 'serviceCard' || type === 'vehicleCard' || type === 'courseCard' || type === 'eventCard') {
        const title = text('title', text('modelName', text('courseName', 'Details')));
        return <View key={key} style={S.innerCard}>
          <Text style={S.eyebrow}>{type === 'vehicleCard' ? 'VEHICLE' : type === 'serviceCard' ? 'SERVICE UPDATE' : type === 'eventCard' ? 'APPOINTMENT' : 'DETAILS'}</Text>
          <Text style={S.cardTitle}>{title}</Text>
          {text('description') ? <Text style={S.body}>{text('description')}</Text> : null}
          {text('buttonLabel') && action ? <Button small secondary label={text('buttonLabel')} onPress={action}/> : null}
        </View>;
      }
      if (type === 'cta') return action
        ? <Button key={key} label={text('label', 'Open details')} onPress={action}/>
        : null;
      if (type === 'button') {
        const buttonAction = resolveTarget(text('url'));
        return buttonAction ? <Button key={key} small secondary label={text('text', 'Open update link')} onPress={buttonAction}/> : null;
      }
      if (type === 'highlight') return <View key={key} style={S.innerCard}>
        <Text style={S.meta}>{text('label')}</Text>
        <Text style={S.price}>{text('value')}</Text>
        {text('description') ? <Text style={S.body}>{text('description')}</Text> : null}
      </View>;
      if (type === 'badge') return <Pill key={key} label={text('text', 'Dealership update')} tone="warning"/>;
      if (type === 'icon') return <View key={key} style={S.innerCard}>
        <Text style={S.cardTitle}>{[text('icon'), text('title')].filter(Boolean).join(' ')}</Text>
        {text('text') ? <Text style={S.body}>{text('text')}</Text> : null}
      </View>;
      if (type === 'spacer') {
        const height = Math.min(96, Math.max(4, Number(block.height) || 16));
        return <View key={key} style={{ height }}/>;
      }
      if (type === 'divider') return <View key={key} style={{ height: 1, backgroundColor: C.border, marginVertical: 4 }}/>;
      if (type === 'footer') return <Text key={key} style={S.meta}>{text('text')}</Text>;
      if (type === 'container' || type === 'carousel') return <View key={key} style={S.innerCard}>
        <View style={{ gap: 8 }}>{renderBlocks(children, key)}</View>
      </View>;
      return <Text key={key} style={S.meta}>This update contains a content type that this app version cannot display.</Text>;
    });

  return <View style={{ gap: 8 }}>{renderBlocks(blocks)}</View>;
}
function LegalScreen({ kind, onNavigate }: { kind: 'privacy' | 'terms'; onNavigate: (screen: Screen) => void }) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;
  return <Card>
    <Text style={S.eyebrow}>LUCKY BAJAJ AGENCY · CUSTOMER APP</Text>
    <Heading title={isPrivacy ? 'Privacy policy' : 'Terms & conditions'} subtitle="Customer app information · Updated 30 October 2026"/>
    <Text style={S.body}>{isPrivacy
      ? 'This page explains the customer information used when you browse the Lucky Bajaj showroom or use its customer portal. Lucky Bajaj Agency operates the dealership workflows; QuantaEdge provides the software.'
      : 'These terms explain the limits of the public catalogue and the request-based customer features provided through the Lucky Bajaj Android app.'}</Text>
    {sections.map(section => <View key={section.title} style={{ gap: 7, paddingTop: 10 }}>
      <Text style={S.cardTitle}>{section.title}</Text>
      {section.paragraphs.map(paragraph => <Text key={paragraph} style={S.body}>{paragraph}</Text>)}
    </View>)}
    <View style={S.wrapRow}>
      <Button label="Return to showroom" secondary onPress={() => onNavigate('showroom')}/>
      <Button label="Customer sign in" onPress={() => onNavigate('signin')}/>
    </View>
  </Card>;
}

const emptyAddress = (): AddressDraft => ({ label: 'HOME', recipientName: '', phone: '', addressLine1: '', addressLine2: '', landmark: '', locality: '', city: '', district: '', state: '', postalCode: '', country: 'India', isDefaultDelivery: false });
const path = (p: string) => API_BASE_URL + (p.startsWith('/') ? p : '/' + p);
const money = (n: number | null | undefined) => n == null ? 'Ask for price' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const date = (s: string | null | undefined) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d); };
const dateTime = (s: string | null | undefined) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
const pretty = (s: string | null | undefined) => (s || 'Unknown').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase());
const addressText = (a: Address) => [a.addressLine1, a.addressLine2, a.landmark ? 'Near ' + a.landmark : null, a.locality, a.city, a.district, a.state, a.postalCode, a.country].filter(Boolean).join(', ');

async function api<T>(p: string, token?: string, options: { method?: string; body?: string | FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (options.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  let response: Response;
  try { response = await fetch(path(p), { method: options.method || 'GET', headers, body: options.body }); }
  catch { throw new Error('Could not connect to Lucky Bajaj. Check your internet connection and retry.'); }
  const raw = await response.text();
  let data: unknown = null;
  if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
  if (!response.ok) {
    const payload = typeof data === 'object' && data !== null ? data as Record<string, unknown> : null;
    const messageValue = payload
      ? [payload.message, payload.detail, payload.error_description, payload.title].find(value => typeof value === 'string' && value.trim())
      : null;
    const message = typeof messageValue === 'string' ? messageValue : typeof data === 'string' && data ? data : 'Request failed (' + response.status + ').';
    throw new Error(message);
  }
  return data as T;
}
function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[S.card, style]}>{children}</View>; }
function Button({ label, onPress, secondary = false, disabled = false, small = false, testID }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; small?: boolean; testID?: string }) { return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [S.button, secondary && S.secondaryButton, small && S.smallButton, disabled && S.disabledButton, pressed && !disabled && S.pressed]}><Text style={[S.buttonText, secondary && S.secondaryText, small && S.smallText]}>{label}</Text></Pressable>; }
function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline, autoCapitalize = 'sentences', maxLength, testID }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'url'; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; maxLength?: number; testID?: string }) { return <View style={S.field}><Text style={S.label}>{label}</Text><TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder || label} placeholderTextColor={C.quiet} secureTextEntry={secureTextEntry} keyboardType={keyboardType || 'default'} autoCapitalize={autoCapitalize} autoCorrect={false} maxLength={maxLength} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[S.input, multiline && S.multiline]} /></View>; }
function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) { return <View style={[S.pill, tone === 'success' && S.pillGood, tone === 'warning' && S.pillWarn, tone === 'danger' && S.pillBad]}><Text style={S.pillText}>{label}</Text></View>; }
function Heading({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) { return <View style={S.heading}><View style={S.flex}><Text style={S.h2}>{title}</Text>{subtitle ? <Text style={S.sub}>{subtitle}</Text> : null}</View>{right}</View>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <View style={S.empty}><Text style={S.emptyMark}>◇</Text><Text style={S.cardTitle}>{title}</Text><Text style={S.sub}>{copy}</Text></View>; }
function Notice({ message, good = false }: { message: string; good?: boolean }) { return <View accessibilityRole="alert" style={[S.notice, good && S.noticeGood]}><Text style={[S.noticeText, good && S.noticeTextGood]}>{message}</Text></View>; }
function ScreenButton({ title, copy, icon, onPress }: { title: string; copy: string; icon: string; onPress: () => void }) { return <Pressable onPress={onPress} style={S.linkTile}><Text style={S.tileIcon}>{icon}</Text><View style={S.flex}><Text style={S.cardTitle}>{title}</Text><Text style={S.meta}>{copy}</Text></View><Text style={S.chevron}>›</Text></Pressable>; }

const NAV: Array<{ key: Screen; label: string; icon: string }> = [
  { key: 'home', label: 'Home', icon: '⌂' }, { key: 'showroom', label: 'Bikes', icon: '◈' },
  { key: 'garage', label: 'My bikes', icon: '⌁' }, { key: 'parts', label: 'Parts', icon: '▣' },
  { key: 'updates', label: 'Updates', icon: '✧' }, { key: 'more', label: 'More', icon: '•••' },
];
const MORE: Array<{ key: Screen; title: string; copy: string; icon: string }> = [
  { key: 'profile', title: 'My profile', copy: 'Personal details, language and photo', icon: '◉' },
  { key: 'addresses', title: 'Saved addresses', copy: 'Home, Work and delivery destinations', icon: '⌖' },
  { key: 'purchases', title: 'Purchases & orders', copy: 'Motorcycle invoices and parts orders', icon: '▤' },
  { key: 'service', title: 'Service history', copy: 'Workshop jobs, invoices and balances', icon: '⚙' },
  { key: 'appointments', title: 'Appointments', copy: 'Request service and track confirmation', icon: '▦' },
  { key: 'requests', title: 'Test rides & enquiries', copy: 'Track dealership follow-up', icon: '↗' },
  { key: 'cart', title: 'Shopping cart', copy: 'Review parts before placing an order', icon: '🛒' },
  { key: 'privacy', title: 'Privacy policy', copy: 'How customer information is used', icon: '⌑' },
  { key: 'terms', title: 'Terms of use', copy: 'Customer service and catalogue terms', icon: '≡' },
];

export default function CustomerExperience() {
  const { width } = useWindowDimensions();
  const wide = width >= 680;
  const [screen, setScreen] = useState<Screen>('showroom');
  const [token, setToken] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'activate'>('login');
  const [loginMode, setLoginMode] = useState<'customerCode' | 'username'>('customerCode');
  const [login, setLogin] = useState({ dealershipCode: '', customerCode: '', username: '', password: '' });
  const [activation, setActivation] = useState({ activationToken: '', username: '', password: '', confirmPassword: '' });
  const [googleWebId, setGoogleWebId] = useState('');
  const [googleAndroidId, setGoogleAndroidId] = useState('');
  const [googleRequest, googleResponse, promptGoogle] = Google.useAuthRequest({ webClientId: googleWebId || undefined, androidClientId: googleAndroidId || 'unconfigured-android.apps.googleusercontent.com', scopes: ['openid', 'profile', 'email'], selectAccount: true });
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [selectedBike, setSelectedBike] = useState<Bike | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [quoteCity, setQuoteCity] = useState('Bettiah');
  const [quoteState, setQuoteState] = useState('Bihar');
  const [quote, setQuote] = useState<OnRoadQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [history, setHistory] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NoticePage>({ items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0 });
  const [requests, setRequests] = useState<SalesRequest[]>([]);
  const [pendingIntent, setPendingIntent] = useState<Intent | null>(null);
  const [pendingIntentError, setPendingIntentError] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [partFilters, setPartFilters] = useState<PartFilters>({ categories: [], motorcycleModels: [] });
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [profile, setProfile] = useState<ProfileDraft>({ fullName: '', phone: '', alternatePhone: '', email: '', preferredLanguage: 'hi' });
  const [addressDraft, setAddressDraft] = useState<AddressDraft | null>(null);
  const [editingAddress, setEditingAddress] = useState('');
  const [photoVersion, setPhotoVersion] = useState(0);
  const [partSearch, setPartSearch] = useState('');
  const [partCategory, setPartCategory] = useState('ALL');
  const [partBikeType, setPartBikeType] = useState('');
  const [partAvailability, setPartAvailability] = useState('ALL');
  const [partModel, setPartModel] = useState('');
  const [partMinPrice, setPartMinPrice] = useState('');
  const [partMaxPrice, setPartMaxPrice] = useState('');
  const [partSort, setPartSort] = useState<'CATEGORY' | 'NAME' | 'PRICE_LOW' | 'PRICE_HIGH'>('CATEGORY');
  const [partFiltersExpanded, setPartFiltersExpanded] = useState(false);
  const [fitmentModel, setFitmentModel] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartHydratedFor, setCartHydratedFor] = useState<string | null>(null);
  const [orderNote, setOrderNote] = useState('');
  const [fulfilment, setFulfilment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [orderKey, setOrderKey] = useState('retail-' + Date.now());
  const [appointmentDraft, setAppointmentDraft] = useState({ vehiclePublicId: '', scheduledFor: new Date(Date.now() + 48 * 60 * 60 * 1000), slotMinutes: '60', customerConcern: '', customerLanguage: 'hi' });
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [rideAt, setRideAt] = useState(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  const [showRideDate, setShowRideDate] = useState(false);
  const [showRideTime, setShowRideTime] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoreNotices, setLoadingMoreNotices] = useState(false);
  const [noticeUnreadOnly, setNoticeUnreadOnly] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const owner = customer?.publicId;
    if (!token || !owner) {
      setCart([]);
      setCartHydratedFor(null);
      return;
    }
    let active = true;
    setCartHydratedFor(null);
    void AsyncStorage.getItem(PARTS_CART_KEY_PREFIX + owner)
      .then(raw => {
        let restored: CartLine[] = [];
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            restored = parsed.filter((item): item is CartLine =>
              typeof item?.partPublicId === 'string'
              && Number.isInteger(item?.quantity)
              && item.quantity > 0);
          }
        }
        if (active) setCart(restored);
      })
      .catch(() => { if (active) setCart([]); })
      .finally(() => { if (active) setCartHydratedFor(owner); });
    return () => { active = false; };
  }, [token, customer?.publicId]);

  useEffect(() => {
    const owner = customer?.publicId;
    if (!token || !owner || cartHydratedFor !== owner) return;
    void AsyncStorage.setItem(PARTS_CART_KEY_PREFIX + owner, JSON.stringify(cart)).catch(() => undefined);
  }, [cart, cartHydratedFor, token, customer?.publicId]);

  const notify = useCallback((message: string, good = false) => { setError(good ? '' : message); setSuccess(good ? message : ''); }, []);

  const loadCatalogue = useCallback(async () => {
    setCatalogueLoading(true); setCatalogueError('');
    try {
      const results = await Promise.all([
        api<Catalogue>('/api/v1/public/catalogue/bikes'),
        api<{ promotions?: Promotion[] }>('/api/v1/public/catalogue/promotions').catch(() => ({ promotions: [] as Promotion[] })),
      ]);
      if (results[0].manufacturer !== 'BAJAJ' || !Array.isArray(results[0].bikes) || results[0].bikes.some(b => b.manufacturer !== 'BAJAJ')) throw new Error('The public catalogue could not be verified. Please retry.');
      setCatalogue(results[0]); setPromotions((results[1].promotions || []).filter(p => p.published));
    } catch (cause) { setCatalogueError(cause instanceof Error ? cause.message : 'The showroom could not be loaded.'); }
    finally { setCatalogueLoading(false); }
  }, []);

  const clearSession = useCallback(async () => {
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* local cleanup remains best-effort */ }
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
    setToken(''); setCustomer(null); setVehicles([]); setHistory([]); setAppointments([]);
    setNotifications({ items: [], page: 0, pageSize: 25, total: 0, unreadCount: 0 });
    setRequests([]); setPendingIntent(null); setPendingIntentError(''); setParts([]); setOrders([]); setPurchases([]); setAddresses([]); setCart([]);
  }, []);

  const loadPortal = useCallback(async (sessionToken: string) => {
    setLoadingData(true);
    const routes = [
      ['/api/v1/customer/auth/me', 'customer'], ['/api/v1/customer/vehicles', 'vehicles'],
      ['/api/v1/customer/service-history', 'history'], ['/api/v1/customer/appointments', 'appointments'],
      ['/api/v1/customer/notifications?page=0&pageSize=25', 'notifications'], ['/api/v1/customer/sales-requests', 'requests'],
      ['/api/v1/customer/parts', 'parts'], ['/api/v1/customer/parts/orders', 'orders'],
      ['/api/v1/customer/parts/filters', 'filters'], ['/api/v1/customer/addresses', 'addresses'],
      ['/api/v1/customer/purchase-history/motorcycles', 'purchases'],
    ] as const;
    const values = await Promise.all(routes.map(async ([url, key]) => ({ key, result: await api<unknown>(url, sessionToken).then(value => ({ ok: true as const, value })).catch(cause => ({ ok: false as const, cause })) })));
    const get = <T,>(key: string, fallback: T): T => {
      const entry = values.find(v => v.key === key);
      return entry?.result.ok ? entry.result.value as T : fallback;
    };
    const customerResult = values.find(v => v.key === 'customer')?.result;
    const who = get<Customer | null>('customer', null);
    if (!who) {
      if (customerResult && !customerResult.ok && /401|unauthori[sz]ed|expired|session/i.test(customerResult.cause instanceof Error ? customerResult.cause.message : '')) { await clearSession(); setScreen('signin'); }
      else if (customerResult && !customerResult.ok) notify(customerResult.cause instanceof Error ? customerResult.cause.message : 'Your profile could not be loaded.');
      setLoadingData(false); return;
    }
    setCustomer(who);
    setProfile({ fullName: who.fullName || '', phone: who.phone || '', alternatePhone: who.alternatePhone || '', email: who.email || '', preferredLanguage: who.preferredLanguage || 'hi' });
    const linked = get<Vehicle[]>('vehicles', []);
    const saved = get<Address[]>('addresses', []);
    setVehicles(linked); setHistory(get<Service[]>('history', [])); setAppointments(get<Appointment[]>('appointments', []));
    setNotifications(get<NoticePage>('notifications', { items: [], page: 0, pageSize: 50, total: 0, unreadCount: 0 }));
    setRequests(get<SalesRequest[]>('requests', [])); setParts(get<Part[]>('parts', [])); setOrders(get<RetailOrder[]>('orders', []));
    setPartFilters(get<PartFilters>('filters', { categories: [], motorcycleModels: [] }));
    setAddresses(saved); setPurchases(get<Purchase[]>('purchases', []));
    setAppointmentDraft(cur => ({ ...cur, vehiclePublicId: cur.vehiclePublicId && linked.some(v => v.publicId === cur.vehiclePublicId) ? cur.vehiclePublicId : linked[0]?.publicId || '', customerLanguage: who.preferredLanguage || 'hi' }));
    const def = saved.find(a => a.isDefaultDelivery);
    if (def) setDeliveryAddress(cur => cur.trim() ? cur : addressText(def));
    if (values.some(v => !v.result.ok)) notify('Some information could not be refreshed. Available sections remain accessible.');
    setLoadingData(false);
  }, [clearSession, notify]);

  const submitPending = useCallback(async (sessionToken: string): Promise<boolean | null> => {
    let raw: string | null;
    try { raw = await AsyncStorage.getItem(PENDING_KEY); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The saved showroom selection could not be read.';
      setPendingIntentError(message);
      notify(message);
      setScreen('requests');
      return false;
    }
    if (!raw) { setPendingIntent(null); setPendingIntentError(''); return null; }
    let intent: Intent | null = null;
    try {
      const parsed = JSON.parse(raw) as Partial<Intent>;
      if ((parsed.action !== 'TEST_RIDE' && parsed.action !== 'PURCHASE')
        || typeof parsed.modelCode !== 'string' || !parsed.modelCode.trim()
        || typeof parsed.modelName !== 'string' || !parsed.modelName.trim()
        || typeof parsed.idempotencyKey !== 'string' || !parsed.idempotencyKey.trim()
        || (parsed.preferredAt != null && (typeof parsed.preferredAt !== 'string' || !Number.isFinite(Date.parse(parsed.preferredAt))))) {
        throw new Error('The saved showroom selection is incomplete. Discard it and choose the motorcycle again.');
      }
      intent = parsed as Intent;
      setPendingIntent(intent);
      setPendingIntentError('');
      await api<SalesRequest>('/api/v1/customer/sales-requests', sessionToken, { method: 'POST', body: JSON.stringify({ requestType: intent.action, modelCode: intent.modelCode, preferredAt: intent.action === 'TEST_RIDE' ? intent.preferredAt : null, notes: 'Request started from the Lucky Bajaj Android showroom.', idempotencyKey: intent.idempotencyKey }) });
      const refreshed = await api<SalesRequest[]>('/api/v1/customer/sales-requests', sessionToken);
      await AsyncStorage.removeItem(PENDING_KEY);
      setRequests(refreshed);
      setPendingIntent(null);
      setPendingIntentError('');
      setScreen('requests');
      notify((intent.action === 'TEST_RIDE' ? 'Test-ride request for ' : 'Purchase enquiry for ') + intent.modelName + ' sent. Dealership confirmation is still required.', true);
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Request could not be sent.';
      setPendingIntent(intent);
      setPendingIntentError(message);
      notify(message + (intent ? ' Your selected bike is saved; retry this request or discard it.' : ' Discard the invalid saved selection and choose a motorcycle again.'));
      setScreen('requests');
      return false;
    }
  }, [notify]);

  const saveSession = useCallback(async (session: Session, greeting: string) => {
    await SecureStore.setItemAsync(TOKEN_KEY, session.accessToken);
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
    setToken(session.accessToken); setCustomer(session.customer);
    const pending = await submitPending(session.accessToken);
    if (pending === null) { notify(greeting, true); setScreen('home'); }
    await loadPortal(session.accessToken);
  }, [loadPortal, notify, submitPending]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const [secureToken, legacyToken, googleConfig] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
        api<{ configured: boolean; clientId: string; androidClientId?: string }>('/api/v1/customer/auth/google/config?applicationId=' + encodeURIComponent(String(Constants.expoConfig?.extra?.androidPackage || Constants.expoConfig?.android?.package || 'com.quantaedge.luckybajaj'))).catch(() => ({ configured: false, clientId: '', androidClientId: '' })),
      ]);
      if (!live) return;
      if (googleConfig.clientId) setGoogleWebId(googleConfig.clientId);
      if (googleConfig.androidClientId) setGoogleAndroidId(googleConfig.androidClientId);
      const saved = secureToken || legacyToken;
      if (!secureToken && legacyToken) await SecureStore.setItemAsync(TOKEN_KEY, legacyToken).catch(() => undefined);
      await loadCatalogue();
      if (saved) {
        try {
          await api<Customer>('/api/v1/customer/auth/me', saved);
          if (live) {
            setToken(saved);
            await loadPortal(saved);
            const pending = await submitPending(saved);
            if (pending === null) setScreen('home');
            else setScreen('requests');
          }
        } catch { await clearSession(); }
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [clearSession, loadCatalogue, loadPortal, submitPending]);

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const result = googleResponse as typeof googleResponse & { authentication?: { idToken?: string | null }; params?: Record<string, string> };
    const credential = result.authentication?.idToken || result.params?.id_token;
    if (!credential) { notify('Google did not return an identity token. Check the Android OAuth configuration.'); return; }
    if (!login.dealershipCode.trim()) { notify('Enter your dealership code before continuing with Google.'); return; }
    setSaving(true);
    api<Session>('/api/v1/customer/auth/google', undefined, { method: 'POST', body: JSON.stringify({ dealershipCode: login.dealershipCode.trim().toUpperCase(), credential }) })
      .then(session => saveSession(session, 'Google sign-in verified. Welcome to Lucky Bajaj.'))
      .catch(cause => notify(cause instanceof Error ? cause.message : 'Google sign-in could not be verified.'))
      .finally(() => setSaving(false));
  }, [googleResponse, login.dealershipCode, notify, saveSession]);

  async function signIn() {
    setSaving(true); setError(''); setSuccess('');
    try {
      const dealershipCode = login.dealershipCode.trim().toUpperCase();
      const session = loginMode === 'username'
        ? await api<Session>('/api/v1/customer/auth/username-login', undefined, { method: 'POST', body: JSON.stringify({ dealershipCode, username: login.username.trim(), password: login.password }) })
        : await api<Session>('/api/v1/customer/auth/login', undefined, { method: 'POST', body: JSON.stringify({ dealershipCode, customerCode: login.customerCode.trim().toUpperCase(), password: login.password }) });
      setLogin(cur => ({ ...cur, password: '' }));
      await saveSession(session, 'You are signed in securely.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { setSaving(false); }
  }

  async function activateAccount() {
    if (activation.password !== activation.confirmPassword) { notify('The two passwords do not match.'); return; }
    if (activation.activationToken.trim().length < 32 || activation.username.trim().length < 3 || activation.password.length < 12) { notify('Enter the full activation token, a username of at least 3 characters and a password of at least 12 characters.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const session = await api<Session>('/api/v1/customer/auth/activate-with-username', undefined, { method: 'POST', body: JSON.stringify({ activationToken: activation.activationToken.trim(), username: activation.username.trim(), password: activation.password }) });
      setActivation({ activationToken: '', username: '', password: '', confirmPassword: '' });
      await saveSession(session, 'Your customer account is active.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Account activation failed.'); }
    finally { setSaving(false); }
  }

  async function logout() {
    const old = token;
    await clearSession(); setScreen('showroom'); setError(''); setSuccess('');
    try { await api('/api/v1/customer/auth/logout', old, { method: 'POST' }); }
    catch { notify('This device is signed out. The server could not confirm session revocation; sign in again before continuing.'); }
  }

  async function refresh() {
    setRefreshing(true);
    if (token) await loadPortal(token);
    await loadCatalogue();
    setRefreshing(false);
  }

  const filteredBikes = useMemo(() => (catalogue?.bikes || []).filter(b => (category === 'ALL' || b.category === category) && (!search.trim() || [b.modelName, b.family, b.category, b.rideCharacter].some(s => s.toLowerCase().includes(search.trim().toLowerCase())))), [catalogue, category, search]);
  const compared = useMemo(() => (catalogue?.bikes || []).filter(b => compare.includes(b.modelCode)), [catalogue, compare]);
  const selectedTypeModelCodes = useMemo(
    () => new Set(partFilters.motorcycleModels
      .filter(model => !partBikeType || model.category === partBikeType)
      .map(model => model.modelCode)),
    [partFilters.motorcycleModels, partBikeType],
  );
  const filteredParts = useMemo(() => parts.filter(part => {
    const query = partSearch.trim().toLowerCase();
    const matchesQuery = !query || [part.partName, part.skuCode, part.partNumber || '', part.category, part.description || '']
      .some(value => value.toLowerCase().includes(query));
    const matchesCategory = partCategory === 'ALL' || part.category === partCategory;
    const matchesType = !partBikeType
      || part.fitmentModelCodes.some(code => selectedTypeModelCodes.has(code))
      || (part.fitmentVerified && part.fitmentModelCodes.length === 0);
    const matchesModel = !partModel || part.fitmentModelCodes.includes(partModel)
      || (part.fitmentVerified && part.fitmentModelCodes.length === 0);
    const matchesAvailability = partAvailability === 'ALL' || part.availabilityStatus === partAvailability;
    const min = partMinPrice.trim() ? Number(partMinPrice) : null;
    const max = partMaxPrice.trim() ? Number(partMaxPrice) : null;
    const price = part.retailPrice;
    const matchesPrice = price == null
      ? min == null && max == null
      : (min == null || (Number.isFinite(min) && price >= min))
        && (max == null || (Number.isFinite(max) && price <= max));
    return matchesQuery && matchesCategory && matchesType && matchesModel && matchesAvailability && matchesPrice;
  }).sort((left, right) => {
    if (partSort === 'NAME') return left.partName.localeCompare(right.partName);
    if (partSort === 'PRICE_LOW') return (left.retailPrice ?? Number.POSITIVE_INFINITY) - (right.retailPrice ?? Number.POSITIVE_INFINITY);
    if (partSort === 'PRICE_HIGH') return (right.retailPrice ?? -1) - (left.retailPrice ?? -1);
    return left.category.localeCompare(right.category) || left.partName.localeCompare(right.partName);
  }), [parts, partSearch, partCategory, partBikeType, partAvailability, partModel, partMinPrice, partMaxPrice, partSort, selectedTypeModelCodes]);
  const cartCount = cart.reduce((n, item) => n + item.quantity, 0);
  const cartTotal = cart.reduce((n, item) => n + (parts.find(p => p.publicId === item.partPublicId)?.retailPrice || 0) * item.quantity, 0);
  const comparisonRows: Array<{ label: string; value: (bike: Bike) => string }> = [
    { label: 'Engine', value: bike => `${bike.engineCc} cc` },
    { label: 'Max power', value: bike => bike.maxPower || 'Not published' },
    { label: 'Max torque', value: bike => bike.maxTorque || 'Not published' },
    { label: 'Gearbox', value: bike => bike.gearbox || 'Not published' },
    { label: 'Brakes', value: bike => bike.braking || 'Not published' },
    { label: 'Front suspension', value: bike => bike.frontSuspension || 'Not published' },
    { label: 'Rear suspension', value: bike => bike.rearSuspension || 'Not published' },
    { label: 'Fuel tank', value: bike => bike.fuelTankLitres == null ? 'Not published' : `${bike.fuelTankLitres} L` },
    { label: 'Ground clearance', value: bike => bike.groundClearanceMm == null ? 'Not published' : `${bike.groundClearanceMm} mm` },
    { label: 'Kerb weight', value: bike => bike.kerbWeightKg == null ? 'Not published' : `${bike.kerbWeightKg} kg` },
    { label: 'Ex-showroom reference', value: bike => `${money(bike.exShowroomPrice)} · ${bike.priceCity || 'Price city not stated'}` },
    { label: 'Price checked', value: bike => date(bike.priceVerifiedAt) },
    { label: 'Dealership availability', value: bike => bike.availabilityStatus === 'IN_STOCK'
      ? `${bike.availableUnits} unit(s) marked available`
      : bike.availabilityStatus === 'EXPECTED'
        ? (bike.expectedAvailableOn ? `Expected ${date(bike.expectedAvailableOn)}` : 'Expected; date not confirmed')
        : 'Out of stock' },
  ];

  function openBike(bike: Bike) { setSelectedBike(bike); setQuote(null); setScreen('bike'); }
  function startIntent(bike: Bike, action: Action) {
    const intent: Intent = { action, modelCode: bike.modelCode, modelName: bike.modelName, selectedAt: new Date().toISOString(), idempotencyKey: 'android-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9), preferredAt: action === 'TEST_RIDE' ? rideAt.toISOString() : null };
    if (action === 'TEST_RIDE' && rideAt.getTime() < Date.now()) { notify('Choose a future preferred time for the test ride.'); return; }
    AsyncStorage.setItem(PENDING_KEY, JSON.stringify(intent)).then(() => {
      setPendingIntent(intent);
      setPendingIntentError('');
      if (token) void submitPending(token);
      else { setScreen('signin'); setAuthMode('login'); notify('Sign in or activate your account to send this request. Your selection is saved.'); }
    }).catch(() => notify('The motorcycle selection could not be saved.'));
  }

  async function retryPendingRequest() {
    if (!token || saving || !pendingIntent) return;
    setSaving(true);
    try { await submitPending(token); }
    finally { setSaving(false); }
  }

  async function discardPendingRequest() {
    try {
      await AsyncStorage.removeItem(PENDING_KEY);
      setPendingIntent(null);
      setPendingIntentError('');
      notify('Saved showroom selection discarded.', true);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'The saved selection could not be discarded.');
    }
  }

  async function fetchQuote() {
    if (!selectedBike || !quoteCity.trim() || !quoteState.trim()) { notify('Enter city and state for a sourced estimate.'); return; }
    setQuoteBusy(true); setQuote(null);
    try {
      const result = await api<OnRoadQuote>('/api/v1/public/catalogue/quotes?modelCode=' + encodeURIComponent(selectedBike.modelCode) + '&city=' + encodeURIComponent(quoteCity.trim()) + '&state=' + encodeURIComponent(quoteState.trim()));
      if (!result || result.quoteType !== 'ESTIMATE' || result.modelCode !== selectedBike.modelCode || !Array.isArray(result.breakdown) || !result.sourceUrl || !/^https:\/\//i.test(result.sourceUrl)) {
        throw new Error('The pricing response could not be verified as a sourced estimate.');
      }
      setQuote(result);
    }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'No sourced estimate is available for this location.'); }
    finally { setQuoteBusy(false); }
  }

  async function saveProfile() {
    if (!profile.fullName.trim() || (!profile.phone.trim() && !profile.email.trim())) { notify('Enter your name and at least a mobile number or email.'); return; }
    setSaving(true);
    try {
      const result = await api<Customer>('/api/v1/customer/profile', token, { method: 'PUT', body: JSON.stringify({ fullName: profile.fullName.trim(), phone: profile.phone.trim() || null, alternatePhone: profile.alternatePhone.trim() || null, email: profile.email.trim() || null, preferredLanguage: profile.preferredLanguage }) });
      setCustomer(result); setProfile({ fullName: result.fullName, phone: result.phone || '', alternatePhone: result.alternatePhone || '', email: result.email || '', preferredLanguage: result.preferredLanguage }); notify('Profile saved. Previous orders and service history remain unchanged.', true);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Profile could not be saved.'); }
    finally { setSaving(false); }
  }

  async function profilePhoto() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.82 });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if (asset.fileSize && asset.fileSize > 2 * 1024 * 1024) { notify('Choose a profile image of 2 MiB or smaller.'); return; }
    const mime = asset.mimeType || 'image/jpeg';
    const form = new FormData();
    form.append('file', { uri: asset.uri, name: asset.fileName || 'profile-photo.jpg', type: mime } as unknown as Blob);
    setSaving(true);
    try { await api('/api/v1/customer/profile/photo', token, { method: 'POST', body: form }); setCustomer(v => v ? { ...v, profilePhotoAvailable: true } : v); setPhotoVersion(v => v + 1); notify('Profile photo updated.', true); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Photo upload failed.'); }
    finally { setSaving(false); }
  }

  function removePhoto() {
    Alert.alert('Remove profile photo?', 'Your initials will be shown instead.', [{ text: 'Keep photo', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { setSaving(true); void api('/api/v1/customer/profile/photo', token, { method: 'DELETE' }).then(() => { setCustomer(v => v ? { ...v, profilePhotoAvailable: false } : v); setPhotoVersion(v => v + 1); notify('Profile photo removed.', true); }).catch(cause => notify(cause instanceof Error ? cause.message : 'Photo could not be removed.')).finally(() => setSaving(false)); } }]);
  }

  function editAddress(address?: Address) {
    setEditingAddress(address?.publicId || '');
    setAddressDraft(address ? { label: address.label, recipientName: address.recipientName, phone: address.phone, addressLine1: address.addressLine1, addressLine2: address.addressLine2 || '', landmark: address.landmark || '', locality: address.locality || '', city: address.city, district: address.district || '', state: address.state, postalCode: address.postalCode, country: address.country, isDefaultDelivery: address.isDefaultDelivery } : { ...emptyAddress(), recipientName: customer?.fullName || '', phone: customer?.phone || '', isDefaultDelivery: addresses.length === 0 });
  }

  async function saveAddress() {
    if (!addressDraft) return;
    const d = addressDraft;
    if (![d.recipientName, d.phone, d.addressLine1, d.city, d.state, d.postalCode].every(s => s.trim())) { notify('Complete the recipient, mobile, address, city, state and PIN code.'); return; }
    setSaving(true);
    try {
      await api(editingAddress ? '/api/v1/customer/addresses/' + editingAddress : '/api/v1/customer/addresses', token, { method: editingAddress ? 'PUT' : 'POST', body: JSON.stringify({ ...d, recipientName: d.recipientName.trim(), phone: d.phone.trim(), addressLine1: d.addressLine1.trim(), addressLine2: d.addressLine2.trim() || null, landmark: d.landmark.trim() || null, locality: d.locality.trim() || null, district: d.district.trim() || null, country: d.country.trim() || 'India' }) });
      setAddresses(await api<Address[]>('/api/v1/customer/addresses', token)); setAddressDraft(null); setEditingAddress('');
      notify(editingAddress ? 'Address updated. Existing orders keep their original address.' : 'Address saved.', true);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Address could not be saved.'); }
    finally { setSaving(false); }
  }

  function deleteAddress(address: Address) {
    Alert.alert('Remove saved address?', 'Existing orders keep their original address.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { setSaving(true); void api<Address[]>('/api/v1/customer/addresses/' + address.publicId, token, { method: 'DELETE' }).then(setAddresses).then(() => { if (address.isDefaultDelivery) setDeliveryAddress(''); notify('Saved address removed.', true); }).catch(cause => notify(cause instanceof Error ? cause.message : 'Address could not be removed.')).finally(() => setSaving(false)); } }]);
  }

  async function createAppointment() {
    if (!appointmentDraft.vehiclePublicId || !appointmentDraft.customerConcern.trim() || appointmentDraft.scheduledFor.getTime() <= Date.now()) { notify('Choose a linked bike, future date and time, and describe what needs attention.'); return; }
    setSaving(true);
    try {
      const created = await api<Appointment>('/api/v1/customer/appointments', token, { method: 'POST', body: JSON.stringify({ vehiclePublicId: appointmentDraft.vehiclePublicId, scheduledFor: appointmentDraft.scheduledFor.toISOString(), slotMinutes: Number(appointmentDraft.slotMinutes), customerConcern: appointmentDraft.customerConcern.trim(), customerLanguage: appointmentDraft.customerLanguage || customer?.preferredLanguage || 'en' }) });
      setAppointments(current => [created, ...current]); setAppointmentDraft(current => ({ ...current, customerConcern: '' })); notify('Service request ' + created.appointmentCode + ' sent. The dealership must confirm it.', true);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Appointment request failed.'); }
    finally { setSaving(false); }
  }

  async function cancelAppointment(item: Appointment) {
    if (!cancelReason.trim()) { notify('Enter a cancellation reason first.'); return; }
    setSaving(true);
    try { const updated = await api<Appointment>('/api/v1/customer/appointments/' + item.publicId + '/cancel', token, { method: 'POST', body: JSON.stringify({ reason: cancelReason.trim() }) }); setAppointments(current => current.map(v => v.publicId === updated.publicId ? updated : v)); setCancelReason(''); notify('Appointment ' + updated.appointmentCode + ' cancelled.', true); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Appointment could not be cancelled.'); }
    finally { setSaving(false); }
  }

  async function updateNotice(item: Notice, action: 'read' | 'unread' | 'dismiss') {
    try {
      await api('/api/v1/customer/notifications/' + item.recipientPublicId + '/' + action, token, { method: 'POST' });
      const wasUnread = !item.readAt;
      const removeFromList = action === 'dismiss' || (noticeUnreadOnly && action === 'read');
      setNotifications(current => ({
        ...current,
        items: removeFromList
          ? current.items.filter(notice => notice.recipientPublicId !== item.recipientPublicId)
          : current.items.map(notice => notice.recipientPublicId === item.recipientPublicId
            ? { ...notice, readAt: action === 'read' ? new Date().toISOString() : null, status: action === 'read' ? 'READ' : 'IN_APP_CREATED' }
            : notice),
        total: removeFromList ? Math.max(0, current.total - 1) : current.total,
        unreadCount: Math.max(0, current.unreadCount + (action === 'dismiss' ? (wasUnread ? -1 : 0) : action === 'read' ? -1 : 1)),
      }));
      notify(action === 'dismiss' ? 'Update dismissed.' : action === 'read' ? 'Marked as read.' : 'Marked as unread.', true);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Update could not be changed.'); }
  }

  async function loadMoreNotices() {
    if (loadingMoreNotices || notifications.items.length >= notifications.total) return;
    setLoadingMoreNotices(true);
    try {
      const nextPage = notifications.page + 1;
      const query = '/api/v1/customer/notifications?page=' + nextPage
        + '&pageSize=' + notifications.pageSize + '&unreadOnly=' + String(noticeUnreadOnly);
      const next = await api<NoticePage>(query, token);
      setNotifications(current => ({
        ...next,
        items: [...current.items, ...next.items.filter(item =>
          !current.items.some(existing => existing.recipientPublicId === item.recipientPublicId))],
      }));
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'More updates could not be loaded.'); }
    finally { setLoadingMoreNotices(false); }
  }

  async function toggleNoticeFilter() {
    const nextFilter = !noticeUnreadOnly;
    setNoticeUnreadOnly(nextFilter);
    try {
      const page = await api<NoticePage>(
        '/api/v1/customer/notifications?page=0&pageSize=25&unreadOnly=' + String(nextFilter), token);
      setNotifications(page);
    } catch (cause) {
      setNoticeUnreadOnly(!nextFilter);
      notify(cause instanceof Error ? cause.message : 'The inbox filter could not be changed.');
    }
  }

  function addCart(part: Part, delta: number) {
    if (!part.available) return;
    setCart(current => {
      const item = current.find(v => v.partPublicId === part.publicId);
      const quantity = Math.max(0, (item?.quantity || 0) + delta);
      if (quantity > part.quantityAvailable) { notify('Only ' + part.quantityAvailable + ' ' + part.unitOfMeasure + ' currently available.'); return current; }
      return quantity ? item ? current.map(v => v.partPublicId === part.publicId ? { ...v, quantity } : v) : [...current, { partPublicId: part.publicId, quantity }] : current.filter(v => v.partPublicId !== part.publicId);
    });
  }

  async function placeOrder() {
    if (!cart.length) { notify('Add available parts to your cart first.'); return; }
    if (fulfilment === 'DELIVERY' && !deliveryAddress.trim()) { notify('Choose a saved address or enter delivery details.'); return; }
    const verified = cart.map(line => parts.find(p => p.publicId === line.partPublicId)).filter((p): p is Part => Boolean(p && p.fitmentVerified && p.fitmentModelCodes.length));
    if (verified.length && !fitmentModel) { notify('Choose your motorcycle model to verify parts compatibility.'); return; }
    const incompatible = verified.find(p => !p.fitmentModelCodes.includes(fitmentModel));
    if (incompatible) { notify(incompatible.partName + ' is not verified for the selected motorcycle.'); return; }
    setSaving(true);
    try {
      const order = await api<RetailOrder>('/api/v1/customer/parts/orders', token, { method: 'POST', body: JSON.stringify({ lines: cart.map(line => ({ partPublicId: line.partPublicId, quantity: line.quantity })), fitmentModelCode: fitmentModel || null, customerNote: orderNote.trim() || null, fulfillmentMethod: fulfilment, deliveryAddress: fulfilment === 'DELIVERY' ? deliveryAddress.trim() : null, idempotencyKey: orderKey }) });
      const [p, o] = await Promise.all([api<Part[]>('/api/v1/customer/parts', token), api<RetailOrder[]>('/api/v1/customer/parts/orders', token)]);
      setParts(p); setOrders(o); setCart([]); setOrderNote(''); setFulfilment('PICKUP'); setOrderKey('retail-' + Date.now()); setScreen('purchases');
      notify(fulfilment === 'DELIVERY' ? 'Delivery request ' + order.orderCode + ' saved. Review and accept the dealership quote when it arrives. No online payment was taken.' : 'Pickup order ' + order.orderCode + ' placed. Pay at the dealership; no online payment was taken.', true);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Parts order could not be placed.'); }
    finally { setSaving(false); }
  }

  async function refreshOrders() {
    setSaving(true);
    try { const [p, o] = await Promise.all([api<Part[]>('/api/v1/customer/parts', token), api<RetailOrder[]>('/api/v1/customer/parts/orders', token)]); setParts(p); setOrders(o); notify('Parts and orders refreshed.', true); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Orders could not be refreshed.'); }
    finally { setSaving(false); }
  }

  function cancelOrder(order: RetailOrder) {
    Alert.alert('Cancel order?', 'The dealership will review the cancellation under the current order rules.', [{ text: 'Keep order', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => { setSaving(true); void api<RetailOrder>('/api/v1/customer/parts/orders/' + order.publicId + '/cancel', token, { method: 'POST' }).then(() => refreshOrders()).catch(cause => notify(cause instanceof Error ? cause.message : 'Order could not be cancelled.')).finally(() => setSaving(false)); } }]);
  }

  async function quoteResponse(order: RetailOrder, accept: boolean) {
    setSaving(true);
    try { await api('/api/v1/customer/parts/orders/' + order.publicId + '/delivery-quote-response', token, { method: 'POST', body: JSON.stringify({ accept }) }); await refreshOrders(); notify(accept ? 'Delivery quote accepted. The dealership can continue fulfilment.' : 'Delivery quote declined. The order remains subject to the dealership workflow.', true); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Delivery quote response failed.'); }
    finally { setSaving(false); }
  }

  async function sharePromotion(promotion: Promotion) {
    const offerId = encodeURIComponent(promotion.publicId);
    const offerUrl = CUSTOMER_WEB_URL + '/?offer=' + offerId + '#showroom-offer-' + offerId;
    try {
      await Share.share({
        title: promotion.title,
        message: promotion.title + '\n' + promotion.summary + '\n' + offerUrl,
        url: offerUrl,
      });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'The offer could not be shared.');
    }
  }

  const renderBike = (bike: Bike) => (
    <Card key={bike.modelCode} style={[S.bikeCard, { width: wide ? '48.5%' : '100%' }]}>
      {bike.heroImageUrl ? <Image source={{ uri: bike.heroImageUrl.startsWith('http') ? bike.heroImageUrl : path(bike.heroImageUrl) }} resizeMode="contain" style={S.bikeImage} /> : <View style={S.imageFallback}><Text style={S.heroMark}>LB</Text></View>}
      <View style={S.wrapRow}><Pill label={pretty(bike.category)}/><Pill label={pretty(bike.availabilityStatus)} tone={bike.availabilityStatus === 'IN_STOCK' ? 'success' : 'warning'}/></View>
      <Text style={S.cardTitle}>{bike.modelName}</Text><Text style={S.meta}>{bike.engineCc} cc · {bike.family}</Text><Text style={S.price}>{money(bike.exShowroomPrice)}</Text><Text style={S.meta}>Ex-showroom reference · {bike.priceCity || catalogue?.priceReferenceCity}</Text>
      <Text style={S.body}>{bike.rideCharacter}</Text>
      <View style={S.wrapRow}><Button label="Explore" onPress={() => openBike(bike)} small/><Button label={compare.includes(bike.modelCode) ? 'Remove compare' : 'Compare'} secondary small onPress={() => setCompare(c => c.includes(bike.modelCode) ? c.filter(k => k !== bike.modelCode) : c.length < 3 ? [...c, bike.modelCode] : (notify('Compare up to three motorcycles at a time.'), c))}/></View>
      <Button label="Request a test ride" secondary onPress={() => { setSelectedBike(bike); startIntent(bike, 'TEST_RIDE'); }} />
    </Card>
  );

  const renderContent = () => {
    if (screen === 'showroom') return <>
      <View style={S.showroomHero}><Text style={S.eyebrowLight}>THE BAJAJ SHOWROOM</Text><Text style={S.heroTitleLarge}>Find the ride that feels like you.</Text><Text style={S.heroCopy}>Explore current models, compare specifications and contact Lucky Bajaj directly from your phone.</Text><Button label={token ? 'Open my customer space' : 'Sign in / activate account'} secondary onPress={() => setScreen(token ? 'home' : 'signin')}/></View>
      {catalogueError ? <Notice message={catalogueError}/>:null}
      <Heading title="Explore Bajaj motorcycles" subtitle={(catalogue?.bikes.length || 0) + ' published models · sourced catalogue and dealership availability'} right={<Button label="Refresh" secondary small onPress={() => void loadCatalogue()}/>}/>
      <Field label="Search motorcycles" value={search} onChangeText={setSearch} placeholder="Try Pulsar, Dominar, commuter…" autoCapitalize="none"/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chips}>{['ALL','SPORT','STREET','COMMUTER','TOURING','CRUISER','RUGGED'].map(c => <Pressable key={c} onPress={() => setCategory(c)} style={[S.chip, category === c && S.chipSelected]}><Text style={[S.chipText, category === c && S.chipTextSelected]}>{c === 'ALL' ? 'All bikes' : pretty(c)}</Text></Pressable>)}</ScrollView>
      {compared.length ? <Card><View style={S.rowBetween}><View style={S.flex}><Text style={S.cardTitle}>Compare motorcycles</Text><Text style={S.meta}>{compared.length} of 3 selected · full specification comparison below</Text></View><Button label="Clear" secondary small onPress={() => setCompare([])}/></View><ScrollView horizontal showsHorizontalScrollIndicator={false}>{compared.map(b => <View key={b.modelCode} style={S.compareCard}><Text style={S.cardTitle}>{b.modelName}</Text><Text style={S.body}>{b.engineCc} cc</Text><Text style={S.body}>Power: {b.maxPower || 'Not published'}</Text><Text style={S.body}>Torque: {b.maxTorque || 'Not published'}</Text><Text style={S.price}>{money(b.exShowroomPrice)}</Text><Button label="Remove" small secondary onPress={() => setCompare(v => v.filter(x => x !== b.modelCode))}/></View>)}</ScrollView></Card> : null}
      {compared.length >= 2 ? <Card><Heading title="Specification comparison" subtitle="The same sourced values used by the customer website."/>{comparisonRows.map(row => <View key={row.label} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}><Text style={S.label}>{row.label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={S.wrapRow}>{compared.map(bike => <View key={bike.modelCode} style={{ minWidth: 150, maxWidth: 220, padding: 10, borderRadius: 11, backgroundColor: '#F5F8FC', gap: 4 }}><Text style={S.meta}>{bike.modelName}</Text><Text style={S.cardTitle}>{row.value(bike)}</Text></View>)}</View></ScrollView></View>)}</Card> : null}
      {catalogueLoading ? <Card><ActivityIndicator color={C.orange}/><Text style={S.meta}>Loading published models…</Text></Card> : filteredBikes.length ? <View style={[S.bikeGrid, wide && S.bikeGridWide]}>{filteredBikes.map(renderBike)}</View> : <Card><Empty title="No matching motorcycles" copy="Try a different search or category."/><Button label="Reload showroom" secondary onPress={() => void loadCatalogue()}/></Card>}
      {promotions.length ? <><Heading title="Current offers" subtitle="Only active published offers with source information are shown."/>{promotions.map(p => <Card key={p.publicId}><Text style={S.cardTitle}>{p.title}</Text>{p.modelName ? <Text style={S.meta}>{p.modelName}</Text> : null}<Text style={S.body}>{p.summary}</Text>{p.terms ? <Text style={S.meta}>Terms: {p.terms}</Text> : null}<Text style={S.meta}>Valid from {date(p.startsOn)}{p.endsOn ? ' to ' + date(p.endsOn) : ''}</Text><View style={S.wrapRow}><Button label="Read offer source ↗" secondary small onPress={() => void Linking.openURL(p.sourceUrl)}/><Button label="Share offer ↗" small onPress={() => void sharePromotion(p)}/></View></Card>)}</> : null}
    </>;

    if (screen === 'bike' && selectedBike) return <>
      <Button label="← Back to showroom" secondary small onPress={() => setScreen('showroom')}/>
      <Card>{selectedBike.heroImageUrl ? <Image source={{ uri: selectedBike.heroImageUrl.startsWith('http') ? selectedBike.heroImageUrl : path(selectedBike.heroImageUrl) }} resizeMode="contain" style={S.detailImage}/> : null}
        <View style={S.wrapRow}><Pill label={pretty(selectedBike.category)}/><Pill label={pretty(selectedBike.availabilityStatus)} tone={selectedBike.availabilityStatus === 'IN_STOCK' ? 'success' : 'warning'}/></View>
        <Text style={S.title}>{selectedBike.modelName}</Text><Text style={S.body}>{selectedBike.rideCharacter}</Text><Text style={S.price}>{money(selectedBike.exShowroomPrice)}</Text><Text style={S.meta}>Ex-showroom reference · {selectedBike.priceCity || catalogue?.priceReferenceCity}</Text>{selectedBike.priceVerifiedAt ? <Text style={S.meta}>Price source checked {date(selectedBike.priceVerifiedAt)}</Text> : null}{selectedBike.expectedAvailableOn ? <Text style={S.meta}>Expected availability · {date(selectedBike.expectedAvailableOn)}</Text> : null}{selectedBike.priceSourceUrl ? <Button label="Price reference source ↗" secondary small onPress={() => void Linking.openURL(selectedBike.priceSourceUrl)}/> : null}
        <View style={[S.specGrid, wide && S.specGridWide]}>{[['Engine', selectedBike.engineCc + ' cc'], ['Power', selectedBike.maxPower || 'Not listed'], ['Torque', selectedBike.maxTorque || 'Not listed'], ['Gearbox', selectedBike.gearbox || 'Not listed'], ['Brakes', selectedBike.braking || 'Not listed'], ['Front suspension', selectedBike.frontSuspension || 'Not listed'], ['Rear suspension', selectedBike.rearSuspension || 'Not listed'], ['Fuel tank', selectedBike.fuelTankLitres ? selectedBike.fuelTankLitres + ' L' : 'Not listed'], ['Ground clearance', selectedBike.groundClearanceMm ? selectedBike.groundClearanceMm + ' mm' : 'Not listed'], ['Kerb weight', selectedBike.kerbWeightKg ? selectedBike.kerbWeightKg + ' kg' : 'Not listed']].map(([label, value]) => <View key={label} style={[S.specBox, { width: wide ? '48.5%' : '100%' }]}><Text style={S.meta}>{label}</Text><Text style={S.cardTitle}>{value}</Text></View>)}</View>
        {(selectedBike.highlights || []).map((h, i) => <Text key={i} style={S.body}>• {h}</Text>)}
        <Text style={S.meta}>Stock status does not reserve a physical motorcycle. A request is not a confirmed booking or sale.</Text>
        <Text style={S.label}>Preferred test-ride time (optional)</Text><View style={S.wrapRow}><Button label={'Date · ' + date(rideAt.toISOString())} secondary small onPress={() => setShowRideDate(true)}/><Button label={'Time · ' + rideAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} secondary small onPress={() => setShowRideTime(true)}/></View>
        {showRideDate ? <DateTimePicker value={rideAt} mode="date" minimumDate={new Date()} onChange={(_, d) => { setShowRideDate(Platform.OS === 'ios'); if (d) setRideAt(old => new Date(d.getFullYear(), d.getMonth(), d.getDate(), old.getHours(), old.getMinutes())); }}/> : null}
        {showRideTime ? <DateTimePicker value={rideAt} mode="time" onChange={(_, d) => { setShowRideTime(Platform.OS === 'ios'); if (d) setRideAt(old => new Date(old.getFullYear(), old.getMonth(), old.getDate(), d.getHours(), d.getMinutes())); }}/> : null}
        <Button label="Request a test ride" onPress={() => startIntent(selectedBike, 'TEST_RIDE')}/><Button label="Enquire about purchase" secondary onPress={() => startIntent(selectedBike, 'PURCHASE')}/>
        <Button label="Official model page ↗" secondary onPress={() => void Linking.openURL(selectedBike.officialModelUrl)}/><Button label="Official specifications ↗" secondary onPress={() => void Linking.openURL(selectedBike.officialSpecsUrl)}/>
      </Card>
      <Heading title="Sourced on-road estimate" subtitle="Shown only when the dealership has an active, sourced location price profile."/>
      <Card><View style={[S.fieldGrid, wide && S.fieldGridWide]}><View style={{ width: wide ? '48%' : '100%' }}><Field label="City" value={quoteCity} onChangeText={setQuoteCity}/></View><View style={{ width: wide ? '48%' : '100%' }}><Field label="State" value={quoteState} onChangeText={setQuoteState}/></View></View><Button label={quoteBusy ? 'Checking estimate…' : 'Get sourced estimate'} disabled={quoteBusy} onPress={() => void fetchQuote()}/>{quote ? <><Text style={S.meta}>Estimate for {quote.city}, {quote.state} · Valid from {date(quote.effectiveFrom)}{quote.effectiveTo ? ' to ' + date(quote.effectiveTo) : ''}</Text>{quote.breakdown.map((x, i) => <View key={i} style={S.rowBetween}><Text style={S.body}>{x.label}</Text><Text style={S.cardTitle}>{money(x.amount)}</Text></View>)}<Text style={S.price}>Estimated total: {money(quote.estimatedOnRoadTotal)}</Text><Text style={S.meta}>{quote.disclaimer}</Text>{quote.note ? <Text style={S.meta}>{quote.note}</Text> : null}<Button label="Quote source ↗" secondary small onPress={() => void Linking.openURL(quote.sourceUrl)}/></> : null}</Card>
    </>;

    if (screen === 'signin' || screen === 'signup') return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Button label="← Back to showroom" secondary small onPress={() => setScreen('showroom')}/><View style={S.authHeader}><Text style={S.eyebrow}>LUCKY BAJAJ CUSTOMER</Text><Text style={S.title}>Your customer space, in your pocket.</Text><Text style={S.body}>Sign in to view your linked bikes and dealership records, or activate the access supplied by Lucky Bajaj.</Text></View><Card><View style={S.wrapRow}><Button testID="customer-auth-mode-login" label="Sign in" small secondary={authMode !== 'login'} onPress={() => setAuthMode('login')}/><Button testID="customer-auth-mode-activate" label="Activate account" small secondary={authMode !== 'activate'} onPress={() => setAuthMode('activate')}/></View>
      {authMode === 'login' ? <>
        <Field testID="customer-login-dealership-code" label="Dealership code" value={login.dealershipCode} onChangeText={v => setLogin(x => ({ ...x, dealershipCode: v.toUpperCase() }))} autoCapitalize="characters"/>
        <View style={S.wrapRow}><Button label="Customer code" small secondary={loginMode !== 'customerCode'} onPress={() => setLoginMode('customerCode')}/><Button label="Username" small secondary={loginMode !== 'username'} onPress={() => setLoginMode('username')}/></View>
        {loginMode === 'username' ? <Field label="Username" value={login.username} onChangeText={v => setLogin(x => ({ ...x, username: v }))} autoCapitalize="none"/> : <Field testID="customer-login-customer-code" label="Customer code" value={login.customerCode} onChangeText={v => setLogin(x => ({ ...x, customerCode: v.toUpperCase() }))} autoCapitalize="characters"/>}
        <Field testID="customer-login-password" label="Password" value={login.password} onChangeText={v => setLogin(x => ({ ...x, password: v }))} secureTextEntry autoCapitalize="none"/>
        <Button testID="customer-login-submit" label={saving ? 'Signing in…' : 'Sign in securely'} disabled={saving || !login.dealershipCode.trim() || !(loginMode === 'username' ? login.username.trim() : login.customerCode.trim()) || !login.password} onPress={() => void signIn()}/>
        <Button label="Continue with Google" secondary disabled={saving || !googleAndroidId || !googleRequest} onPress={() => { if (!login.dealershipCode.trim()) { notify('Enter your dealership code before Google sign-in.'); return; } if (!googleAndroidId) { notify('Google sign-in is not configured for Android yet. Ask the administrator to configure the Android OAuth client.'); return; } void promptGoogle(); }}/>
        {!googleAndroidId ? <Text style={S.meta}>Google sign-in will become available after the Android OAuth client ID is configured on the API.</Text> : null}
      </> : <>
        <Field label="One-time activation token" value={activation.activationToken} onChangeText={v => setActivation(x => ({ ...x, activationToken: v }))} autoCapitalize="none"/>
        <Field label="Create username" value={activation.username} onChangeText={v => setActivation(x => ({ ...x, username: v }))} autoCapitalize="none"/>
        <Field label="Create password (12+ characters)" value={activation.password} onChangeText={v => setActivation(x => ({ ...x, password: v }))} secureTextEntry autoCapitalize="none"/>
        <Field label="Confirm password" value={activation.confirmPassword} onChangeText={v => setActivation(x => ({ ...x, confirmPassword: v }))} secureTextEntry autoCapitalize="none"/>
        <Button label={saving ? 'Activating…' : 'Activate account'} disabled={saving || !activation.activationToken.trim() || !activation.username.trim() || !activation.password} onPress={() => void activateAccount()}/>
      </>}
      <Text style={S.meta}>Only customer records linked to your verified dealership account are shown. Your sign-in never creates a bike sale or payment.</Text>
    </Card></KeyboardAvoidingView>;

    if (screen === 'home') return <>
      <View style={S.portalHero}><Text style={S.eyebrowLight}>{customer?.dealershipName || 'LUCKY BAJAJ AGENCY'}</Text><Text style={S.heroTitleLarge}>Hello, {customer?.fullName?.split(' ')[0] || 'there'}.</Text><Text style={S.heroCopy}>Your motorcycles, service visits, requests and dealership updates—all in one place.</Text><Button label="Explore motorcycles" secondary onPress={() => setScreen('showroom')}/></View>
      <View style={S.stats}>{[[vehicles.length, 'My bikes'], [appointments.filter(a => ['REQUESTED','CONFIRMED'].includes(a.status)).length, 'Open visits'], [notifications.unreadCount, 'Unread updates']].map(([num, label]) => <Card key={label} style={{ width: wide ? '32%' : '31.5%' }}><Text style={S.statNum}>{num}</Text><Text style={S.meta}>{label}</Text></Card>)}</View>
      <Card><Heading title="My motorcycles" subtitle="Vehicles verified against your customer record" right={<Button label="View all" secondary small onPress={() => setScreen('garage')}/>}/>{vehicles.length ? vehicles.slice(0, 3).map(v => <View key={v.publicId} style={S.listRow}><View style={S.flex}><Text style={S.cardTitle}>{v.modelName}{v.variantName ? ' · ' + v.variantName : ''}</Text><Text style={S.meta}>{v.colourName || 'Colour not recorded'}{v.modelYear ? ' · ' + v.modelYear : ''}</Text><Text style={S.meta}>Chassis ending {v.chassisNumber.slice(-5)}</Text></View><Button label="Book service" secondary small onPress={() => { setAppointmentDraft(x => ({ ...x, vehiclePublicId: v.publicId })); setScreen('appointments'); }}/></View>) : <Empty title="No linked motorcycles yet" copy="Ask the dealership to verify the ownership record associated with your customer profile."/>}</Card>
      <Card><Heading title="Next service visit" subtitle="Upcoming workshop appointment" right={<Button label="All visits" secondary small onPress={() => setScreen('appointments')}/>}/>{appointments.filter(a => ['REQUESTED','CONFIRMED'].includes(a.status) && new Date(a.scheduledFor).getTime() > Date.now()).sort((a,b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0] ? <Text style={S.body}>{dateTime(appointments.filter(a => ['REQUESTED','CONFIRMED'].includes(a.status) && new Date(a.scheduledFor).getTime() > Date.now()).sort((a,b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())[0].scheduledFor)}</Text> : <Empty title="No upcoming visit" copy="Request a service appointment when your bike needs attention."/>}<Button label="Request a service visit" onPress={() => setScreen('appointments')}/></Card>
      <Card><Heading title="Your requests" subtitle="Sales and test-ride follow-up" right={<Button label="Track" secondary small onPress={() => setScreen('requests')}/>}/>{requests.slice(0, 2).map(r => <View key={r.publicId} style={S.listRow}><View style={S.flex}><Text style={S.cardTitle}>{r.modelName}</Text><Text style={S.meta}>{pretty(r.requestType)} · {pretty(r.status)}</Text></View><Pill label={pretty(r.status)} tone={r.status === 'CANCELLED' ? 'danger' : 'warning'}/></View>)}{!requests.length ? <Empty title="No requests yet" copy="Choose a motorcycle and send a purchase enquiry or test-ride request."/> : null}</Card>
    </>;

    if (screen === 'garage') return <><Heading title="My motorcycles" subtitle="Only vehicles linked to your verified customer account are visible." right={<Pill label={vehicles.length + ' linked'}/>}/>{vehicles.length ? vehicles.map(v => <Card key={v.publicId}><Text style={S.cardTitle}>{v.modelName}{v.variantName ? ' · ' + v.variantName : ''}</Text><Text style={S.meta}>{v.colourName || 'Colour not recorded'}{v.modelYear ? ' · ' + v.modelYear : ''}</Text><View style={[S.specGrid, wide && S.specGridWide]}>{[['Chassis number', v.chassisNumber], ['Engine number', v.engineNumber], ['Linked since', date(v.ownershipStartedAt)]].map(([k, val]) => <View key={k} style={[S.specBox, { width: wide ? '31%' : '100%' }]}><Text style={S.meta}>{k}</Text><Text style={S.body}>{val}</Text></View>)}</View><Button label="Book service" onPress={() => { setAppointmentDraft(x => ({ ...x, vehiclePublicId: v.publicId })); setScreen('appointments'); }}/></Card>) : <Card><Empty title="No linked motorcycles" copy="Ask Lucky Bajaj to verify the ownership record associated with your customer profile."/></Card>}</>;

    if (screen === 'service') return <><Heading title="Service history" subtitle="Workshop jobs, recorded invoice totals and balances." right={<Pill label={history.length + ' jobs'}/>}/>{history.length ? history.map(j => <Card key={j.jobCardPublicId}><View style={S.rowBetween}><View style={S.flex}><Text style={S.cardTitle}>{j.jobCardCode}</Text><Text style={S.meta}>{j.modelName}{j.variantName ? ' · ' + j.variantName : ''}</Text></View><Pill label={pretty(j.status)} tone={['COMPLETED','DELIVERED'].includes(j.status) ? 'success' : 'warning'}/></View><Text style={S.body}>{j.customerConcern}</Text><View style={[S.specGrid, wide && S.specGridWide]}>{[['Checked in', date(j.checkedInAt)], ['Completed', date(j.completedAt)], ['Handed over', date(j.deliveredAt)]].map(([k,v]) => <View key={k} style={[S.specBox, { width: wide ? '31%' : '100%' }]}><Text style={S.meta}>{k}</Text><Text style={S.body}>{v}</Text></View>)}</View>{j.invoiceNumber ? <View style={S.innerCard}><Text style={S.meta}>OPERATIONAL INVOICE · {j.invoiceNumber}</Text><Text style={S.price}>{money(j.invoiceTotal)}</Text><View style={S.rowBetween}><Text style={S.body}>Recorded paid</Text><Text style={S.cardTitle}>{money(j.paidAmount)}</Text></View><View style={S.rowBetween}><Text style={S.body}>Balance due</Text><Text style={S.cardTitle}>{money(j.balanceDue)}</Text></View><Text style={S.meta}>{j.invoiceNotice}</Text></View> : <Text style={S.meta}>No issued operational invoice is recorded yet.</Text>}</Card>) : <Card><Empty title="No service history yet" copy="Service visits appear here after a workshop job is linked to your account."/></Card>}</>;

    if (screen === 'appointments') return <>
      <Heading title="Service visits" subtitle="Request a workshop appointment and follow its confirmation status."/>
      <Card><Text style={S.cardTitle}>Request a service visit</Text>{vehicles.length ? <>
        <Text style={S.label}>Motorcycle</Text>{vehicles.map(v => <Pressable key={v.publicId} onPress={() => setAppointmentDraft(d => ({ ...d, vehiclePublicId: v.publicId }))} style={[S.option, appointmentDraft.vehiclePublicId === v.publicId && S.optionActive]}><Text style={S.cardTitle}>{v.modelName}{v.variantName ? ' · ' + v.variantName : ''}</Text><Text style={S.meta}>Chassis ending {v.chassisNumber.slice(-5)}</Text></Pressable>)}
        <Text style={S.label}>Preferred date and time</Text><View style={S.wrapRow}><Button label={'Date · ' + date(appointmentDraft.scheduledFor.toISOString())} secondary small onPress={() => setShowDate(true)}/><Button label={'Time · ' + appointmentDraft.scheduledFor.toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit' })} secondary small onPress={() => setShowTime(true)}/></View>
        {showDate ? <DateTimePicker value={appointmentDraft.scheduledFor} mode="date" minimumDate={new Date()} onChange={(_, d) => { setShowDate(Platform.OS === 'ios'); if (d) setAppointmentDraft(x => ({ ...x, scheduledFor: new Date(d.getFullYear(), d.getMonth(), d.getDate(), x.scheduledFor.getHours(), x.scheduledFor.getMinutes()) })); }}/> : null}
        {showTime ? <DateTimePicker value={appointmentDraft.scheduledFor} mode="time" onChange={(_, d) => { setShowTime(Platform.OS === 'ios'); if (d) setAppointmentDraft(x => ({ ...x, scheduledFor: new Date(x.scheduledFor.getFullYear(), x.scheduledFor.getMonth(), x.scheduledFor.getDate(), d.getHours(), d.getMinutes()) })); }}/> : null}
        <View style={S.wrapRow}>{['30','45','60','90','120'].map(n => <Pressable key={n} onPress={() => setAppointmentDraft(x => ({ ...x, slotMinutes: n }))} style={[S.chip, appointmentDraft.slotMinutes === n && S.chipSelected]}><Text style={S.chipText}>{n} min</Text></Pressable>)}</View>
        <Text style={S.label}>Preferred language</Text><View style={S.wrapRow}>{[['hi','हिन्दी'],['en','English'],['hinglish','Hinglish']].map(([value, label]) => <Pressable key={value} onPress={() => setAppointmentDraft(x => ({ ...x, customerLanguage: value }))} style={[S.chip, appointmentDraft.customerLanguage === value && S.chipSelected]}><Text style={S.chipText}>{label}</Text></Pressable>)}</View>
        <Field label="What does your bike need?" value={appointmentDraft.customerConcern} onChangeText={v => setAppointmentDraft(x => ({ ...x, customerConcern: v }))} multiline placeholder="Describe the issue or service needed" testID="customer-appointment-concern"/>
        <Button label={saving ? 'Submitting…' : 'Request appointment'} disabled={saving} onPress={() => void createAppointment()} testID="customer-appointment-submit"/>
      </> : <Empty title="A linked motorcycle is required" copy="Please ask the dealership to verify your motorcycle ownership before requesting service."/>}</Card>
      {appointments.length ? appointments.map(a => <Card key={a.publicId}><View style={S.rowBetween}><Text style={S.cardTitle}>{a.appointmentCode}</Text><Pill label={pretty(a.status)} tone={['CONFIRMED','COMPLETED'].includes(a.status) ? 'success' : 'warning'}/></View><Text style={S.cardTitle}>{a.modelName}{a.variantName ? ' · ' + a.variantName : ''}</Text><Text style={S.meta}>{dateTime(a.scheduledFor)} · {a.slotMinutes} minutes</Text><Text style={S.body}>{a.customerConcern}</Text>{a.statusReason ? <Text style={S.meta}>{a.statusReason}</Text> : null}{['REQUESTED','CONFIRMED'].includes(a.status) ? <><Field label="Cancellation reason" value={cancelReason} onChangeText={setCancelReason} placeholder="Reason for cancellation" testID="customer-appointment-cancel-reason"/><Button label="Cancel appointment" secondary disabled={saving || !cancelReason.trim()} onPress={() => void cancelAppointment(a)} testID="customer-appointment-cancel-submit"/></> : null}</Card>) : <Card><Empty title="No service visits recorded" copy="Your submitted requests will appear here."/></Card>}
    </>;

    if (screen === 'profile') return <><Heading title="My profile" subtitle="Keep your contact and language preferences up to date."/><Card><View style={S.profileRow}><View style={S.avatar}>{customer?.profilePhotoAvailable ? <Image source={{ uri: path('/api/v1/customer/profile/photo') + '?v=' + photoVersion, headers: { Authorization: 'Bearer ' + token } }} style={S.avatarImage}/> : <Text style={S.avatarText}>{(customer?.fullName || 'LB').split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase()}</Text>}</View><View style={S.flex}><Text style={S.cardTitle}>{customer?.fullName}</Text><Text style={S.meta}>Customer code · {customer?.customerCode}</Text><Text style={S.meta}>{customer?.dealershipName}</Text></View></View><View style={S.wrapRow}><Button label="Change photo" secondary small onPress={() => void profilePhoto()}/>{customer?.profilePhotoAvailable ? <Button label="Remove photo" secondary small onPress={removePhoto}/> : null}</View>
      <Field label="Full name" value={profile.fullName} onChangeText={v => setProfile(x => ({ ...x, fullName: v }))} maxLength={160}/><Field label="Mobile number" value={profile.phone} onChangeText={v => setProfile(x => ({ ...x, phone: v }))} keyboardType="phone-pad" maxLength={32}/><Field label="Alternate mobile" value={profile.alternatePhone} onChangeText={v => setProfile(x => ({ ...x, alternatePhone: v }))} keyboardType="phone-pad" maxLength={32}/><Field label="Email" value={profile.email} onChangeText={v => setProfile(x => ({ ...x, email: v }))} keyboardType="email-address" autoCapitalize="none" maxLength={320}/><Text style={S.label}>Preferred language</Text><View style={S.wrapRow}>{[['hi','हिन्दी'],['en','English'],['hinglish','Hinglish']].map(([v,l]) => <Pressable key={v} onPress={() => setProfile(x => ({ ...x, preferredLanguage: v as Customer['preferredLanguage'] }))} style={[S.chip, profile.preferredLanguage === v && S.chipSelected]}><Text style={S.chipText}>{l}</Text></Pressable>)}</View><Button label={saving ? 'Saving…' : 'Save profile'} disabled={saving} onPress={() => void saveProfile()}/><Text style={S.meta}>Keep at least one contact method—mobile number or email—on the account.</Text></Card></>;

    if (screen === 'addresses') return <><Heading title="Saved addresses" subtitle="Keep Home, Work and other useful delivery destinations in your address book." right={<Button label="+ Add" onPress={() => editAddress()} small/>}/>{addressDraft ? <Card><Heading title={editingAddress ? 'Edit address' : 'Add a saved address'} right={<Button label="Close" secondary small onPress={() => { setAddressDraft(null); setEditingAddress(''); }}/>} /><Text style={S.label}>Address label</Text><View style={S.wrapRow}>{(['HOME','WORK','OTHER'] as const).map(v => <Pressable key={v} onPress={() => setAddressDraft(a => a ? { ...a, label: v } : a)} style={[S.chip, addressDraft.label === v && S.chipSelected]}><Text style={S.chipText}>{pretty(v)}</Text></Pressable>)}</View>{([['recipientName','Recipient name'],['phone','Contact mobile'],['addressLine1','Address line 1'],['addressLine2','Address line 2'],['landmark','Landmark'],['locality','Locality / area'],['city','City / town'],['district','District'],['state','State'],['postalCode','PIN / postal code'],['country','Country']] as Array<[keyof AddressDraft,string]>).map(([key,label]) => <Field key={key} label={label} value={String(addressDraft[key] ?? '')} onChangeText={v => setAddressDraft(a => a ? { ...a, [key]: v } : a)} keyboardType={key === 'phone' ? 'phone-pad' : 'default'} autoCapitalize={key === 'postalCode' ? 'characters' : 'sentences'}/>)}
      <Pressable onPress={() => setAddressDraft(a => a ? { ...a, isDefaultDelivery: !a.isDefaultDelivery } : a)} style={S.checkRow}><View style={[S.checkbox, addressDraft.isDefaultDelivery && S.checkboxOn]}><Text style={S.checkboxText}>{addressDraft.isDefaultDelivery ? '✓' : ''}</Text></View><Text style={S.body}>Use as default delivery address</Text></Pressable><Button label={saving ? 'Saving…' : 'Save address'} disabled={saving} onPress={() => void saveAddress()}/></Card> : null}
      {addresses.length ? addresses.map(a => <Card key={a.publicId}><View style={S.rowBetween}><Pill label={pretty(a.label)}/>{a.isDefaultDelivery ? <Pill label="Default delivery" tone="success"/> : null}</View><Text style={S.cardTitle}>{a.recipientName}</Text><Text style={S.body}>{addressText(a)}</Text><Text style={S.meta}>{a.phone}</Text><View style={S.wrapRow}><Button label="Edit" secondary small onPress={() => editAddress(a)}/><Button label="Remove" secondary small onPress={() => deleteAddress(a)}/></View></Card>) : <Card><Empty title="No saved addresses yet" copy="Add home or work details once, then reuse them during parts delivery checkout."/></Card>}</>;

    if (screen === 'purchases') return <><Heading title="Purchases & orders" subtitle="Motorcycle purchase records and spare-parts orders, including cancelled or returned orders." right={<Button label="Refresh" secondary small onPress={() => void refreshOrders()}/>}/><Heading title="Motorcycles purchased" subtitle={purchases.length + ' records'}/>{purchases.length ? purchases.map(p => <Card key={p.publicId}><Text style={S.cardTitle}>{p.modelName}{p.variantName ? ' · ' + p.variantName : ''}</Text><Text style={S.meta}>Invoice · {p.invoiceNumber}</Text><Text style={S.price}>{money(p.invoiceTotal)}</Text><View style={S.rowBetween}><Text style={S.body}>Recorded paid</Text><Text style={S.cardTitle}>{money(p.paidAmount)}</Text></View><View style={S.rowBetween}><Text style={S.body}>Balance</Text><Text style={S.cardTitle}>{money(p.balanceDue)}</Text></View><Text style={S.meta}>Delivered {date(p.deliveredAt)} · {p.deliveredToName}</Text></Card>) : <Card><Empty title="No motorcycle purchases linked" copy="Completed deliveries will appear when the dealership links them to your customer record."/></Card>}
      <Heading title="Spare-parts orders" subtitle={orders.length + ' orders'}/>{orders.length ? orders.map(o => <Card key={o.publicId}><View style={S.rowBetween}><Text style={S.cardTitle}>{o.orderCode}</Text><Pill label={pretty(o.status)} tone={o.status === 'CANCELLED' ? 'danger' : 'warning'}/></View><Text style={S.price}>{money(o.orderTotal)}</Text><Text style={S.meta}>{pretty(o.fulfillmentMethod)} · Payment {pretty(o.paymentStatus)} · {date(o.createdAt)}</Text>{o.lines.map((l,i) => <Text key={i} style={S.body}>{l.quantity} × {l.partName} — {money(l.lineTotal)}</Text>)}<Text style={S.meta}>{o.status === 'CANCELLED' ? 'Order cancelled; reserved stock released' : o.paymentStatus === 'PAID_AT_PICKUP' ? 'Payment recorded at pickup (staff-attested)' : o.paymentStatus === 'PAID_ON_DELIVERY' ? 'Payment recorded on delivery (staff-attested)' : o.paymentStatus === 'REFUND_REVIEW_REQUIRED' ? 'Return recorded; refund review required (no automatic refund)' : o.fulfillmentMethod === 'DELIVERY' ? (o.deliveryQuoteStatus === 'ACCEPTED' ? 'Pay on delivery when it arrives' : 'Pay on delivery after accepting the quoted fee') : 'Pay at dealership pickup'}</Text>{o.fulfillmentMethod === 'DELIVERY' ? <><Text style={S.meta}>Delivery address: {o.deliveryAddress || 'Not recorded'}</Text><Text style={S.meta}>Delivery quote: {pretty(o.deliveryQuoteStatus)}{o.deliveryFee ? ' · ' + money(o.deliveryFee) : ''}</Text>{o.deliveryQuoteNote ? <Text style={S.body}>Quote note: {o.deliveryQuoteNote}</Text> : null}{o.status === 'PLACED' && o.deliveryQuoteStatus === 'AWAITING_STAFF_QUOTE' ? <Text style={S.meta}>Awaiting Lucky Bajaj delivery quote. Current total is the parts subtotal only; delivery fee is not set yet.</Text> : null}{o.status === 'PLACED' && o.deliveryQuoteStatus === 'AWAITING_CUSTOMER_CONFIRMATION' ? <><Text style={S.body}>Review the delivery fee. Accept to proceed or decline to cancel and release reserved stock.</Text><View style={S.wrapRow}><Button label="Accept delivery quote" small onPress={() => void quoteResponse(o, true)}/><Button label="Decline and cancel" secondary small onPress={() => void quoteResponse(o, false)}/></View></> : null}{o.status === 'PLACED' && o.deliveryQuoteStatus === 'ACCEPTED' ? <Text style={S.meta}>Delivery fee accepted: {money(o.deliveryFee)}. Lucky Bajaj can arrange delivery; pay when it arrives.</Text> : null}{o.status === 'CANCELLED' ? <Text style={S.meta}>Delivery request cancelled; stock reservation was released.</Text> : null}</> : null}{o.status === 'RETURNED' && o.returnReason ? <Text style={S.meta}>Return reason: {o.returnReason}. Returned quantity {o.restockedOnReturn ? 'was restocked after inspection' : 'remains excluded from sellable stock'}.</Text> : null}{o.status === 'PLACED' ? <Button label="Cancel and release stock" secondary small onPress={() => cancelOrder(o)}/> : null}</Card>) : <Card><Empty title="No parts orders yet" copy="Orders you submit from the Parts tab will appear here. Online payment is not initiated by this app."/></Card>}</>;

    if (screen === 'requests') return <><Heading title="Test rides & purchase enquiries" subtitle="Follow your request through enquiry, test ride, booking, invoice and delivery records." right={<Button label="Refresh" secondary small onPress={() => token ? void api<SalesRequest[]>('/api/v1/customer/sales-requests', token).then(setRequests).catch(c => notify(c instanceof Error ? c.message : 'Requests could not refresh.')) : undefined}/>}/>{pendingIntent || pendingIntentError ? <Card><Heading title="Saved showroom selection" subtitle="Your selected motorcycle is saved on this device until you retry or discard it."/>{pendingIntent ? <Text style={S.body}>{pretty(pendingIntent.action)} · {pendingIntent.modelName}{pendingIntent.preferredAt ? ' · Preferred ' + dateTime(pendingIntent.preferredAt) : ''}</Text> : null}{pendingIntentError ? <Text style={S.meta}>{pendingIntentError}</Text> : null}<View style={S.wrapRow}><Button label={saving ? 'Retrying…' : 'Retry saved request'} disabled={saving || !pendingIntent} onPress={() => void retryPendingRequest()}/><Button label="Discard saved selection" secondary disabled={saving} onPress={() => void discardPendingRequest()}/></View></Card> : null}{requests.length ? requests.map(r => <Card key={r.publicId}><View style={S.rowBetween}><View style={S.flex}><Text style={S.cardTitle}>{r.modelName}</Text><Text style={S.meta}>{r.requestCode} · {pretty(r.requestType)}</Text></View><Pill label={pretty(r.status)} tone={r.status === 'CANCELLED' ? 'danger' : 'warning'}/></View><Text style={S.meta}>Submitted {dateTime(r.createdAt)}</Text>{r.preferredAt ? <Text style={S.body}>Preferred test ride · {dateTime(r.preferredAt)}</Text> : null}{r.notes ? <Text style={S.body}>{r.notes}</Text> : null}<View style={S.stepList}>{[['Enquiry',r.enquiryCode,r.enquiryStatus],['Test ride',r.testRideCode,r.testRideStatus],['Booking',r.bookingCode,r.bookingStatus],['Invoice',r.invoiceNumber,r.invoiceStatus]].map(([label,code,status]) => <View key={label} style={S.stepRow}><View style={S.stepDot}/><View style={S.flex}><Text style={S.cardTitle}>{label}</Text><Text style={S.meta}>{code || 'Not recorded'}{status ? ' · ' + pretty(status) : ''}</Text></View></View>)}</View>{r.invoiceTotal != null ? <><Text style={S.price}>{money(r.invoiceTotal)}</Text><Text style={S.meta}>Paid {money(r.paidAmount)} · Balance {money(r.balanceDue)}</Text></> : null}{r.deliveredAt ? <Text style={S.meta}>Delivered {dateTime(r.deliveredAt)}</Text> : null}{r.status === 'REQUESTED' ? <Button label="Cancel request" secondary small onPress={() => Alert.alert('Cancel request?', 'This will request cancellation of ' + r.requestCode + '.', [{text:'Keep',style:'cancel'},{text:'Cancel',style:'destructive',onPress:()=>{setSaving(true);void api('/api/v1/customer/sales-requests/' + r.publicId + '/cancel', token, {method:'POST'}).then(()=>api<SalesRequest[]>('/api/v1/customer/sales-requests', token)).then(setRequests).then(()=>notify('Request cancelled.',true)).catch(c=>notify(c instanceof Error ? c.message : 'Request could not be cancelled.')).finally(()=>setSaving(false));}}])}/> : null}</Card>) : <Card><Empty title="No enquiries yet" copy="Choose a motorcycle in the showroom to send a purchase enquiry or test-ride request."/></Card>}</>;

    if (screen === 'parts') return <><Heading title="Genuine parts & accessories" subtitle="Browse the dealership's published catalogue. Availability and fitment must be verified." right={<Button label={'Cart ' + cartCount} onPress={() => setScreen('cart')} small/>}/><Field label="Search parts" value={partSearch} onChangeText={setPartSearch} placeholder="Part name, SKU or part number" autoCapitalize="none"/><Card style={{ gap: 10 }}>
      <Pressable
        onPress={() => setPartFiltersExpanded(expanded => !expanded)}
        accessibilityRole="button"
        accessibilityLabel={partFiltersExpanded ? 'Hide filters' : 'Show filters'}
        accessibilityState={{ expanded: partFiltersExpanded }}
        style={S.rowBetween}
      >
        <Text style={S.cardTitle}>Filters</Text>
        <Text style={S.label}>{partFiltersExpanded ? 'Hide filters −' : 'Show filters +'}</Text>
      </Pressable>
      {partFiltersExpanded ? <>

      <Text style={S.label}>Part category</Text>
      <View style={S.wrapRow}>{['ALL', ...partFilters.categories].map(k => <Pressable key={k} style={[S.chip, partCategory === k && S.chipSelected]} onPress={() => setPartCategory(k)}><Text style={S.chipText}>{k === 'ALL' ? 'All categories' : pretty(k)}</Text></Pressable>)}</View>
      <Text style={S.label}>Motorcycle type</Text>
      <View style={S.wrapRow}>{['', ...Array.from(new Set(partFilters.motorcycleModels.map(m => m.category))).sort()].map(k => <Pressable key={k || 'all-types'} style={[S.chip, partBikeType === k && S.chipSelected]} onPress={() => { setPartBikeType(k); setPartModel(''); }}><Text style={S.chipText}>{k ? pretty(k) : 'All types'}</Text></Pressable>)}</View>
      <Text style={S.label}>Motorcycle model</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.chips}>{[{modelCode:'',modelName:'All models'},...partFilters.motorcycleModels.filter(m => !partBikeType || m.category === partBikeType)].map(m => <Pressable key={m.modelCode || 'all-models'} onPress={() => { setPartModel(m.modelCode); if (m.modelCode) setFitmentModel(m.modelCode); }} style={[S.chip, partModel === m.modelCode && S.chipSelected]}><Text style={S.chipText}>{m.modelName}</Text></Pressable>)}</ScrollView>
      <Text style={S.label}>Availability</Text>
      <View style={S.wrapRow}>{[['ALL','Any status'],['AVAILABLE','In stock'],['OUT_OF_STOCK','Out of stock'],['CHECK_WITH_DEALER','Check with dealership']].map(([k,l]) => <Pressable key={k} style={[S.chip, partAvailability === k && S.chipSelected]} onPress={() => setPartAvailability(k)}><Text style={S.chipText}>{l}</Text></Pressable>)}</View>
      <View style={[S.fieldGrid, wide && S.fieldGridWide]}>
        <View style={{ width: wide ? '48%' : '100%' }}><Field label="Minimum price (₹)" value={partMinPrice} onChangeText={setPartMinPrice} keyboardType="numeric" placeholder="No minimum"/></View>
        <View style={{ width: wide ? '48%' : '100%' }}><Field label="Maximum price (₹)" value={partMaxPrice} onChangeText={setPartMaxPrice} keyboardType="numeric" placeholder="No maximum"/></View>
      </View>
      <Text style={S.label}>Sort by</Text>
      <View style={S.wrapRow}>{[['CATEGORY','Category'],['NAME','Name'],['PRICE_LOW','Price: low to high'],['PRICE_HIGH','Price: high to low']].map(([k,l]) => <Pressable key={k} style={[S.chip, partSort === k && S.chipSelected]} onPress={() => setPartSort(k as typeof partSort)}><Text style={S.chipText}>{l}</Text></Pressable>)}</View>
      <View style={S.rowBetween}><Text style={S.meta}>{filteredParts.length} matching item(s)</Text><Button label="Clear filters" secondary small onPress={() => { setPartSearch(''); setPartCategory('ALL'); setPartBikeType(''); setPartModel(''); setPartAvailability('ALL'); setPartMinPrice(''); setPartMaxPrice(''); setPartSort('CATEGORY'); }}/></View>
    
      </> : null}
    </Card>
      {filteredParts.length ? <View style={[S.partsGrid, wide && S.partsGridWide]}>{filteredParts.map(p => <Card key={p.publicId} style={{width:wide?'48.5%':'100%'}}>{p.imageUrl ? <Image source={{uri:p.imageUrl.startsWith('http')?p.imageUrl:path(p.imageUrl)}} style={S.partImage} resizeMode="contain"/> : <View style={S.imageFallback}><Text style={S.heroMark}>LB</Text></View>}<Text style={S.cardTitle}>{p.partName}</Text><Text style={S.meta}>SKU {p.skuCode}{p.partNumber ? ' · Part no. ' + p.partNumber : ''}</Text><Text style={S.body}>{p.description || 'Dealership-listed spare part.'}</Text>{p.partNumber ? <Text style={S.meta}>OEM part number: {p.partNumber}</Text> : null}<Text style={S.meta}>{p.fitmentVerified ? p.fitmentModelCodes.length ? 'Verified for ' + p.fitmentModelCodes.map(code => partFilters.motorcycleModels.find(model => model.modelCode === code)?.modelName || code).join(', ') : 'Dealership-confirmed universal fitment' : 'Exact model compatibility must be confirmed by Lucky Bajaj.'}</Text>{p.sourceUrl ? <Button label="Bajaj spares reference ↗" secondary small onPress={() => void Linking.openURL(p.sourceUrl!)}/> : null}<Text style={S.price}>{money(p.retailPrice)}</Text><View style={S.wrapRow}><Pill label={p.available ? 'Available' : pretty(p.availabilityStatus)} tone={p.available ? 'success' : 'warning'}/>{p.fitmentVerified ? <Pill label="Fitment verified" tone="success"/> : <Pill label="Fitment to confirm"/>}</View><Text style={S.meta}>{p.available ? p.quantityAvailable + ' ' + p.unitOfMeasure + ' recorded available' : 'Availability must be confirmed by the dealership'}</Text><Button label="Add to cart" disabled={!p.available || !p.retailPrice} onPress={() => addCart(p, 1)}/></Card>)}</View> : <Card><Empty title="No parts match these filters" copy="Change the search or filters, or ask the dealership about a part that is not listed."/></Card>}</>;

    if (screen === 'cart') return <><Heading title="Shopping cart" subtitle={cartCount + ' units · parts order request only'}/>{cart.length ? <Card>{cart.map(line => { const p = parts.find(v => v.publicId === line.partPublicId); if (!p) return null; return <View key={line.partPublicId} style={S.listRow}><View style={S.flex}><Text style={S.cardTitle}>{p.partName}</Text><Text style={S.meta}>{money(p.retailPrice)} each · {p.unitOfMeasure}</Text><Text style={S.cardTitle}>{money((p.retailPrice || 0) * line.quantity)}</Text></View><View style={S.qty}><Button label="−" secondary small onPress={() => addCart(p, -1)}/><Text style={S.cardTitle}>{line.quantity}</Text><Button label="+" secondary small onPress={() => addCart(p, 1)}/></View></View>; })}<View style={S.rowBetween}><Text style={S.cardTitle}>Estimated parts subtotal</Text><Text style={S.price}>{money(cartTotal)}</Text></View><Text style={S.meta}>Delivery fees and final availability are confirmed by Lucky Bajaj. No online payment is taken here.</Text><Text style={S.label}>Motorcycle for fitment checking</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{partFilters.motorcycleModels.map(m => <Pressable key={m.modelCode} onPress={() => setFitmentModel(m.modelCode)} style={[S.chip, fitmentModel === m.modelCode && S.chipSelected]}><Text style={S.chipText}>{m.modelName}</Text></Pressable>)}</ScrollView><Text style={S.label}>Fulfilment</Text><View style={S.wrapRow}><Button label="Pickup" secondary={fulfilment !== 'PICKUP'} onPress={() => setFulfilment('PICKUP')} small/><Button label="Delivery" secondary={fulfilment !== 'DELIVERY'} onPress={() => setFulfilment('DELIVERY')} small/></View>{fulfilment === 'DELIVERY' ? <><Text style={S.label}>Saved delivery address</Text>{addresses.map(a => <Pressable key={a.publicId} onPress={() => setDeliveryAddress(addressText(a))} style={[S.option, deliveryAddress === addressText(a) && S.optionActive]}><Text style={S.cardTitle}>{a.label}{a.isDefaultDelivery ? ' · Default' : ''}</Text><Text style={S.meta}>{addressText(a)}</Text></Pressable>)}<Field label="Or enter a delivery address" value={deliveryAddress} onChangeText={setDeliveryAddress} multiline/></> : null}<Field label="Note to dealership (optional)" value={orderNote} onChangeText={setOrderNote} multiline placeholder="Anything the parts team should know?"/><Button label={saving ? 'Placing request…' : 'Place parts order'} disabled={saving || !cart.length} onPress={() => void placeOrder()}/></Card> : <Card><Empty title="Your cart is empty" copy="Add available parts to build your order, then confirm pickup or delivery."/><Button label="Browse parts" onPress={() => setScreen('parts')}/></Card>}</>;

    if (screen === 'updates') return <>
      <Heading title="Dealership updates" subtitle={notifications.unreadCount + ' unread updates'}/>
      <View style={S.wrapRow}>
        <Button small secondary label={noticeUnreadOnly ? 'Show all updates' : 'Unread only'} onPress={() => void toggleNoticeFilter()}/>
        <Text style={S.meta}>{notifications.items.length} of {notifications.total} loaded</Text>
      </View>
      {notifications.items.length ? notifications.items.map(n => <Card key={n.recipientPublicId}>
        <View style={S.rowBetween}><Text style={S.cardTitle}>{n.title}</Text>{!n.readAt ? <Pill label="NEW" tone="warning"/> : null}</View>
        <Text style={S.body}>{n.summary}</Text>
        <Text style={S.meta}>{n.senderName} · {dateTime(n.createdAt)}</Text>
        <NotificationContent raw={n.contentDocumentJson} token={token} onNavigate={setScreen}/>
        <View style={S.wrapRow}>
          <Button label={n.readAt ? 'Mark unread' : 'Mark read'} secondary small onPress={() => void updateNotice(n, n.readAt ? 'unread' : 'read')}/>
          <Button label="Dismiss" secondary small onPress={() => void updateNotice(n, 'dismiss')}/>
        </View>
      </Card>) : <Card><Empty title="No notifications yet" copy="Service reminders and messages sent to your customer account will appear here."/></Card>}
      {notifications.items.length < notifications.total ? <Button label={loadingMoreNotices ? 'Loading more updates…' : 'Load more updates'} secondary disabled={loadingMoreNotices} onPress={() => void loadMoreNotices()}/> : null}
    </>;

    if (screen === 'more') return <><Heading title="More customer features" subtitle="Your account, requests, saved records and support information."/><View style={[S.moreGrid, wide && S.moreGridWide]}>{MORE.map(item => <View key={item.key} style={{width:wide?'48.5%':'100%'}}><ScreenButton title={item.title} copy={item.copy} icon={item.icon} onPress={() => setScreen(item.key)}/></View>)}</View><Card><Text style={S.cardTitle}>Account security</Text><Text style={S.body}>Sign out to clear this device's customer session. Your dealership records remain preserved.</Text><Button label="Sign out" secondary onPress={() => void logout()}/></Card></>;
    if (screen === 'privacy') return <LegalScreen kind="privacy" onNavigate={setScreen}/>;
    if (screen === 'terms') return <LegalScreen kind="terms" onNavigate={setScreen}/>;
    return <Card><Empty title="Choose a customer feature" copy="Use the navigation below to return to your showroom or account."/></Card>;
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'bike' || screen === 'signin' || screen === 'signup' || screen === 'privacy' || screen === 'terms') {
        setScreen('showroom');
        return true;
      }
      if (screen === 'cart') {
        setScreen('parts');
        return true;
      }
      if (token && screen !== 'home') {
        setScreen('home');
        return true;
      }
      if (!token && screen !== 'showroom') {
        setScreen('showroom');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [screen, token]);

  const authScreen = !token && ['signin','signup'].includes(screen);
  return <SafeAreaView style={S.safe}><EditionBackdrop style={S.backdrop}>
    <StatusBar barStyle="dark-content" backgroundColor={C.canvas}/>
    <View style={S.topBar}><View style={S.brandMarkSmall}><Text style={S.brandMarkText}>LB</Text></View><View style={S.flex} testID="customer-brand-name" collapsable={false}><Text style={S.brandName}>LUCKY BAJAJ</Text><Text style={S.brandCaption}>{customer?.dealershipName || 'A QuantaEdge customer experience'}</Text></View>
      {token ? <Pressable onPress={() => setScreen('more')} style={S.headerButton}><Text style={S.headerButtonText}>{(customer?.fullName || 'You').split(' ')[0]}</Text></Pressable> : <Pressable onPress={() => setScreen('signin')} style={S.headerButton}><Text style={S.headerButtonText}>Sign in</Text></Pressable>}
    </View>
    <EditionContentTarget style={S.contentTarget}>
      <View style={S.glassContentInset}>
    {error ? <Notice message={error}/> : null}{success ? <Notice message={success} good/> : null}
    {loading || loadingData ? <View style={S.loading}><ActivityIndicator color={C.orange}/><Text style={S.meta}>{loading ? 'Opening your customer space…' : 'Syncing your customer records…'}</Text></View> : null}
    <ScrollView key={screen} style={S.scroll} contentContainerStyle={[S.content, wide && S.contentWide]} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={C.orange}/>}>
      {!loading ? renderContent() : null}
      <View style={S.footer}><Text style={S.meta}>YOUR DETAILS STAY WITH YOUR VERIFIED CUSTOMER RECORD</Text><Text style={S.meta}>Powered by QuantaEdge for Lucky Bajaj Agency</Text></View>
    </ScrollView>
      </View>
    </EditionContentTarget>
    <GlassOverlay intensity={46} placement="top"/>
    <GlassOverlay intensity={58} placement="bottom"/>

    {authScreen ? <View style={S.authBottom}><Button label="Return to showroom" secondary onPress={() => { setScreen('showroom'); setError(''); setSuccess(''); }}/></View> : <View style={S.bottomNav}>{(token ? NAV : [{key:'showroom' as Screen,label:'Bikes',icon:'◈'},{key:'signin' as Screen,label:'Sign in',icon:'↗'},{key:'privacy' as Screen,label:'Privacy',icon:'⌑'}]).map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{selected:screen === item.key}} onPress={() => { setError(''); setSuccess(''); setScreen(item.key); }} style={[S.navItem, screen === item.key && S.navActive]}><Text style={[S.navIcon, screen === item.key && S.navTextActive]}>{item.icon}</Text><Text numberOfLines={1} style={[S.navLabel, screen === item.key && S.navTextActive]}>{item.label}</Text>{item.key === 'updates' && notifications.unreadCount > 0 ? <View style={S.dot}/> : null}{item.key === 'parts' && cartCount > 0 ? <View style={S.dot}/> : null}</Pressable>)}</View>}
  </EditionBackdrop></SafeAreaView>;
}

