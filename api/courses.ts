import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { query } from "../lib/db.js";
import { isDemoMode, listDemoCourses } from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";

let hasCourseRefactorSchema: boolean | null = null;

export default async function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;
  if (req.method !== "GET") return res.status(405).end();

  if (rateLimit(req, res, { keyPrefix: "courses", windowMs: 60_000, max: 120 })) return;

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");

  if (isDemoMode()) {
    res.status(200).json({ demo: true, courses: listDemoCourses() });
    return;
  }

  try {
    let rows: unknown[] = [];
    if (hasCourseRefactorSchema !== false) {
      try {
        const enriched = await query(
          `select
              c.id,
              c.slug,
              c.name,
              c.price_cents,
              c.active,
              c.track,
              c.area,
              c.workload_hours,
              c.modality,
              c.duration_months_min,
              c.duration_months_max,
              c.tcc_required,
              p.slug as program_slug,
              p.name as program_name,
              o.requirements as track_requirements
            from courses c
            left join course_offers o on o.course_id = c.id
            left join course_programs p on p.id = o.program_id
            where c.active = true
              and (o.id is null or o.active = true)
            order by c.name asc`
        );
        rows = enriched.rows ?? [];
        hasCourseRefactorSchema = true;
      } catch (queryError) {
        const errorCode = String((queryError as { code?: unknown })?.code || "");
        const refactorTablesUnavailable = errorCode === "42P01" || errorCode === "42703";
        if (!refactorTablesUnavailable) throw queryError;
        hasCourseRefactorSchema = false;
      }
    }

    if (hasCourseRefactorSchema === false) {
      const fallback = await query(
        `select id, slug, name, price_cents, active, track, area, workload_hours, modality,
                duration_months_min, duration_months_max, tcc_required
           from courses
          where active = true
          order by name asc`
      );
      rows = fallback.rows ?? [];
    }

    res.status(200).json({ courses: rows ?? [] });
  } catch (error) {
    console.error("Failed to fetch courses", error);
    return res.status(500).json({ error: "courses_fetch_failed" });
  }
}
