import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { query } from "../lib/db.js";
import {
  getDemoLeadCreateResponse,
  getDemoLeadLookupResponse,
  getDemoLeadUpdateResponse,
  isDemoMode,
  listDemoCourses
} from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";
import { sendMetaLeadConversion } from "../lib/metaConversions.js";
import { rateLimit } from "../lib/rateLimit.js";
import { isTelegramEnabled, sendTelegramMessage } from "../lib/telegram.js";

type Address = {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
};

type CourseRequirementsAck = {
  minimum_experience_two_years: boolean;
  coren_active_two_years_auxiliar: boolean;
  professional_link_proof: boolean;
  professional_link_proof_type: "ctps" | "contrato_publico" | null;
};

type CourseRequirementRule = {
  minimum_experience_two_years: boolean;
  coren_active_two_years_auxiliar: boolean;
  professional_link_proof: boolean;
  professional_link_proof_types: Array<"ctps" | "contrato_publico">;
};

type CourseLookupRow = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  course_requirements: unknown | null;
};

type LeadLookupRow = {
  id: string;
  course_slug: string;
  course_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  cpf: string | null;
  birth_date: string | null;
  father_name: string;
  mother_name: string;
  address: Record<string, unknown> | null;
  payment_status: string | null;
  payment_reference: string | null;
  payment_tid: string | null;
  payment_return_code: string | null;
  payment_return_message: string | null;
  created_at: string;
  payment_updated_at: string | null;
  paid_at: string | null;
  first_contact_at: string | null;
  contact_channel: string | null;
  contact_owner: string | null;
};

type LeadUpdateRow = {
  id: string;
  payment_status: string | null;
  payment_updated_at: string | null;
  first_contact_at: string | null;
  contact_channel: string | null;
  contact_owner: string | null;
};

type LeadAttribution = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

type LeadClickIds = {
  fbclid: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
};

type LeadMetaClickIds = {
  fbc: string | null;
  fbp: string | null;
};

const ALLOWED_PAYMENT_STATUS = new Set([
  "pending",
  "processing",
  "approved",
  "pending_authentication",
  "declined",
  "provider_unavailable"
]);
const CRM_LEAD_STATUS = {
  novo_lead: "novo_lead",
  em_atendimento: "em_atendimento",
  venda_concluida: "venda_concluida",
  remarketing: "remarketing",
  aguardando_retorno: "aguardando_retorno"
} as const;
const CRM_LEAD_STATUS_VALUES = new Set<string>(Object.values(CRM_LEAD_STATUS));
const LEGACY_STATUS_TO_CRM: Record<string, string> = {
  pending: CRM_LEAD_STATUS.novo_lead,
  processing: CRM_LEAD_STATUS.em_atendimento,
  approved: CRM_LEAD_STATUS.venda_concluida,
  declined: CRM_LEAD_STATUS.remarketing,
  provider_unavailable: CRM_LEAD_STATUS.remarketing,
  pending_authentication: CRM_LEAD_STATUS.aguardando_retorno
};
const CRM_STATUS_QUERY_VARIANTS: Record<string, string[]> = {
  [CRM_LEAD_STATUS.novo_lead]: [CRM_LEAD_STATUS.novo_lead, "pending"],
  [CRM_LEAD_STATUS.em_atendimento]: [CRM_LEAD_STATUS.em_atendimento, "processing"],
  [CRM_LEAD_STATUS.venda_concluida]: [CRM_LEAD_STATUS.venda_concluida, "approved"],
  [CRM_LEAD_STATUS.remarketing]: [CRM_LEAD_STATUS.remarketing, "declined", "provider_unavailable"],
  [CRM_LEAD_STATUS.aguardando_retorno]: [CRM_LEAD_STATUS.aguardando_retorno, "pending_authentication"]
};
const ALLOWED_CONTACT_CHANNEL = new Set(["whatsapp", "phone", "email", "other"]);
const PROFESSIONAL_LINK_PROOF_TYPES = new Set(["ctps", "contrato_publico"]);
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
let hasCourseOffersRequirementsSchema: boolean | null = null;

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function sanitizeString(value: unknown, maxLen = 240): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeUtmValue(value: unknown): string | null {
  const normalized = sanitizeString(value, 120);
  return normalized ? normalized.toLowerCase() : null;
}

function sanitizeClickIdValue(value: unknown): string | null {
  return sanitizeString(value, 240);
}

function sanitizeMetaClickIdValue(value: unknown): string | null {
  return sanitizeString(value, 320);
}

function getPgErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || "");
}

function getSearchParamsFromUrl(url: string | null): URLSearchParams | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

function readAttributionValue(
  body: any,
  utmBody: Record<string, unknown> | null,
  searchParams: URLSearchParams | null,
  snakeCaseKey: string,
  camelCaseKey: string
): string | null {
  const urlValue = searchParams?.get(snakeCaseKey) ?? searchParams?.get(camelCaseKey) ?? null;
  return sanitizeUtmValue(
    body?.[snakeCaseKey] ?? body?.[camelCaseKey] ?? utmBody?.[snakeCaseKey] ?? utmBody?.[camelCaseKey] ?? urlValue
  );
}

function getLeadAttribution(body: any, sourceUrl: string | null): LeadAttribution {
  const utmBody = body?.utm && typeof body.utm === "object" ? (body.utm as Record<string, unknown>) : null;
  const searchParams = getSearchParamsFromUrl(sourceUrl);

  return {
    utm_source: readAttributionValue(body, utmBody, searchParams, "utm_source", "utmSource"),
    utm_medium: readAttributionValue(body, utmBody, searchParams, "utm_medium", "utmMedium"),
    utm_campaign: readAttributionValue(body, utmBody, searchParams, "utm_campaign", "utmCampaign"),
    utm_content: readAttributionValue(body, utmBody, searchParams, "utm_content", "utmContent"),
    utm_term: readAttributionValue(body, utmBody, searchParams, "utm_term", "utmTerm")
  };
}

