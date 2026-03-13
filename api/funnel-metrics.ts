import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { query } from "../lib/db.js";
import { getDemoFunnelMetricsResponse, isDemoMode } from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";

type FunnelSummaryRow = {
  visits: number | string | null;
  whatsapp_icon_clicks: number | string | null;
  whatsapp_handoffs: number | string | null;
  leads_created: number | string | null;
  leads_contacted: number | string | null;
  enrollments_completed: number | string | null;
  incomplete_intents: number | string | null;
};

type FunnelDailyRow = {
  day: string;
  visits: number | string | null;
  whatsapp_icon_clicks: number | string | null;
  whatsapp_handoffs: number | string | null;
  leads_created: number | string | null;
  leads_contacted: number | string | null;
  enrollments_completed: number | string | null;
};

type FunnelStatusRow = {
  lead_status: string | null;
  total: number | string | null;
};

type FunnelAttributionRow = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  visits: number | string | null;
  whatsapp_icon_clicks: number | string | null;
  whatsapp_handoffs: number | string | null;
  leads_created: number | string | null;
  leads_contacted: number | string | null;
  enrollments_completed: number | string | null;
};

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const ABANDONED_INTENT_TYPE = "pre_matricula_nao_concluida";

function sanitizeString(value: unknown, maxLen = 240): string | null {
  const str = String(value ?? "").trim();
  if (!str) return null;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function getPgErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || "");
}

function parseDays(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 7;
  const parsed = Math.trunc(num);
  if (parsed < 1) return 1;
  if (parsed > 60) return 60;
  return parsed;
}

function toNonNegativeInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.trunc(num);
}

