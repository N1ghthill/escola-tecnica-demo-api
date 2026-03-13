import { createHash } from "crypto";

const META_GRAPH_API_BASE_URL = "https://graph.facebook.com";
const DEFAULT_META_GRAPH_API_VERSION = "v22.0";
const DEFAULT_META_TIMEOUT_MS = 4_500;

type MetaConversionsConfig = {
  enabled: boolean;
  pixelId: string;
  accessToken: string;
  apiVersion: string;
  timeoutMs: number;
  testEventCode: string | null;
};

type MetaConversionCommonInput = {
  leadId?: string | null;
  leadCode?: string | null;
  sourceUrl?: string | null;
  courseSlug?: string | null;
  courseName?: string | null;
  amountCents?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  customerCountry?: string | null;
  attribution?: Record<string, string | null | undefined>;
  clickIds?: Record<string, string | null | undefined>;
  fbc?: string | null;
  fbp?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

type MetaEventDispatchInput = MetaConversionCommonInput & {
  eventName: "Lead" | "CompleteRegistration" | "Contact";
  eventId?: string | null;
  requireLeadId?: boolean;
  customData?: Record<string, unknown>;
};

export type MetaLeadConversionInput = MetaConversionCommonInput & {
  leadId: string;
  eventId?: string | null;
};

export type MetaCompleteRegistrationConversionInput = MetaConversionCommonInput & {
  leadId: string;
  eventId?: string | null;
};

export type MetaContactConversionInput = MetaConversionCommonInput & {
  eventId?: string | null;
  contactChannel?: string | null;
  whatsappUrl?: string | null;
  preMatriculaOk?: boolean | null;
};

function sanitizeEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function sanitizeText(value: unknown, maxLen = 240): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.length > maxLen ? normalized.slice(0, maxLen) : normalized;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const raw = sanitizeText(value, 20)?.toLowerCase();
  if (!raw) return undefined;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return undefined;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = sanitizeEnv(name).toLowerCase();
  if (!raw) return defaultValue;
  return !["0", "false", "no", "off"].includes(raw);
}

function parseTimeoutMs(rawValue: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_META_TIMEOUT_MS;
  if (parsed > 20_000) return 20_000;
  return Math.trunc(parsed);
}

function resolveApiVersion(raw: string): string {
  const normalized = raw.toLowerCase();
  if (/^v\d+\.\d+$/.test(normalized)) return normalized;
  return DEFAULT_META_GRAPH_API_VERSION;
}

function resolveMetaConversionsConfig(): MetaConversionsConfig {
  const pixelId = onlyDigits(sanitizeEnv("META_PIXEL_ID") || sanitizeEnv("FACEBOOK_PIXEL_ID"));
  const accessToken =
    sanitizeEnv("META_CONVERSIONS_ACCESS_TOKEN") ||
    sanitizeEnv("META_ACCESS_TOKEN") ||
    sanitizeEnv("FACEBOOK_CONVERSIONS_ACCESS_TOKEN");
  const apiVersion = resolveApiVersion(sanitizeEnv("META_GRAPH_API_VERSION"));
  const timeoutMs = parseTimeoutMs(sanitizeEnv("META_CONVERSIONS_TIMEOUT_MS"));
  const testEventCode = sanitizeText(sanitizeEnv("META_TEST_EVENT_CODE"), 120);
  const enabledByFlag = parseBooleanEnv("META_CONVERSIONS_ENABLED", true);
  const hasCredentials = Boolean(pixelId && accessToken);

  return {
    enabled: enabledByFlag && hasCredentials,
    pixelId,
    accessToken,
    apiVersion,
    timeoutMs,
    testEventCode
  };
}

function normalizePeopleToken(value: unknown, maxLen = 120): string | null {
  const raw = sanitizeText(value, maxLen);
  if (!raw) return null;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function normalizeEmail(value: unknown): string | null {
  const raw = sanitizeText(value, 180);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  return normalized.includes("@") ? normalized : null;
}

function normalizePhone(value: unknown): string | null {
  const digits = onlyDigits(value);
  if (!digits) return null;

  const withCountryCode = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (withCountryCode.length < 10 || withCountryCode.length > 15) return null;
  return withCountryCode;
}

function normalizeZip(value: unknown): string | null {
  const raw = sanitizeText(value, 24);
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/\s+/g, "").replace(/-/g, "");
  return normalized || null;
}

