import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { query } from "../lib/db.js";
import { getDemoFunnelEventResponse, isDemoMode } from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";
import { sendMetaContactConversion } from "../lib/metaConversions.js";
import { rateLimit } from "../lib/rateLimit.js";

type FunnelVisitInsertRow = {
  id: string;
};

const ALLOWED_EVENT_TYPES = new Set([
  "matricula_page_view",
  "marketing_page_view",
  "whatsapp_handoff",
  "whatsapp_icon_click"
]);
const CLICK_ID_KEYS = ["fbclid", "gclid", "wbraid", "gbraid"] as const;
const META_CLICK_ID_KEYS = ["fbc", "fbp"] as const;

function sanitizeString(value: unknown, maxLen = 240): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeUtm(value: unknown): string | null {
  const normalized = sanitizeString(value, 120);
  return normalized ? normalized.toLowerCase() : null;
}

function sanitizeClickId(value: unknown): string | null {
  return sanitizeString(value, 240);
}

function sanitizeMetaClickId(value: unknown): string | null {
  return sanitizeString(value, 320);
}

function getPgErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || "");
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getClickIds(body: any, nestedPayload: Record<string, unknown>): Record<string, string> | undefined {
  const nestedClickIds =
    nestedPayload?.click_ids && typeof nestedPayload.click_ids === "object"
      ? (nestedPayload.click_ids as Record<string, unknown>)
      : nestedPayload?.clickIds && typeof nestedPayload.clickIds === "object"
      ? (nestedPayload.clickIds as Record<string, unknown>)
      : null;
  const source =
    body?.click_ids && typeof body.click_ids === "object"
      ? body.click_ids
      : body?.clickIds && typeof body.clickIds === "object"
      ? body.clickIds
      : nestedClickIds;
  const out: Record<string, string> = {};

  for (const key of CLICK_ID_KEYS) {
    const value = sanitizeClickId(body?.[key] ?? source?.[key]);
    if (value) out[key] = value;
  }

  return Object.keys(out).length ? out : undefined;
}

function buildFbcFromFbclid(fbclid: string | null): string | null {
  const normalizedFbclid = sanitizeClickId(fbclid);
  if (!normalizedFbclid) return null;
  return `fb.1.${Date.now()}.${normalizedFbclid}`;
}