function readClickIdValue(
  body: any,
  clickBody: Record<string, unknown> | null,
  searchParams: URLSearchParams | null,
  snakeCaseKey: "fbclid" | "gclid" | "wbraid" | "gbraid",
  camelCaseKey: "fbclid" | "gclid" | "wbraid" | "gbraid"
): string | null {
  const urlValue = searchParams?.get(snakeCaseKey) ?? searchParams?.get(camelCaseKey) ?? null;
  return sanitizeClickIdValue(body?.[snakeCaseKey] ?? body?.[camelCaseKey] ?? clickBody?.[snakeCaseKey] ?? urlValue);
}

function getLeadClickIds(body: any, sourceUrl: string | null): LeadClickIds {
  const clickBodyRaw =
    body?.click_ids && typeof body.click_ids === "object"
      ? body.click_ids
      : body?.clickIds && typeof body.clickIds === "object"
      ? body.clickIds
      : null;
  const clickBody = clickBodyRaw as Record<string, unknown> | null;
  const searchParams = getSearchParamsFromUrl(sourceUrl);

  return {
    fbclid: readClickIdValue(body, clickBody, searchParams, "fbclid", "fbclid"),
    gclid: readClickIdValue(body, clickBody, searchParams, "gclid", "gclid"),
    wbraid: readClickIdValue(body, clickBody, searchParams, "wbraid", "wbraid"),
    gbraid: readClickIdValue(body, clickBody, searchParams, "gbraid", "gbraid")
  };
}

function readMetaClickIdValue(
  body: any,
  clickBody: Record<string, unknown> | null,
  searchParams: URLSearchParams | null,
  key: "fbc" | "fbp"
): string | null {
  const urlValue = searchParams?.get(key) ?? null;
  return sanitizeMetaClickIdValue(body?.[key] ?? body?.[`_${key}`] ?? clickBody?.[key] ?? clickBody?.[`_${key}`] ?? urlValue);
}

function buildFbcFromFbclid(fbclid: string | null): string | null {
  const normalizedFbclid = sanitizeClickIdValue(fbclid);
  if (!normalizedFbclid) return null;
  return `fb.1.${Date.now()}.${normalizedFbclid}`;
}

function getLeadMetaClickIds(body: any, sourceUrl: string | null, clickIds: LeadClickIds): LeadMetaClickIds {
  const clickBodyRaw =
    body?.click_ids && typeof body.click_ids === "object"
      ? body.click_ids
      : body?.clickIds && typeof body.clickIds === "object"
      ? body.clickIds
      : null;
  const clickBody = clickBodyRaw as Record<string, unknown> | null;
  const searchParams = getSearchParamsFromUrl(sourceUrl);

  let fbc = readMetaClickIdValue(body, clickBody, searchParams, "fbc");
  const fbp = readMetaClickIdValue(body, clickBody, searchParams, "fbp");

  if (!fbc) {
    fbc = buildFbcFromFbclid(clickIds.fbclid);
  }

  return { fbc, fbp };
}