function normalizeCountry(value: unknown): string | null {
  const raw = sanitizeText(value, 8);
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return null;
  return normalized.length >= 2 ? normalized.slice(0, 2) : normalized;
}

function normalizeMetaCookieId(value: unknown): string | null {
  return sanitizeText(value, 320);
}

function normalizeIpAddress(value: unknown): string | null {
  const raw = sanitizeText(value, 120);
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() || "";
  return first || null;
}

function normalizeValueFromCents(value: unknown): number {
  const cents = Math.max(0, Number(value || 0));
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

function sanitizeUrl(value: unknown): string | null {
  const raw = sanitizeText(value, 800);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeJsonParse(raw: string): Record<string, unknown> | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== "")
  );
}

function resolveReference(input: MetaConversionCommonInput): string | null {
  return sanitizeText(input.leadId, 120) || sanitizeText(input.leadCode, 120);
}

function buildDefaultEventId(eventName: string, input: MetaConversionCommonInput): string {
  const reference = resolveReference(input) || `${Date.now()}`;
  const eventPrefix = String(eventName || "event")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${eventPrefix || "event"}-${reference}`;
}

function buildUserData(input: MetaConversionCommonInput): Record<string, unknown> {
  const normalizedEmail = normalizeEmail(input.customerEmail);
  const normalizedPhone = normalizePhone(input.customerPhone);
  const normalizedFullName = normalizePeopleToken(input.customerName, 160);
  const nameParts = normalizedFullName ? normalizedFullName.split(" ").filter(Boolean) : [];
  const normalizedFn = nameParts[0] || null;
  const normalizedLn = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : null;
  const normalizedCity = normalizePeopleToken(input.customerCity);
  const normalizedState = normalizePeopleToken(input.customerState, 80);
  const normalizedZip = normalizeZip(input.customerZip);
  const normalizedCountry = normalizeCountry(input.customerCountry || "br");
  const fbc = normalizeMetaCookieId(input.fbc);
  const fbp = normalizeMetaCookieId(input.fbp);
  const clientIpAddress = normalizeIpAddress(input.clientIpAddress);
  const clientUserAgent = sanitizeText(input.clientUserAgent, 600);
  const externalId = resolveReference(input);

  const userData: Record<string, unknown> = {};
  if (normalizedEmail) userData.em = [sha256(normalizedEmail)];
  if (normalizedPhone) userData.ph = [sha256(normalizedPhone)];
  if (normalizedFn) userData.fn = [sha256(normalizedFn)];
  if (normalizedLn) userData.ln = [sha256(normalizedLn)];
  if (normalizedCity) userData.ct = [sha256(normalizedCity)];
  if (normalizedState) userData.st = [sha256(normalizedState)];
  if (normalizedZip) userData.zp = [sha256(normalizedZip)];
  if (normalizedCountry) userData.country = [sha256(normalizedCountry)];
  if (externalId) userData.external_id = [sha256(externalId)];
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
  if (clientIpAddress) userData.client_ip_address = clientIpAddress;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;
  return compactObject(userData);
}

function buildBaseCustomData(input: MetaConversionCommonInput): Record<string, unknown> {
  const courseSlug = sanitizeText(input.courseSlug, 120);
  const courseName = sanitizeText(input.courseName, 160) || courseSlug || "Curso tecnico";
  const leadCode = sanitizeText(input.leadCode, 40);
  const leadId = sanitizeText(input.leadId, 80);
  const value = normalizeValueFromCents(input.amountCents);

  const customData: Record<string, unknown> = {
    currency: "BRL",
    value,
    content_name: courseName,
    content_type: "course",
    content_ids: courseSlug ? [courseSlug] : undefined,
    lead_id: leadId || undefined,
    lead_code: leadCode || undefined
  };

  const attribution = input.attribution || {};
  if (attribution.utm_source) customData.utm_source = attribution.utm_source;
  if (attribution.utm_medium) customData.utm_medium = attribution.utm_medium;
  if (attribution.utm_campaign) customData.utm_campaign = attribution.utm_campaign;
  if (attribution.utm_content) customData.utm_content = attribution.utm_content;
  if (attribution.utm_term) customData.utm_term = attribution.utm_term;

  const clickIds = input.clickIds || {};
  if (clickIds.fbclid) customData.fbclid = clickIds.fbclid;
  if (clickIds.gclid) customData.gclid = clickIds.gclid;
  if (clickIds.wbraid) customData.wbraid = clickIds.wbraid;
  if (clickIds.gbraid) customData.gbraid = clickIds.gbraid;

  return compactObject(customData);
}

async function sendMetaEvent(input: MetaEventDispatchInput): Promise<boolean> {
  const config = resolveMetaConversionsConfig();
  if (!config.enabled) return false;

  const normalizedLeadId = sanitizeText(input.leadId, 80);
  if (input.requireLeadId && !normalizedLeadId) return false;

  const eventId = sanitizeText(input.eventId, 180) || buildDefaultEventId(input.eventName, input);
  const eventSourceUrl = sanitizeUrl(input.sourceUrl);
  const userData = buildUserData({
    ...input,
    leadId: normalizedLeadId || input.leadCode || undefined
  });
  const baseCustomData = buildBaseCustomData(input);
  const mergedCustomData = compactObject({
    ...baseCustomData,
    ...(input.customData || {})
  });
  const endpoint = `${META_GRAPH_API_BASE_URL}/${config.apiVersion}/${config.pixelId}/events?access_token=${encodeURIComponent(
    config.accessToken
  )}`;

  const eventPayload: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_id: eventId,
    user_data: userData
  };
  if (eventSourceUrl) eventPayload.event_source_url = eventSourceUrl;
  if (Object.keys(mergedCustomData).length) eventPayload.custom_data = mergedCustomData;

  const body: Record<string, unknown> = {
    data: [eventPayload]
  };
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    const rawResponse = await response.text();
    if (!response.ok) {
      console.error("Meta CAPI event failed", {
        eventName: input.eventName,
        status: response.status,
        eventId,
        leadId: normalizedLeadId,
        body: rawResponse.slice(0, 400)
      });
      return false;
    }

    const parsed = safeJsonParse(rawResponse);
    if (parsed?.error) {
      console.error("Meta CAPI returned API error", {
        eventName: input.eventName,
        eventId,
        leadId: normalizedLeadId,
        error: parsed.error
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("Meta CAPI event request exception", {
      eventName: input.eventName,
      eventId,
      leadId: normalizedLeadId,
      error
    });
    return false;
  }
}

export function isMetaConversionsEnabled(): boolean {
  return resolveMetaConversionsConfig().enabled;
}

export async function sendMetaLeadConversion(input: MetaLeadConversionInput): Promise<boolean> {
  const reference = sanitizeText(input.leadId || input.leadCode, 120) || `${Date.now()}`;
  const eventId = sanitizeText(input.eventId, 180) || `lead-${reference}`;
  return sendMetaEvent({
    ...input,
    eventName: "Lead",
    eventId,
    requireLeadId: true
  });
}

export async function sendMetaCompleteRegistrationConversion(
  input: MetaCompleteRegistrationConversionInput
): Promise<boolean> {
  const reference = sanitizeText(input.leadId || input.leadCode, 120) || `${Date.now()}`;
  const eventId = sanitizeText(input.eventId, 180) || `complete-registration-${reference}`;
  return sendMetaEvent({
    ...input,
    eventName: "CompleteRegistration",
    eventId,
    requireLeadId: true,
    customData: {
      registration_method: "pre_matricula_form",
      registration_status: "submitted"
    }
  });
}

export async function sendMetaContactConversion(input: MetaContactConversionInput): Promise<boolean> {
  const explicitReference = resolveReference(input);
  const fallbackReference = explicitReference || sanitizeText(input.eventId, 120) || `${Date.now()}`;
  const eventId = sanitizeText(input.eventId, 180) || `contact-${fallbackReference}`;
  const contactChannel = sanitizeText(input.contactChannel, 80) || "whatsapp";
  const whatsappUrl = sanitizeUrl(input.whatsappUrl);
  const preMatriculaOk = sanitizeBoolean(input.preMatriculaOk);

  return sendMetaEvent({
    ...input,
    leadId: sanitizeText(input.leadId, 80) || sanitizeText(input.leadCode, 80) || fallbackReference,
    eventName: "Contact",
    eventId,
    requireLeadId: false,
    customData: {
      contact_channel: contactChannel,
      whatsapp_url: whatsappUrl || undefined,
      pre_matricula_ok: preMatriculaOk
    }
  });
}
