import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { query } from "../lib/db.js";
import {
  getDemoLeadIntentCreateResponse,
  getDemoLeadIntentLookupResponse,
  isDemoMode
} from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { isTelegramEnabled, sendTelegramMessage } from "../lib/telegram.js";

type LeadIntentInsertRow = {
  id: string;
};

type LeadIntentLookupRow = {
  id: string;
  client_event_id: string;
  intent_type: string;
  course_slug: string | null;
  course_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  city: string | null;
  state: string | null;
  last_step: string;
  source_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const ABANDONED_INTENT_TYPE = "pre_matricula_nao_concluida";
const PREQUAL_CAPTURE_INTENT_TYPE = "pre_qualificacao_iniciada";
const DEFAULT_INTENT_TYPE = ABANDONED_INTENT_TYPE;
const ALLOWED_INTENT_TYPES = new Set([ABANDONED_INTENT_TYPE, PREQUAL_CAPTURE_INTENT_TYPE]);
const ALLOWED_STEPS = new Set(["curso", "identificacao", "endereco", "experiencia", "finalizacao", "desconhecido"]);
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function sanitizeString(value: unknown, maxLen = 240): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeEmail(value: unknown): string | null {
  const email = sanitizeString(value, 180);
  if (!email || !email.includes("@")) return null;
  return email.toLowerCase();
}

function sanitizePhone(value: unknown): string | null {
  const digits = onlyDigits(value);
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function sanitizeUtm(value: unknown): string | null {
  const normalized = sanitizeString(value, 120);
  return normalized ? normalized.toLowerCase() : null;
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

function normalizeStep(value: unknown): string {
  const step = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!step) return "desconhecido";
  return ALLOWED_STEPS.has(step) ? step : "desconhecido";
}

function stepLabel(step: string): string {
  const map: Record<string, string> = {
    curso: "Curso",
    identificacao: "Identificação",
    endereco: "Endereço",
    experiencia: "Experiência",
    finalizacao: "Finalização",
    desconhecido: "Desconhecida"
  };
  return map[step] || "Desconhecida";
}

function parseLimit(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  const parsed = Math.trunc(num);
  if (parsed < 1) return 1;
  if (parsed > 200) return 200;
  return parsed;
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

async function sendAbandonedLeadAlert(input: {
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  courseName: string | null;
  courseSlug: string | null;
  city: string | null;
  state: string | null;
  lastStep: string;
  sourceUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}): Promise<void> {
  if (!isTelegramEnabled("TELEGRAM_ABANDONED_LEAD_ALERTS_ENABLED")) return;

  const location = [input.city, input.state].filter(Boolean).join("/");
  const attribution = [
    input.utmSource ? `source=${input.utmSource}` : "",
    input.utmMedium ? `medium=${input.utmMedium}` : "",
    input.utmCampaign ? `campaign=${input.utmCampaign}` : ""
  ]
    .filter(Boolean)
    .join(" | ");

  const lines = [
    "⚠️ Lead não concluiu a pré-matrícula",
    "",
    `👤 Nome: ${sanitizeMessageField(input.customerName)}`,
    `📱 WhatsApp: ${normalizePhoneForMessage(input.customerPhone)}`,
    `✉️ E-mail: ${sanitizeMessageField(input.customerEmail)}`,
    `📚 Curso: ${sanitizeMessageField(input.courseName || input.courseSlug)}`,
    `📍 Cidade/UF: ${sanitizeMessageField(location)}`,
    `🧭 Etapa: ${stepLabel(input.lastStep)}`,
    `🎯 Origem: ${sanitizeMessageField(attribution)}`,
    `🔗 Formulário: ${sanitizeMessageField(input.sourceUrl)}`,
    "Ação sugerida: chamar no WhatsApp e ajudar a concluir.",
    "#escolatecnica #lead_incompleto #comercial"
  ];

  const sent = await sendTelegramMessage(lines.join("\n"), {
    botTokenEnv: "TELEGRAM_LEADS_BOT_TOKEN",
    chatIdEnv: "TELEGRAM_LEADS_CHAT_ID",
    timeoutMs: 6_000
  });

  if (!sent) {
    console.error("Failed to send Telegram abandoned lead alert");
  }
}

async function handleLeadIntentLookup(req: Request, res: Response): Promise<void> {
  if (rateLimit(req, res, { keyPrefix: "matriculator-lead-intents", windowMs: 60_000, max: 120 })) return;
  if (!ensureMatriculatorAuthorization(req, res)) return;

  const limit = parseLimit(req.query?.limit);
  const rawIntentType = sanitizeString(req.query?.intent_type ?? req.query?.intentType, 120);
  const rawLastStep = sanitizeString(req.query?.last_step ?? req.query?.lastStep ?? req.query?.step, 40);
  const courseSlug = sanitizeString(req.query?.course_slug ?? req.query?.courseSlug, 120);

  const intentType = rawIntentType ? rawIntentType.toLowerCase() : DEFAULT_INTENT_TYPE;
  if (!ALLOWED_INTENT_TYPES.has(intentType)) {
    res.status(400).json({ error: "invalid_intent_type" });
    return;
  }

  let lastStepFilter: string | null = null;
  if (rawLastStep) {
    const normalized = rawLastStep.toLowerCase();
    if (!ALLOWED_STEPS.has(normalized)) {
      res.status(400).json({ error: "invalid_last_step" });
      return;
    }
    lastStepFilter = normalized;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  params.push(intentType);
  conditions.push(`intent_type = $${params.length}`);

  if (lastStepFilter) {
    params.push(lastStepFilter);
    conditions.push(`last_step = $${params.length}`);
  }

  if (courseSlug) {
    params.push(courseSlug);
    conditions.push(`lower(course_slug) = lower($${params.length})`);
  }

  params.push(limit);
  const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";

  try {
    if (isDemoMode()) {
      res.status(200).json(
        getDemoLeadIntentLookupResponse({
          intentType,
          lastStepFilter,
          courseSlug,
          limit
        })
      );
      return;
    }

    const { rows } = await query<LeadIntentLookupRow>(
      `select
          id::text as id,
          client_event_id,
          intent_type,
          course_slug,
          course_name,
          customer_name,
          customer_email,
          customer_phone,
          city,
          state,
          last_step,
          source_url,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          payload,
          created_at::text as created_at
        from lead_intents
        ${whereSql}
        order by created_at desc
        limit $${params.length}`,
      params
    );

    res.status(200).json({
      ok: true,
      count: rows.length,
      intents: rows.map((intent) => {
        const normalizedStep = normalizeStep(intent.last_step);
        return {
          intent_id: intent.id,
          client_event_id: intent.client_event_id,
          intent_type: intent.intent_type,
          course_slug: intent.course_slug,
          course_name: intent.course_name,
          customer_name: intent.customer_name,
          customer_email: intent.customer_email,
          customer_phone: intent.customer_phone,
          city: intent.city,
          state: intent.state,
          last_step: normalizedStep,
          last_step_label: stepLabel(normalizedStep),
          source_url: intent.source_url,
          utm_source: intent.utm_source,
          utm_medium: intent.utm_medium,
          utm_campaign: intent.utm_campaign,
          utm_content: intent.utm_content,
          utm_term: intent.utm_term,
          payload: intent.payload || {},
          created_at: intent.created_at
        };
      })
    });
  } catch (error) {
    console.error("Failed to load lead intents for matriculator", error);
    res.status(500).json({ error: "lead_intent_lookup_failed" });
  }
}

async function handleLeadIntentCreate(req: Request, res: Response): Promise<void> {
  if (rateLimit(req, res, { keyPrefix: "lead-intents", windowMs: 60_000, max: 120 })) return;

  const body = req.body ?? {};
  const intentType = String(body?.intent_type ?? body?.intentType ?? DEFAULT_INTENT_TYPE)
    .trim()
    .toLowerCase();

  if (!ALLOWED_INTENT_TYPES.has(intentType)) {
    res.status(400).json({ error: "invalid_intent_type" });
    return;
  }

  const clientEventId = sanitizeString(body?.client_event_id ?? body?.clientEventId, 120);
  if (!clientEventId) {
    res.status(400).json({ error: "missing_client_event_id" });
    return;
  }

  const courseSlug = sanitizeString(body?.course_slug ?? body?.courseSlug, 120);
  const courseName = sanitizeString(body?.course_name ?? body?.courseName, 180);
  const customerName = sanitizeString(body?.customer_name ?? body?.customerName ?? body?.name, 160);
  const customerEmail = sanitizeEmail(body?.customer_email ?? body?.customerEmail ?? body?.email);
  const customerPhone = sanitizePhone(body?.customer_phone ?? body?.customerPhone ?? body?.phone);
  const city = sanitizeString(body?.city, 120);
  const state = sanitizeString(body?.state, 8);
  const lastStep = normalizeStep(body?.last_step ?? body?.lastStep ?? body?.step);
  const sourceUrl = sanitizeString(body?.source_url ?? body?.sourceUrl, 500);

  const utmSource = sanitizeUtm(body?.utm_source ?? body?.utmSource);
  const utmMedium = sanitizeUtm(body?.utm_medium ?? body?.utmMedium);
  const utmCampaign = sanitizeUtm(body?.utm_campaign ?? body?.utmCampaign);
  const utmContent = sanitizeUtm(body?.utm_content ?? body?.utmContent);
  const utmTerm = sanitizeUtm(body?.utm_term ?? body?.utmTerm);

  const hasMinimumData = Boolean(courseSlug && customerName && (customerPhone || customerEmail));
  if (!hasMinimumData) {
    res.status(200).json(
      isDemoMode()
        ? getDemoLeadIntentCreateResponse({
            hasMinimumData,
            intentType,
            courseSlug,
            courseName,
            customerName,
            customerEmail,
            customerPhone,
            city,
            state,
            lastStep,
            sourceUrl
          })
        : { ok: true, stored: false, reason: "insufficient_data" }
    );
    return;
  }

  const payload = {
    reason: sanitizeString(body?.reason, 80),
    touched_fields: Array.isArray(body?.touched_fields ?? body?.touchedFields)
      ? (body?.touched_fields ?? body?.touchedFields)
      : undefined
  };

  if (isDemoMode()) {
    res.status(200).json(
      getDemoLeadIntentCreateResponse({
        hasMinimumData,
        intentType,
        courseSlug,
        courseName,
        customerName,
        customerEmail,
        customerPhone,
        city,
        state,
        lastStep,
        sourceUrl
      })
    );
    return;
  }

  try {
    const { rows } = await query<LeadIntentInsertRow>(
      `insert into lead_intents (
          client_event_id,
          intent_type,
          course_slug,
          course_name,
          customer_name,
          customer_email,
          customer_phone,
          city,
          state,
          last_step,
          source_url,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          payload
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )
        on conflict (client_event_id) do nothing
        returning id`,
      [
        clientEventId,
        intentType,
        courseSlug,
        courseName,
        customerName,
        customerEmail,
        customerPhone,
        city,
        state,
        lastStep,
        sourceUrl,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        payload
      ]
    );

    const inserted = Boolean(rows?.[0]?.id);
    if (inserted && intentType === ABANDONED_INTENT_TYPE) {
      await sendAbandonedLeadAlert({
        customerName,
        customerPhone,
        customerEmail,
        courseName,
        courseSlug,
        city,
        state,
        lastStep,
        sourceUrl,
        utmSource,
        utmMedium,
        utmCampaign
      });
    }

    res.status(200).json({ ok: true, stored: inserted });
  } catch (error) {
    console.error("Failed to store lead intent", error);
    res.status(500).json({ error: "lead_intent_store_failed" });
  }
}

export default async function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;

  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    await handleLeadIntentLookup(req, res);
    return;
  }

  if (req.method === "POST") {
    await handleLeadIntentCreate(req, res);
    return;
  }

  res.status(405).end();
}
