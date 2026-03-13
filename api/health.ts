import type { Request, Response } from "express";
import { cors } from "../lib/cors.js";
import { getDemoHealthPayload, isDemoMode } from "../lib/demo.js";
import { applySecurityHeaders } from "../lib/http.js";

export default function handler(req: Request, res: Response) {
  applySecurityHeaders(req, res);
  if (cors(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(isDemoMode() ? getDemoHealthPayload() : { ok: true });
}