function getMetaClickIds(
  body: any,
  nestedPayload: Record<string, unknown>,
  clickIds: Record<string, string> | undefined
): Record<string, string> | undefined {
  const nestedClickIds =
    nestedPayload?.click_ids && typeof nestedPayload.click_ids === "object"
      ? (nestedPayload.click_ids as Record<string, unknown>)
      : nestedPayload?.clickIds && typeof nestedPayload.clickIds === "object"
      ? (nestedPayload.clickIds as Record<string, unknown>)
      : null;
  const source =
    body?.click_ids && typeof body.click_ids === "object"
      ? body.click_ids
      : body?.clickIds && typeof body.clickIds === "object"
      ? body.clickIds
      : nestedClickIds;

  const out: Record<string, string> = {};
  for (const key of META_CLICK_ID_KEYS) {
    const value = sanitizeMetaClickId(body?.[key] ?? body?.[`_${key}`] ?? source?.[key] ?? source?.[`_${key}`]);
    if (value) out[key] = value;
  }
  if (!out.fbc) {
    const fallbackFbc = buildFbcFromFbclid(clickIds?.fbclid || null);
    if (fallbackFbc) out.fbc = fallbackFbc;
  }

  return Object.keys(out).length ? out : undefined;
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

export default async function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  if (rateLimit(req, res, { keyPrefix: "funnel-events", windowMs: 60_000, max: 180 })) return;

  res.setHeader("Cache-Control", "no-store");

  const body = req.body ?? {};
  const nestedPayload = normalizePayload(body?.payload);
  const rawType = sanitizeString(body?.event_type ?? body?.eventType, 80);
  const eventType = rawType ? rawType.toLowerCase() : "";
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "invalid_event_type" });
  }

  const clientEventId = sanitizeString(body?.client_event_id ?? body?.clientEventId, 120);
  if (!clientEventId) return res.status(400).json({ error: "missing_client_event_id" });

  const sessionId = sanitizeString(body?.session_id ?? body?.sessionId, 120);
  const pagePath = sanitizeString(body?.page_path ?? body?.pagePath, 200);
  const sourceUrl = sanitizeString(body?.source_url ?? body?.sourceUrl, 600);
  const utmSource = sanitizeUtm(body?.utm_source ?? body?.utmSource ?? body?.utm?.utm_source ?? body?.utm?.utmSource);
  const utmMedium = sanitizeUtm(body?.utm_medium ?? body?.utmMedium ?? body?.utm?.utm_medium ?? body?.utm?.utmMedium);
  const utmCampaign = sanitizeUtm(
    body?.utm_campaign ?? body?.utmCampaign ?? body?.utm?.utm_campaign ?? body?.utm?.utmCampaign
  );
  const utmContent = sanitizeUtm(body?.utm_content ?? body?.utmContent ?? body?.utm?.utm_content ?? body?.utm?.utmContent);
  const utmTerm = sanitizeUtm(body?.utm_term ?? body?.utmTerm ?? body?.utm?.utm_term ?? body?.utm?.utmTerm);
  const clickIds = getClickIds(body, nestedPayload);
  const metaClickIds = getMetaClickIds(body, nestedPayload, clickIds);
  const leadId = sanitizeString(body?.lead_id ?? body?.leadId ?? nestedPayload?.lead_id ?? nestedPayload?.leadId, 80);
  const leadCode = sanitizeString(body?.lead_code ?? body?.leadCode ?? nestedPayload?.lead_code ?? nestedPayload?.leadCode, 40);
  const courseSlug = sanitizeString(body?.course_slug ?? body?.courseSlug ?? nestedPayload?.course_slug ?? nestedPayload?.courseSlug, 120);
  const whatsappUrl = sanitizeString(
    body?.whatsapp_url ?? body?.whatsappUrl ?? nestedPayload?.whatsapp_url ?? nestedPayload?.whatsappUrl,
    600
  );
  const courseName = sanitizeString(body?.course_name ?? body?.courseName ?? nestedPayload?.course_name ?? nestedPayload?.courseName, 160);
  const amountCentsRaw = body?.amount_cents ?? body?.amountCents ?? nestedPayload?.amount_cents ?? nestedPayload?.amountCents;
  const amountCents = Number.isFinite(Number(amountCentsRaw)) ? Math.max(0, Math.round(Number(amountCentsRaw))) : 0;
  const preMatriculaOkRaw =
    body?.pre_matricula_ok ??
    body?.preMatriculaOk ??
    nestedPayload?.pre_matricula_ok ??
    nestedPayload?.preMatriculaOk;
  const preMatriculaOk =
    typeof preMatriculaOkRaw === "boolean"
      ? preMatriculaOkRaw
      : typeof preMatriculaOkRaw === "string"
      ? ["1", "true", "yes", "on"].includes(preMatriculaOkRaw.toLowerCase())
      : undefined;
  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = getClientUserAgent(req);
  const payload = {
    ...nestedPayload,
    ...(leadId ? { lead_id: leadId } : {}),
    ...(leadCode ? { lead_code: leadCode } : {}),
    ...(courseSlug ? { course_slug: courseSlug } : {}),
    ...(whatsappUrl ? { whatsapp_url: whatsappUrl } : {}),
    ...(courseName ? { course_name: courseName } : {}),
    ...(preMatriculaOk !== undefined ? { pre_matricula_ok: preMatriculaOk } : {}),
    ...(clickIds ? { click_ids: clickIds } : {}),
    ...(metaClickIds ? { meta_click_ids: metaClickIds } : {})
  };

  if (isDemoMode()) {
    return res.status(201).json(getDemoFunnelEventResponse());
  }

  try {
    const { rows } = await query<FunnelVisitInsertRow>(
      `insert into funnel_visits (
          client_event_id,
          event_type,
          session_id,
          page_path,
          source_url,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          payload
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        on conflict (client_event_id) do nothing
        returning id`,
      [
        clientEventId,
        eventType,
        sessionId,
        pagePath,
        sourceUrl,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
        JSON.stringify(payload)
      ]
    );

    const duplicate = !rows?.length;

    if (!duplicate && eventType === "whatsapp_handoff") {
      await sendMetaContactConversion({
        eventId: clientEventId,
        leadId,
        leadCode,
        sourceUrl,
        courseSlug,
        courseName,
        amountCents,
        customerCountry: "br",
        attribution: {
          utm_source: utmSource || undefined,
          utm_medium: utmMedium || undefined,
          utm_campaign: utmCampaign || undefined,
          utm_content: utmContent || undefined,
          utm_term: utmTerm || undefined
        },
        clickIds,
        fbc: metaClickIds?.fbc,
        fbp: metaClickIds?.fbp,
        clientIpAddress,
        clientUserAgent,
        contactChannel: "whatsapp",
        whatsappUrl,
        preMatriculaOk
      });
    }

    return res.status(duplicate ? 200 : 201).json({ ok: true, duplicate });
  } catch (error) {
    const errorCode = getPgErrorCode(error);
    if (errorCode === "42P01" || errorCode === "42703" || errorCode === "23514") {
      return res.status(503).json({
        error: "funnel_visit_tracking_unavailable",
        detail:
          "Apply migrations db/init/120_funnel_visits.sql, db/init/130_marketing_clickids_whatsapp_handoff.sql, db/init/140_whatsapp_icon_click_tracking.sql and db/init/150_marketing_page_view_tracking.sql."
      });
    }

    console.error("Failed to store funnel visit", error);
    return res.status(500).json({ error: "funnel_visit_store_failed" });
  }
}