function compactAttribution(attribution: LeadAttribution): Record<string, string> | undefined {
  const entries = Object.entries(attribution).filter(([, value]) => Boolean(value));
  if (!entries.length) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function compactClickIds(clickIds: LeadClickIds): Record<string, string> | undefined {
  const entries = Object.entries(clickIds).filter(([, value]) => Boolean(value));
  if (!entries.length) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function compactMetaClickIds(metaClickIds: LeadMetaClickIds): Record<string, string> | undefined {
  const entries = Object.entries(metaClickIds).filter(([, value]) => Boolean(value));
  if (!entries.length) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function getClientIpAddress(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const forwardedIp = sanitizeString(String(firstForwarded || "").split(",")[0] || "", 120);
  if (forwardedIp) return forwardedIp;
  return sanitizeString(req.ip, 120);
}

function getClientUserAgent(req: Request): string | null {
  const userAgentHeader = req.headers["user-agent"];
  if (Array.isArray(userAgentHeader)) return sanitizeString(userAgentHeader[0], 600);
  return sanitizeString(userAgentHeader, 600);
}

function isValidPhone(value: unknown): boolean {
  const digits = onlyDigits(value);
  return digits.length >= 10 && digits.length <= 13;
}

function isValidCpf(value: unknown): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;

  const calc = (base: string, factor: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (factor - i);
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return cpf.endsWith(String(d1) + String(d2));
}

function isValidBirthDate(value: unknown): boolean {
  const str = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (date > now) return false;
  return true;
}

function normalizeAddress(address: any): Address | null {
  if (!address || typeof address !== "object") return null;

  const cepDigits = onlyDigits(address.cep);
  const cep = cepDigits ? (cepDigits.length === 8 ? cepDigits : null) : null;

  const state = sanitizeString(address.state, 2);
  const normalizedState = state ? state.toUpperCase() : null;
  if (normalizedState && !/^[A-Z]{2}$/.test(normalizedState)) {
    return null;
  }

  const out: Address = {
    cep: cep || undefined,
    street: sanitizeString(address.street, 160) || undefined,
    number: sanitizeString(address.number, 40) || undefined,
    complement: sanitizeString(address.complement, 120) || undefined,
    neighborhood: sanitizeString(address.neighborhood, 120) || undefined,
    city: sanitizeString(address.city, 120) || undefined,
    state: normalizedState || undefined
  };

  const hasAny = Object.values(out).some((v) => Boolean(v));
  return hasAny ? out : null;
}

function hasRequiredAddressFields(address: Address | null): boolean {
  if (!address) return false;
  return Boolean(
    address.cep &&
      address.street &&
      address.number &&
      address.neighborhood &&
      address.city &&
      address.state
  );
}

function sanitizeMessageField(value: unknown, fallback = "-"): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function normalizePhoneForMessage(phone: string | null): string {
  const digits = onlyDigits(phone);
  if (!digits) return "-";
  const normalized =
    digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits
      : digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits;

  if (normalized.length < 12) return normalized;
  const ddd = normalized.slice(2, 4);
  const number = normalized.slice(4);
  if (number.length <= 8) return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5, 9)}`;
}

async function sendNewLeadAlert(input: {
  leadCode: string;
  courseName: string;
  customerName: string;
  customerPhone: string;
  city: string | null;
  state: string | null;
  attribution: LeadAttribution;
}): Promise<void> {
  if (!isTelegramEnabled("TELEGRAM_LEAD_ALERTS_ENABLED")) return;

  const location = [sanitizeString(input.city, 80), sanitizeString(input.state, 8)].filter(Boolean).join("/");
  const attributionParts = [
    input.attribution.utm_source ? `source=${input.attribution.utm_source}` : "",
    input.attribution.utm_medium ? `medium=${input.attribution.utm_medium}` : "",
    input.attribution.utm_campaign ? `campaign=${input.attribution.utm_campaign}` : ""
  ].filter(Boolean);
  const attributionLine = attributionParts.length ? attributionParts.join(" | ") : "-";
  const occurredAtUtc = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const frontendBaseUrl =
    (sanitizeString(process.env.FRONTEND_BASE_URL, 200) || "").replace(/\/+$/, "") ||
    "https://demo.escola-tecnica.example";
  const leadPanelUrl = `${frontendBaseUrl}/matriculador.html?lead_code=${encodeURIComponent(
    input.leadCode
  )}`;

  const lines = [
    "🚀 Novo lead de pré-matrícula",
    "",
    `👤 Aluno: ${sanitizeMessageField(input.customerName)}`,
    `📚 Curso: ${sanitizeMessageField(input.courseName)}`,
    `📱 WhatsApp: ${normalizePhoneForMessage(input.customerPhone)}`,
    `🧾 Protocolo: ${sanitizeMessageField(input.leadCode)}`,
    `📍 Cidade/UF: ${sanitizeMessageField(location)}`,
    `🎯 Origem: ${sanitizeMessageField(attributionLine)}`,
    `🔗 Painel: ${leadPanelUrl}`,
    `🕒 Horario (UTC): ${occurredAtUtc}`,
    "Ação sugerida: abordar em até 5 minutos.",
    "#escolatecnica #leads #comercial"
  ];

  const sent = await sendTelegramMessage(lines.join("\n"), {
    botTokenEnv: "TELEGRAM_LEADS_BOT_TOKEN",
    chatIdEnv: "TELEGRAM_LEADS_CHAT_ID",
    timeoutMs: 6_000
  });

  if (!sent) {
    console.error("Failed to send Telegram new lead alert");
  }
}

function normalizeExperienceCredit(value: any): { requested: boolean; note: string | null } {
  if (!value || typeof value !== "object") return { requested: false, note: null };
  const requested = Boolean(value.requested);
  const note = sanitizeString(value.note, 1200);
  return { requested, note: requested ? note : null };
}

function normalizeCourseRequirementsAck(value: any): CourseRequirementsAck {
  if (!value || typeof value !== "object") {
    return {
      minimum_experience_two_years: false,
      coren_active_two_years_auxiliar: false,
      professional_link_proof: false,
      professional_link_proof_type: null
    };
  }

  const proofTypeRaw = sanitizeString(
    value.professional_link_proof_type ?? value.professionalLinkProofType ?? value.proof_type,
    40
  );
  const proofTypeNormalized = proofTypeRaw ? proofTypeRaw.toLowerCase() : null;
  const proofType =
    proofTypeNormalized && PROFESSIONAL_LINK_PROOF_TYPES.has(proofTypeNormalized)
      ? (proofTypeNormalized as "ctps" | "contrato_publico")
      : null;

  return {
    minimum_experience_two_years: Boolean(
      value.minimum_experience_two_years ?? value.minimumExperienceTwoYears ?? value.minimum_years_ack
    ),
    coren_active_two_years_auxiliar: Boolean(
      value.coren_active_two_years_auxiliar ?? value.corenActiveTwoYearsAuxiliar ?? value.coren_ack
    ),
    professional_link_proof: Boolean(
      value.professional_link_proof ?? value.professionalLinkProof ?? value.formal_proof_ack
    ),
    professional_link_proof_type: proofType
  };
}

function getLegacyCourseRequirementRule(courseSlug: string): CourseRequirementRule | null {
  const slug = String(courseSlug || "")
    .trim()
    .toLowerCase();

  if (slug === "enfermagem") {
    return {
      minimum_experience_two_years: true,
      coren_active_two_years_auxiliar: true,
      professional_link_proof: true,
      professional_link_proof_types: ["ctps", "contrato_publico"]
    };
  }

  if (slug === "saude-bucal") {
    return {
      minimum_experience_two_years: true,
      coren_active_two_years_auxiliar: false,
      professional_link_proof: false,
      professional_link_proof_types: []
    };
  }

  return null;
}

function normalizeCourseRequirementRule(value: unknown): CourseRequirementRule | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;

  const proofTypesRaw = Array.isArray(source.professional_link_proof_types)
    ? source.professional_link_proof_types
    : [];
  const proofTypes = proofTypesRaw
    .map((item) => sanitizeString(item, 40))
    .map((item) => (item ? item.toLowerCase() : null))
    .filter((item): item is "ctps" | "contrato_publico" =>
      Boolean(item && PROFESSIONAL_LINK_PROOF_TYPES.has(item))
    );

  const normalizedProofTypes =
    proofTypes.length > 0 ? proofTypes : (["ctps", "contrato_publico"] as Array<"ctps" | "contrato_publico">);

  const rule: CourseRequirementRule = {
    minimum_experience_two_years: Boolean(source.minimum_experience_two_years),
    coren_active_two_years_auxiliar: Boolean(source.coren_active_two_years_auxiliar),
    professional_link_proof: Boolean(source.professional_link_proof),
    professional_link_proof_types: normalizedProofTypes
  };

  if (
    !rule.minimum_experience_two_years &&
    !rule.coren_active_two_years_auxiliar &&
    !rule.professional_link_proof
  ) {
    return null;
  }

  return rule;
}

function validateCourseRequirements(
  courseSlug: string,
  ack: CourseRequirementsAck,
  dbRule: CourseRequirementRule | null
): string | null {
  const rule = dbRule || getLegacyCourseRequirementRule(courseSlug);
  if (!rule) return null;

  if (rule.minimum_experience_two_years && !ack.minimum_experience_two_years) {
    return "missing_minimum_experience_ack";
  }

  if (rule.coren_active_two_years_auxiliar && !ack.coren_active_two_years_auxiliar) {
    return "missing_coren_ack";
  }

  if (rule.professional_link_proof && !ack.professional_link_proof) {
    return "missing_professional_link_proof_ack";
  }

  if (rule.professional_link_proof && !ack.professional_link_proof_type) {
    return "invalid_professional_link_proof_type";
  }

  if (
    rule.professional_link_proof &&
    ack.professional_link_proof_type &&
    !rule.professional_link_proof_types.includes(ack.professional_link_proof_type)
  ) {
    return "invalid_professional_link_proof_type";
  }

  return null;
}

function buildLeadCode(leadId: string | null | undefined): string {
  if (!leadId) return "";
  const normalized = String(leadId).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) return "";
  return `ET-${normalized.slice(0, 8)}`;
}

function getTokenFromRequest(req: Request): string | null {
  const explicit = sanitizeString(req.headers["x-matriculator-token"], 240);
  if (explicit) return explicit;

  const authorization = sanitizeString(req.headers.authorization, 260);
  if (!authorization) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return null;
  return sanitizeString(match[1], 240);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX_REGEX.test(value);
}

function getConfiguredTokenHashes(): { hashes: string[]; hasInvalid: boolean } {
  const singleHash = String(process.env.MATRICULADOR_TOKEN_SHA256 || "")
    .trim()
    .toLowerCase();
  const listRaw = String(process.env.MATRICULADOR_TOKEN_SHA256_LIST || "");
  const listHashes = listRaw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const hashes = Array.from(new Set([singleHash, ...listHashes].filter(Boolean)));
  const hasInvalid = hashes.some((hash) => !isValidSha256Hex(hash));
  return { hashes, hasInvalid };
}

function isAuthorizedMatriculatorToken(providedToken: string | null): boolean {
  if (!providedToken) return false;

  const configuredToken = String(process.env.MATRICULADOR_TOKEN || "").trim();
  const configuredTokenHashes = getConfiguredTokenHashes();

  if (configuredTokenHashes.hashes.length) {
    if (configuredTokenHashes.hasInvalid) return false;
    const providedHash = sha256Hex(providedToken);
    return configuredTokenHashes.hashes.some((hash) => secureCompare(providedHash, hash));
  }

  if (!configuredToken) return false;
  return secureCompare(providedToken, configuredToken);
}

function normalizeLeadCodePrefix(value: unknown): string | null {
  const raw = String(value ?? "").toUpperCase().trim();
  if (!raw) return null;
  const withoutPrefix = raw.startsWith("ET-") ? raw.slice(3) : raw;
  const normalized = withoutPrefix.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (normalized.length < 6) return null;
  return normalized;
}

function mapStatusToCrm(value: unknown): string | null {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!status) return null;
  if (CRM_LEAD_STATUS_VALUES.has(status)) return status;
  if (ALLOWED_PAYMENT_STATUS.has(status)) return LEGACY_STATUS_TO_CRM[status] || null;
  return null;
}

function getCrmStatusQueryVariants(status: string): string[] {
  return CRM_STATUS_QUERY_VARIANTS[status] || [status];
}

function parseLimit(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  const parsed = Math.trunc(num);
  if (parsed < 1) return 1;
  if (parsed > 200) return 200;
  return parsed;
}

function isUuid(value: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeContactChannel(value: unknown): string | null {
  const normalized = sanitizeString(value, 30);
  if (!normalized) return null;
  const key = normalized.toLowerCase();
  if (!ALLOWED_CONTACT_CHANNEL.has(key)) return null;
  return key;
}

function ensureMatriculatorAuthorization(req: Request, res: Response): boolean {
  const hasPlainToken = Boolean(String(process.env.MATRICULADOR_TOKEN || "").trim());
  const configuredTokenHashes = getConfiguredTokenHashes();
  const hasHashedToken = configuredTokenHashes.hashes.length > 0;

  if (!hasPlainToken && !hasHashedToken) {
    res.status(500).json({ error: "matriculator_token_not_configured" });
    return false;
  }

  if (configuredTokenHashes.hasInvalid) {
    res.status(500).json({ error: "matriculator_token_hash_invalid" });
    return false;
  }

  const providedToken = getTokenFromRequest(req);
  if (!isAuthorizedMatriculatorToken(providedToken)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }

  return true;
}

async function handleLeadLookup(req: Request, res: Response): Promise<void> {
  if (rateLimit(req, res, { keyPrefix: "matriculator-leads", windowMs: 60_000, max: 120 })) return;

  if (!ensureMatriculatorAuthorization(req, res)) return;

  const hasLeadStatusInput =
    Object.prototype.hasOwnProperty.call(req.query ?? {}, "lead_status") ||
    Object.prototype.hasOwnProperty.call(req.query ?? {}, "payment_status");
  const leadCodePrefix = normalizeLeadCodePrefix(req.query?.lead_code);
  const leadStatus = mapStatusToCrm(req.query?.lead_status ?? req.query?.payment_status);
  const limit = parseLimit(req.query?.limit);

  if (hasLeadStatusInput && !leadStatus) {
    res.status(400).json({ error: "invalid_lead_status" });
    return;
  }

  if (!leadCodePrefix && !leadStatus) {
    res.status(400).json({ error: "missing_filter", detail: "Use lead_code or lead_status." });
    return;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (leadCodePrefix) {
    params.push(leadCodePrefix);
    conditions.push(`upper(replace(id::text, '-', '')) like $${params.length} || '%'`);
  }

  if (leadStatus) {
    const variants = getCrmStatusQueryVariants(leadStatus);
    if (variants.length === 1) {
      params.push(variants[0]);
      conditions.push(`payment_status = $${params.length}`);
    } else {
      params.push(variants);
      conditions.push(`payment_status = any($${params.length})`);
    }
  }

  params.push(limit);
  const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";

  try {
    if (isDemoMode()) {
      res.status(200).json(
        getDemoLeadLookupResponse({
          leadCodePrefix,
          leadStatus,
          limit
        })
      );
      return;
    }

    let rows: LeadLookupRow[] = [];

    try {
      const fullResult = await query<LeadLookupRow>(
        `select
            id,
            course_slug,
            course_name,
            customer_name,
            customer_email,
            customer_phone,
            cpf,
            birth_date::text as birth_date,
            father_name,
            mother_name,
            address,
            payment_status,
            payment_reference,
            payment_tid,
            payment_return_code,
            payment_return_message,
            created_at::text as created_at,
            payment_updated_at::text as payment_updated_at,
            paid_at::text as paid_at,
            first_contact_at::text as first_contact_at,
            contact_channel,
            contact_owner
          from lead_enrollments
          ${whereSql}
          order by created_at desc
          limit $${params.length}`,
        params
      );
      rows = fullResult.rows;
    } catch (queryError) {
      const errorCode = getPgErrorCode(queryError);
      const undefinedPaymentColumns = errorCode === "42703";
      if (!undefinedPaymentColumns) throw queryError;

      try {
        // Backward-compatible path while migration 090 is not applied yet.
        const legacyResult = await query<LeadLookupRow>(
          `select
              id,
              course_slug,
              course_name,
              customer_name,
              customer_email,
              customer_phone,
              cpf,
              birth_date::text as birth_date,
              father_name,
              mother_name,
              address,
              payment_status,
              payment_reference,
              payment_tid,
              payment_return_code,
              payment_return_message,
              created_at::text as created_at,
              payment_updated_at::text as payment_updated_at,
              paid_at::text as paid_at,
              null::text as first_contact_at,
              null::text as contact_channel,
              null::text as contact_owner
            from lead_enrollments
            ${whereSql}
            order by created_at desc
            limit $${params.length}`,
          params
        );
        rows = legacyResult.rows;
      } catch (legacyError) {
        if (getPgErrorCode(legacyError) !== "42703") throw legacyError;

        if (leadStatus) {
          res.status(500).json({
            error: "payment_status_filter_unavailable",
            detail: "Apply migration db/init/050_lead_payment_link.sql to enable this filter."
          });
          return;
        }

        // Backward-compatible path while migration 050 is not applied yet.
        const veryLegacyResult = await query<LeadLookupRow>(
          `select
              id,
              course_slug,
              course_name,
              customer_name,
              customer_email,
              customer_phone,
              cpf,
              birth_date::text as birth_date,
              father_name,
              mother_name,
              address,
              null::text as payment_status,
              null::text as payment_reference,
              null::text as payment_tid,
              null::text as payment_return_code,
              null::text as payment_return_message,
              created_at::text as created_at,
              null::text as payment_updated_at,
              null::text as paid_at,
              null::text as first_contact_at,
              null::text as contact_channel,
              null::text as contact_owner
            from lead_enrollments
            ${whereSql}
            order by created_at desc
            limit $${params.length}`,
          params
        );
        rows = veryLegacyResult.rows;
      }
    }

    res.status(200).json({
      ok: true,
      count: rows.length,
      leads: rows.map((lead) => ({
        lead_status: mapStatusToCrm(lead.payment_status) || CRM_LEAD_STATUS.novo_lead,
        lead_id: lead.id,
        lead_code: buildLeadCode(lead.id),
        course_slug: lead.course_slug,
        course_name: lead.course_name,
        customer_name: lead.customer_name,
        customer_email: lead.customer_email,
        customer_phone: lead.customer_phone,
        cpf: lead.cpf,
        birth_date: lead.birth_date,
        father_name: lead.father_name,
        mother_name: lead.mother_name,
        address: lead.address || {},
        payment_status: mapStatusToCrm(lead.payment_status) || CRM_LEAD_STATUS.novo_lead,
        payment_reference: lead.payment_reference,
        payment_tid: lead.payment_tid,
        payment_return_code: lead.payment_return_code,
        payment_return_message: lead.payment_return_message,
        created_at: lead.created_at,
        payment_updated_at: lead.payment_updated_at,
        paid_at: lead.paid_at,
        first_contact_at: lead.first_contact_at,
        contact_channel: lead.contact_channel,
        contact_owner: lead.contact_owner
      }))
    });
  } catch (error) {
    console.error("Failed to load leads for matriculator", error);
    res.status(500).json({ error: "lead_lookup_failed" });
  }
}

async function handleLeadUpdate(req: Request, res: Response): Promise<void> {
  if (rateLimit(req, res, { keyPrefix: "matriculator-contact", windowMs: 60_000, max: 120 })) return;
  if (!ensureMatriculatorAuthorization(req, res)) return;

  const body = req.body ?? {};
  const leadId = sanitizeString(body?.lead_id ?? body?.leadId, 80);
  const hasLeadStatusInput =
    Object.prototype.hasOwnProperty.call(body, "lead_status") ||
    Object.prototype.hasOwnProperty.call(body, "leadStatus") ||
    Object.prototype.hasOwnProperty.call(body, "payment_status") ||
    Object.prototype.hasOwnProperty.call(body, "paymentStatus");
  const leadStatus = mapStatusToCrm(
    body?.lead_status ?? body?.leadStatus ?? body?.payment_status ?? body?.paymentStatus
  );
  const hasContactChannelInput =
    Object.prototype.hasOwnProperty.call(body, "contact_channel") ||
    Object.prototype.hasOwnProperty.call(body, "contactChannel");
  const contactChannel = normalizeContactChannel(body?.contact_channel ?? body?.contactChannel);
  const contactOwner = sanitizeString(body?.contact_owner ?? body?.contactOwner ?? body?.owner, 120);
  const markFirstContactRaw = body?.mark_first_contact ?? body?.markFirstContact;
  const explicitMarkFirstContact = markFirstContactRaw === true || markFirstContactRaw === "true";
  const shouldMarkFirstContact = explicitMarkFirstContact || hasContactChannelInput || Boolean(contactOwner);

  if (!leadId) {
    res.status(400).json({ error: "missing_lead_id" });
    return;
  }

  if (!isUuid(leadId)) {
    res.status(400).json({ error: "invalid_lead_id" });
    return;
  }

  if ((body?.contact_channel || body?.contactChannel) && !contactChannel) {
    res.status(400).json({ error: "invalid_contact_channel" });
    return;
  }

  if (hasLeadStatusInput && !leadStatus) {
    res.status(400).json({ error: "invalid_lead_status" });
    return;
  }

  if (!leadStatus && !shouldMarkFirstContact) {
    res.status(400).json({ error: "missing_update_fields" });
    return;
  }

  try {
    if (isDemoMode()) {
      const demoResponse = getDemoLeadUpdateResponse({
        leadId,
        leadStatus,
        contactChannel,
        contactOwner,
        shouldMarkFirstContact
      });

      if (!demoResponse) {
        res.status(404).json({ error: "invalid_lead" });
        return;
      }

      res.status(200).json(demoResponse);
      return;
    }

    const setClauses: string[] = [];
    const params: unknown[] = [leadId];

    if (leadStatus) {
      params.push(leadStatus);
      setClauses.push(`payment_status = $${params.length}`);
      setClauses.push(`payment_updated_at = now()`);
    }

    if (shouldMarkFirstContact) {
      setClauses.push(`first_contact_at = coalesce(first_contact_at, now())`);
    }

    if (contactChannel) {
      params.push(contactChannel);
      setClauses.push(`contact_channel = coalesce(contact_channel, $${params.length})`);
    }

    if (contactOwner) {
      params.push(contactOwner);
      setClauses.push(`contact_owner = coalesce(contact_owner, $${params.length})`);
    }

    const { rows } = await query<LeadUpdateRow>(
      `update lead_enrollments
          set ${setClauses.join(", ")}
        where id = $1
        returning
          id,
          payment_status,
          payment_updated_at::text as payment_updated_at,
          first_contact_at::text as first_contact_at,
          contact_channel,
          contact_owner`,
      params
    );

    const updated = rows?.[0] || null;
    if (!updated) {
      res.status(404).json({ error: "invalid_lead" });
      return;
    }

    res.status(200).json({
      ok: true,
      lead_id: updated.id,
      lead_status: mapStatusToCrm(updated.payment_status) || CRM_LEAD_STATUS.novo_lead,
      payment_status: mapStatusToCrm(updated.payment_status) || CRM_LEAD_STATUS.novo_lead,
      payment_updated_at: updated.payment_updated_at,
      first_contact_at: updated.first_contact_at,
      contact_channel: updated.contact_channel,
      contact_owner: updated.contact_owner
    });
  } catch (error) {
    if (getPgErrorCode(error) === "42703") {
      if (leadStatus) {
        res.status(500).json({
          error: "lead_status_tracking_unavailable",
          detail: "Apply migration db/init/050_lead_payment_link.sql to enable lead status tracking."
        });
        return;
      }

      res.status(500).json({
        error: "contact_tracking_unavailable",
        detail: "Apply migration db/init/090_lead_funnel_tracking.sql to enable first contact tracking."
      });
      return;
    }

    console.error("Failed to update lead", error);
    res.status(500).json({ error: "lead_update_failed" });
  }
}

function getCourseSlug(body: any): string | null {
  return (
    sanitizeString(body?.course_slug, 120) ||
    sanitizeString(body?.curso_slug, 120) ||
    sanitizeString(body?.courseSlug, 120)
  );
}

function getAddress(body: any): Address | null {
  if (body?.address && typeof body.address === "object") {
    return normalizeAddress(body.address);
  }

  const fallback = {
    cep: body?.cep,
    street: body?.endereco,
    number: body?.numero,
    complement: body?.complemento,
    neighborhood: body?.bairro,
    city: body?.cidade,
    state: body?.estado
  };
  return normalizeAddress(fallback);
}

export default async function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    await handleLeadLookup(req, res);
    return;
  }

  if (req.method === "PATCH") {
    await handleLeadUpdate(req, res);
    return;
  }

  if (req.method !== "POST") return res.status(405).end();

  if (rateLimit(req, res, { keyPrefix: "leads", windowMs: 60_000, max: 60 })) return;

  const body = req.body ?? {};

  const courseSlug = getCourseSlug(body);
  if (!courseSlug) return res.status(400).json({ error: "invalid_course" });

  const name = sanitizeString(body?.name ?? body?.nome, 160);
  const email = sanitizeString(body?.email, 180);
  const phone = sanitizeString(body?.phone ?? body?.telefone, 40);
  const fatherName = sanitizeString(body?.father_name ?? body?.nome_pai ?? body?.nomePai, 160);
  const motherName = sanitizeString(body?.mother_name ?? body?.nome_mae ?? body?.nomeMae, 160);
  const cpf = body?.cpf ? onlyDigits(body.cpf) : null;
  const birthDate = sanitizeString(body?.birth_date ?? body?.nascimento, 10);

  if (!name) return res.status(400).json({ error: "invalid_name" });
  if (!email || !email.includes("@")) return res.status(400).json({ error: "invalid_email" });
  if (!phone || !isValidPhone(phone)) return res.status(400).json({ error: "invalid_phone" });
  if (!fatherName) return res.status(400).json({ error: "missing_father_name" });
  if (!motherName) return res.status(400).json({ error: "missing_mother_name" });
  if (!cpf || !isValidCpf(cpf)) return res.status(400).json({ error: "invalid_cpf" });
  if (!birthDate || !isValidBirthDate(birthDate)) return res.status(400).json({ error: "invalid_birth_date" });

  const address = getAddress(body);
  if (!address || !hasRequiredAddressFields(address)) {
    return res.status(400).json({ error: "invalid_address" });
  }

  const experience = normalizeExperienceCredit(body?.experience_credit);
  if (experience.requested && !experience.note) {
    return res.status(400).json({ error: "invalid_experience_note" });
  }

  const courseRequirementsAck = normalizeCourseRequirementsAck(
    body?.course_requirements_ack ?? body?.courseRequirementsAck ?? body?.experience_credit?.requirements_ack
  );
  let course: CourseLookupRow | null = null;
  if (isDemoMode()) {
    const demoCourse = listDemoCourses().find((item) => item.slug === courseSlug) || null;
    course = demoCourse
      ? {
          id: demoCourse.id,
          slug: demoCourse.slug,
          name: demoCourse.name,
          price_cents: demoCourse.price_cents,
          course_requirements: demoCourse.track_requirements
        }
      : null;
  } else {
    try {
      if (hasCourseOffersRequirementsSchema !== false) {
        try {
          const { rows } = await query<CourseLookupRow>(
            `select
                c.id,
                c.slug,
                c.name,
                c.price_cents,
                o.requirements as course_requirements
              from courses c
              left join course_offers o on o.course_id = c.id
              where c.slug = $1
                and c.active = true
                and (o.id is null or o.active = true)
              order by case when o.id is null then 0 else 1 end desc
              limit 1`,
            [courseSlug]
          );
          course = rows?.[0] || null;
          hasCourseOffersRequirementsSchema = true;
        } catch (queryError) {
          const errorCode = getPgErrorCode(queryError);
          const offersTableUnavailable = errorCode === "42P01" || errorCode === "42703";
          if (!offersTableUnavailable) throw queryError;
          hasCourseOffersRequirementsSchema = false;
        }
      }

      if (hasCourseOffersRequirementsSchema === false) {
        // Backward-compatible path while course_offers migration is not applied yet.
        const { rows } = await query<{ id: string; slug: string; name: string; price_cents: number }>(
          "select id, slug, name, price_cents from courses where slug = $1 and active = true",
          [courseSlug]
        );
        const legacy = rows?.[0] || null;
        course = legacy ? { ...legacy, course_requirements: null } : null;
      }
    } catch (error) {
      console.error("Failed to fetch course", error);
      return res.status(500).json({ error: "courses_fetch_failed" });
    }
  }

  if (!course) return res.status(400).json({ error: "unknown_course" });

  const requirementRule = normalizeCourseRequirementRule(course.course_requirements);
  const requirementsError = validateCourseRequirements(course.slug, courseRequirementsAck, requirementRule);
  if (requirementsError) {
    return res.status(400).json({ error: requirementsError });
  }

  const sourceUrl = sanitizeString(body?.source_url ?? body?.origem, 500);
  const attribution = getLeadAttribution(body, sourceUrl);
  const compactLeadAttribution = compactAttribution(attribution);
  const clickIds = getLeadClickIds(body, sourceUrl);
  const compactLeadClickIds = compactClickIds(clickIds);
  const metaClickIds = getLeadMetaClickIds(body, sourceUrl, clickIds);
  const compactLeadMetaClickIds = compactMetaClickIds(metaClickIds);
  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = getClientUserAgent(req);

  const payload = {
    course: {
      id: course.id,
      slug: course.slug,
      name: course.name,
      price_cents: course.price_cents
    },
    customer: {
      name,
      email,
      phone,
      father_name: fatherName,
      mother_name: motherName,
      cpf,
      birth_date: birthDate,
      address,
      experience_credit: experience.requested ? { requested: true, note: experience.note } : { requested: false }
    },
    course_requirements_ack: courseRequirementsAck,
    source_url: sourceUrl || undefined,
    attribution: compactLeadAttribution,
    click_ids: compactLeadClickIds,
    meta_click_ids: compactLeadMetaClickIds,
    created_via: "lead_form"
  };

  if (isDemoMode()) {
    return res.status(200).json(
      getDemoLeadCreateResponse({
        courseSlug: course.slug,
        courseName: course.name
      })
    );
  }

  try {
    let rows: Array<{ id: string }> = [];

    try {
      const insertWithAttributionAndClickIds = await query<{ id: string }>(
        `insert into lead_enrollments (
            course_id,
            course_slug,
            course_name,
            course_price_cents,
            customer_name,
            customer_email,
            customer_phone,
            father_name,
            mother_name,
            cpf,
            birth_date,
            address,
            experience_credit_requested,
            experience_note,
            source_url,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_content,
            utm_term,
            click_id_fbclid,
            click_id_gclid,
            click_id_wbraid,
            click_id_gbraid,
            payment_status,
            payload
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
          returning id`,
        [
          course.id,
          course.slug,
          course.name,
          Number(course.price_cents || 0),
          name,
          email,
          phone,
          fatherName,
          motherName,
          cpf,
          birthDate,
          address,
          Boolean(experience.requested),
          experience.note,
          sourceUrl,
          attribution.utm_source,
          attribution.utm_medium,
          attribution.utm_campaign,
          attribution.utm_content,
          attribution.utm_term,
          clickIds.fbclid,
          clickIds.gclid,
          clickIds.wbraid,
          clickIds.gbraid,
          CRM_LEAD_STATUS.novo_lead,
          payload
        ]
      );
      rows = insertWithAttributionAndClickIds.rows;
    } catch (insertError) {
      if (getPgErrorCode(insertError) !== "42703") throw insertError;

      try {
        // Backward-compatible path while migration 130 is not applied yet.
        const insertWithAttribution = await query<{ id: string }>(
          `insert into lead_enrollments (
              course_id,
              course_slug,
              course_name,
              course_price_cents,
              customer_name,
              customer_email,
              customer_phone,
              father_name,
              mother_name,
              cpf,
              birth_date,
              address,
              experience_credit_requested,
              experience_note,
              source_url,
              utm_source,
              utm_medium,
              utm_campaign,
              utm_content,
              utm_term,
              payment_status,
              payload
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            returning id`,
          [
            course.id,
            course.slug,
            course.name,
            Number(course.price_cents || 0),
            name,
            email,
            phone,
            fatherName,
            motherName,
            cpf,
            birthDate,
            address,
            Boolean(experience.requested),
            experience.note,
            sourceUrl,
            attribution.utm_source,
            attribution.utm_medium,
            attribution.utm_campaign,
            attribution.utm_content,
            attribution.utm_term,
            CRM_LEAD_STATUS.novo_lead,
            payload
          ]
        );
        rows = insertWithAttribution.rows;
      } catch (legacyAttributionError) {
        if (getPgErrorCode(legacyAttributionError) !== "42703") throw legacyAttributionError;

        // Backward-compatible path while migration 090 is not applied yet.
        const legacyInsert = await query<{ id: string }>(
          `insert into lead_enrollments (
              course_id,
              course_slug,
              course_name,
              course_price_cents,
              customer_name,
              customer_email,
              customer_phone,
              father_name,
              mother_name,
              cpf,
              birth_date,
              address,
              experience_credit_requested,
              experience_note,
              source_url,
              payload
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            returning id`,
          [
            course.id,
            course.slug,
            course.name,
            Number(course.price_cents || 0),
            name,
            email,
            phone,
            fatherName,
            motherName,
            cpf,
            birthDate,
            address,
            Boolean(experience.requested),
            experience.note,
            sourceUrl,
            payload
          ]
        );
        rows = legacyInsert.rows;
      }
    }

    const leadId = rows?.[0]?.id || "";
    const leadCode = buildLeadCode(leadId);
    const metaEventReference = sanitizeString(leadId || leadCode, 120);

    await Promise.allSettled([
      sendNewLeadAlert({
        leadCode,
        courseName: course.name,
        customerName: name,
        customerPhone: phone,
        city: address?.city || null,
        state: address?.state || null,
        attribution
      }),
      sendMetaLeadConversion({
        leadId,
        leadCode,
        sourceUrl,
        eventId: metaEventReference ? `lead-${metaEventReference}` : undefined,
        courseSlug: course.slug,
        courseName: course.name,
        amountCents: Number(course.price_cents || 0),
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        customerCity: address?.city || null,
        customerState: address?.state || null,
        customerZip: address?.cep || null,
        customerCountry: "br",
        attribution,
        clickIds,
        fbc: metaClickIds.fbc,
        fbp: metaClickIds.fbp,
        clientIpAddress,
        clientUserAgent
      })
    ]);

    return res.status(200).json({ ok: true, lead_id: leadId, lead_code: leadCode });
  } catch (error) {
    console.error("Failed to create lead enrollment", error);
    return res.status(500).json({ error: "lead_create_failed" });
  }
}