function ratioPct(base: number, total: number): number {
  if (base <= 0 || total <= 0) return 0;
  return Number(((total / base) * 100).toFixed(2));
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

export default async function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();
  if (rateLimit(req, res, { keyPrefix: "matriculator-funnel-metrics", windowMs: 60_000, max: 90 })) return;
  if (!ensureMatriculatorAuthorization(req, res)) return;

  res.setHeader("Cache-Control", "no-store");
  const days = parseDays(req.query?.days);

  if (isDemoMode()) {
    return res.status(200).json(getDemoFunnelMetricsResponse(days));
  }

  try {
    const summaryResult = await query<FunnelSummaryRow>(
      `with time_window as (
          select now() - make_interval(days => $1::int) as start_at
        ),
        visits as (
          select count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as total
          from funnel_visits, time_window
          where event_type = 'matricula_page_view'
            and created_at >= time_window.start_at
        ),
        icon_clicks as (
          select count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as total
          from funnel_visits, time_window
          where event_type = 'whatsapp_icon_click'
            and created_at >= time_window.start_at
        ),
        handoffs as (
          select count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as total
          from funnel_visits, time_window
          where event_type = 'whatsapp_handoff'
            and created_at >= time_window.start_at
        ),
        leads as (
          select
            count(*)::int as total,
            count(*) filter (where first_contact_at is not null)::int as contacted,
            count(*) filter (where coalesce(payment_status, '') in ('venda_concluida', 'approved'))::int as enrolled
          from lead_enrollments, time_window
          where created_at >= time_window.start_at
        ),
        intents as (
          select count(*)::int as total
          from lead_intents, time_window
          where created_at >= time_window.start_at
            and intent_type = $2
        )
        select
          visits.total as visits,
          icon_clicks.total as whatsapp_icon_clicks,
          handoffs.total as whatsapp_handoffs,
          leads.total as leads_created,
          leads.contacted as leads_contacted,
          leads.enrolled as enrollments_completed,
          intents.total as incomplete_intents
        from visits, icon_clicks, handoffs, leads, intents`,
      [days, ABANDONED_INTENT_TYPE]
    );

    const dailyResult = await query<FunnelDailyRow>(
      `with params as (
          select
            (current_date - ($1::int - 1))::date as start_day,
            current_date::date as end_day
        ),
        days as (
          select generate_series(
            (select start_day from params),
            (select end_day from params),
            interval '1 day'
          )::date as day
        ),
        visits as (
          select
            created_at::date as day,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as visits
          from funnel_visits
          where event_type = 'matricula_page_view'
            and created_at >= (select start_day from params)::timestamptz
          group by 1
        ),
        icon_clicks as (
          select
            created_at::date as day,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as whatsapp_icon_clicks
          from funnel_visits
          where event_type = 'whatsapp_icon_click'
            and created_at >= (select start_day from params)::timestamptz
          group by 1
        ),
        handoffs as (
          select
            created_at::date as day,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as whatsapp_handoffs
          from funnel_visits
          where event_type = 'whatsapp_handoff'
            and created_at >= (select start_day from params)::timestamptz
          group by 1
        ),
        leads as (
          select created_at::date as day, count(*)::int as leads_created
          from lead_enrollments
          where created_at >= (select start_day from params)::timestamptz
          group by 1
        ),
        contacts as (
          select first_contact_at::date as day, count(*)::int as leads_contacted
          from lead_enrollments
          where first_contact_at is not null
            and first_contact_at >= (select start_day from params)::timestamptz
          group by 1
        ),
        enrollments as (
          select coalesce(payment_updated_at, created_at)::date as day, count(*)::int as enrollments_completed
          from lead_enrollments
          where coalesce(payment_status, '') in ('venda_concluida', 'approved')
            and coalesce(payment_updated_at, created_at) >= (select start_day from params)::timestamptz
          group by 1
        )
        select
          d.day::text as day,
          coalesce(v.visits, 0)::int as visits,
          coalesce(ic.whatsapp_icon_clicks, 0)::int as whatsapp_icon_clicks,
          coalesce(h.whatsapp_handoffs, 0)::int as whatsapp_handoffs,
          coalesce(l.leads_created, 0)::int as leads_created,
          coalesce(c.leads_contacted, 0)::int as leads_contacted,
          coalesce(e.enrollments_completed, 0)::int as enrollments_completed
        from days d
        left join visits v on v.day = d.day
        left join icon_clicks ic on ic.day = d.day
        left join handoffs h on h.day = d.day
        left join leads l on l.day = d.day
        left join contacts c on c.day = d.day
        left join enrollments e on e.day = d.day
        order by d.day`,
      [days]
    );

    const statusResult = await query<FunnelStatusRow>(
      `select
          case
            when coalesce(payment_status, '') in ('pending', 'novo_lead') then 'novo_lead'
            when coalesce(payment_status, '') in ('processing', 'em_atendimento') then 'em_atendimento'
            when coalesce(payment_status, '') in ('approved', 'venda_concluida') then 'venda_concluida'
            when coalesce(payment_status, '') in ('declined', 'provider_unavailable', 'remarketing') then 'remarketing'
            when coalesce(payment_status, '') in ('pending_authentication', 'aguardando_retorno') then 'aguardando_retorno'
            else coalesce(nullif(trim(payment_status), ''), 'novo_lead')
          end as lead_status,
          count(*)::int as total
        from lead_enrollments
        where created_at >= now() - make_interval(days => $1::int)
        group by 1
        order by total desc, lead_status asc`,
      [days]
    );

    const attributionResult = await query<FunnelAttributionRow>(
      `with time_window as (
          select now() - make_interval(days => $1::int) as start_at
        ),
        visit_breakdown as (
          select
            coalesce(nullif(trim(utm_source), ''), '(direct)') as utm_source,
            coalesce(nullif(trim(utm_medium), ''), '(none)') as utm_medium,
            coalesce(nullif(trim(utm_campaign), ''), '(not_set)') as utm_campaign,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as visits
          from funnel_visits, time_window
          where event_type = 'matricula_page_view'
            and created_at >= time_window.start_at
          group by 1, 2, 3
        ),
        icon_click_breakdown as (
          select
            coalesce(nullif(trim(utm_source), ''), '(direct)') as utm_source,
            coalesce(nullif(trim(utm_medium), ''), '(none)') as utm_medium,
            coalesce(nullif(trim(utm_campaign), ''), '(not_set)') as utm_campaign,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as whatsapp_icon_clicks
          from funnel_visits, time_window
          where event_type = 'whatsapp_icon_click'
            and created_at >= time_window.start_at
          group by 1, 2, 3
        ),
        handoff_breakdown as (
          select
            coalesce(nullif(trim(utm_source), ''), '(direct)') as utm_source,
            coalesce(nullif(trim(utm_medium), ''), '(none)') as utm_medium,
            coalesce(nullif(trim(utm_campaign), ''), '(not_set)') as utm_campaign,
            count(distinct coalesce(nullif(session_id, ''), client_event_id))::int as whatsapp_handoffs
          from funnel_visits, time_window
          where event_type = 'whatsapp_handoff'
            and created_at >= time_window.start_at
          group by 1, 2, 3
        ),
        lead_breakdown as (
          select
            coalesce(nullif(trim(utm_source), ''), '(direct)') as utm_source,
            coalesce(nullif(trim(utm_medium), ''), '(none)') as utm_medium,
            coalesce(nullif(trim(utm_campaign), ''), '(not_set)') as utm_campaign,
            count(*)::int as leads_created,
            count(*) filter (where first_contact_at is not null)::int as leads_contacted,
            count(*) filter (where coalesce(payment_status, '') in ('venda_concluida', 'approved'))::int as enrollments_completed
          from lead_enrollments, time_window
          where created_at >= time_window.start_at
          group by 1, 2, 3
        ),
        keys as (
          select utm_source, utm_medium, utm_campaign from visit_breakdown
          union
          select utm_source, utm_medium, utm_campaign from icon_click_breakdown
          union
          select utm_source, utm_medium, utm_campaign from handoff_breakdown
          union
          select utm_source, utm_medium, utm_campaign from lead_breakdown
        )
        select
          k.utm_source,
          k.utm_medium,
          k.utm_campaign,
          coalesce(v.visits, 0)::int as visits,
          coalesce(ic.whatsapp_icon_clicks, 0)::int as whatsapp_icon_clicks,
          coalesce(h.whatsapp_handoffs, 0)::int as whatsapp_handoffs,
          coalesce(l.leads_created, 0)::int as leads_created,
          coalesce(l.leads_contacted, 0)::int as leads_contacted,
          coalesce(l.enrollments_completed, 0)::int as enrollments_completed
        from keys k
        left join visit_breakdown v
          on v.utm_source = k.utm_source
          and v.utm_medium = k.utm_medium
          and v.utm_campaign = k.utm_campaign
        left join icon_click_breakdown ic
          on ic.utm_source = k.utm_source
          and ic.utm_medium = k.utm_medium
          and ic.utm_campaign = k.utm_campaign
        left join handoff_breakdown h
          on h.utm_source = k.utm_source
          and h.utm_medium = k.utm_medium
          and h.utm_campaign = k.utm_campaign
        left join lead_breakdown l
          on l.utm_source = k.utm_source
          and l.utm_medium = k.utm_medium
          and l.utm_campaign = k.utm_campaign
        order by
          coalesce(l.leads_created, 0) desc,
          coalesce(ic.whatsapp_icon_clicks, 0) desc,
          coalesce(h.whatsapp_handoffs, 0) desc,
          coalesce(v.visits, 0) desc,
          k.utm_source asc,
          k.utm_medium asc,
          k.utm_campaign asc`,
      [days]
    );

    const summaryRow = summaryResult.rows?.[0];
    const visits = toNonNegativeInt(summaryRow?.visits);
    const whatsappIconClicks = toNonNegativeInt(summaryRow?.whatsapp_icon_clicks);
    const whatsappHandoffs = toNonNegativeInt(summaryRow?.whatsapp_handoffs);
    const leadsCreated = toNonNegativeInt(summaryRow?.leads_created);
    const leadsContacted = toNonNegativeInt(summaryRow?.leads_contacted);
    const enrollmentsCompleted = toNonNegativeInt(summaryRow?.enrollments_completed);
    const incompleteIntents = toNonNegativeInt(summaryRow?.incomplete_intents);

    const daily = (dailyResult.rows || []).map((row) => {
      const dayVisits = toNonNegativeInt(row.visits);
      const dayWhatsappIconClicks = toNonNegativeInt(row.whatsapp_icon_clicks);
      const dayWhatsappHandoffs = toNonNegativeInt(row.whatsapp_handoffs);
      const dayLeadsCreated = toNonNegativeInt(row.leads_created);
      const dayLeadsContacted = toNonNegativeInt(row.leads_contacted);
      const dayEnrollmentsCompleted = toNonNegativeInt(row.enrollments_completed);
      return {
        day: row.day,
        visits: dayVisits,
        whatsapp_icon_clicks: dayWhatsappIconClicks,
        whatsapp_handoffs: dayWhatsappHandoffs,
        leads_created: dayLeadsCreated,
        leads_contacted: dayLeadsContacted,
        enrollments_completed: dayEnrollmentsCompleted,
        visit_to_whatsapp_icon_rate_pct: ratioPct(dayVisits, dayWhatsappIconClicks),
        visit_to_whatsapp_rate_pct: ratioPct(dayVisits, dayWhatsappHandoffs),
        whatsapp_icon_to_handoff_rate_pct: ratioPct(dayWhatsappIconClicks, dayWhatsappHandoffs),
        visit_to_lead_rate_pct: ratioPct(dayVisits, dayLeadsCreated),
        lead_to_contact_rate_pct: ratioPct(dayLeadsCreated, dayLeadsContacted),
        lead_to_enrollment_rate_pct: ratioPct(dayLeadsCreated, dayEnrollmentsCompleted)
      };
    });

    return res.status(200).json({
      window_days: days,
      generated_at: new Date().toISOString(),
      summary: {
        visits,
        whatsapp_icon_clicks: whatsappIconClicks,
        whatsapp_handoffs: whatsappHandoffs,
        leads_created: leadsCreated,
        leads_contacted: leadsContacted,
        enrollments_completed: enrollmentsCompleted,
        incomplete_intents: incompleteIntents,
        rates: {
          visit_to_whatsapp_icon_pct: ratioPct(visits, whatsappIconClicks),
          visit_to_whatsapp_pct: ratioPct(visits, whatsappHandoffs),
          whatsapp_icon_to_handoff_pct: ratioPct(whatsappIconClicks, whatsappHandoffs),
          visit_to_lead_pct: ratioPct(visits, leadsCreated),
          lead_to_contact_pct: ratioPct(leadsCreated, leadsContacted),
          lead_to_enrollment_pct: ratioPct(leadsCreated, enrollmentsCompleted),
          contact_to_enrollment_pct: ratioPct(leadsContacted, enrollmentsCompleted),
          visit_to_enrollment_pct: ratioPct(visits, enrollmentsCompleted)
        }
      },
      daily,
      status_breakdown: (statusResult.rows || []).map((row) => ({
        lead_status: String(row.lead_status || "novo_lead"),
        total: toNonNegativeInt(row.total)
      })),
      attribution_breakdown: (attributionResult.rows || []).map((row) => {
        const bucketVisits = toNonNegativeInt(row.visits);
        const bucketWhatsappIconClicks = toNonNegativeInt(row.whatsapp_icon_clicks);
        const bucketWhatsappHandoffs = toNonNegativeInt(row.whatsapp_handoffs);
        const bucketLeadsCreated = toNonNegativeInt(row.leads_created);
        const bucketLeadsContacted = toNonNegativeInt(row.leads_contacted);
        const bucketEnrollmentsCompleted = toNonNegativeInt(row.enrollments_completed);
        return {
          utm_source: String(row.utm_source || "(direct)"),
          utm_medium: String(row.utm_medium || "(none)"),
          utm_campaign: String(row.utm_campaign || "(not_set)"),
          visits: bucketVisits,
          whatsapp_icon_clicks: bucketWhatsappIconClicks,
          whatsapp_handoffs: bucketWhatsappHandoffs,
          leads_created: bucketLeadsCreated,
          leads_contacted: bucketLeadsContacted,
          enrollments_completed: bucketEnrollmentsCompleted,
          visit_to_whatsapp_icon_rate_pct: ratioPct(bucketVisits, bucketWhatsappIconClicks),
          visit_to_whatsapp_rate_pct: ratioPct(bucketVisits, bucketWhatsappHandoffs),
          whatsapp_icon_to_handoff_rate_pct: ratioPct(bucketWhatsappIconClicks, bucketWhatsappHandoffs),
          visit_to_lead_rate_pct: ratioPct(bucketVisits, bucketLeadsCreated),
          lead_to_contact_rate_pct: ratioPct(bucketLeadsCreated, bucketLeadsContacted),
          lead_to_enrollment_rate_pct: ratioPct(bucketLeadsCreated, bucketEnrollmentsCompleted)
        };
      })
    });
  } catch (error) {
    const errorCode = getPgErrorCode(error);
    if (errorCode === "42P01" || errorCode === "42703") {
      return res.status(503).json({
        error: "funnel_metrics_unavailable",
        detail:
          "Apply migrations db/init/090_lead_funnel_tracking.sql, db/init/110_lead_intents.sql, db/init/120_funnel_visits.sql, db/init/130_marketing_clickids_whatsapp_handoff.sql and db/init/140_whatsapp_icon_click_tracking.sql."
      });
    }

    console.error("Failed to load funnel metrics", error);
    return res.status(500).json({ error: "funnel_metrics_failed" });
  }
}
