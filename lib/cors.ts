import type { Request, Response } from "express";

const DEFAULT_FRONTEND_BASE_URL =
  "https://demo.escola-tecnica.example,https://escola-tecnica-demo-*.vercel.app";

type OriginPattern = {
  protocol: "http" | "https";
  hostnameRegex: RegExp;
  port: string;
};

type AllowedOriginsConfig = {
  exact: Set<string>;
  patterns: OriginPattern[];
};

function isProduction(): boolean {
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  return vercelEnv === "production" || nodeEnv === "production";
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function parseOriginList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseOriginPattern(origin: string): OriginPattern | null {
  const normalized = normalizeOrigin(origin).toLowerCase();
  const match = /^(https?):\/\/([^/:?#]+)(?::(\d{1,5}))?$/i.exec(normalized);
  if (!match) return null;

  const protocol = match[1] === "https" ? "https" : "http";
  const hostPattern = String(match[2] || "").trim().toLowerCase();
  const port = String(match[3] || "").trim();

  if (!hostPattern.includes("*")) return null;
  if (!/^[a-z0-9.*-]+$/.test(hostPattern)) return null;
  if (hostPattern.startsWith(".") || hostPattern.endsWith(".") || hostPattern.includes("..")) return null;

  const labels = hostPattern.split(".");
  if (!labels.length || labels.some((label) => !label)) return null;

  const hostnamePattern = labels
    .map((label) => escapeRegex(label).replace(/\\\*/g, "[a-z0-9-]*"))
    .join("\\.");

  return {
    protocol,
    hostnameRegex: new RegExp(`^${hostnamePattern}$`, "i"),
    port
  };
}

function parseAllowedOrigins(origins: string[]): AllowedOriginsConfig {
  const exact = new Set<string>();
  const patterns: OriginPattern[] = [];

  for (const origin of origins) {
    if (origin.includes("*")) {
      const parsedPattern = parseOriginPattern(origin);
      if (parsedPattern) patterns.push(parsedPattern);
      continue;
    }
    exact.add(origin);
  }

  return { exact, patterns };
}

function getAllowedOriginsConfig(): AllowedOriginsConfig {
  const configured = process.env.FRONTEND_ALLOWED_ORIGINS
    ? parseOriginList(process.env.FRONTEND_ALLOWED_ORIGINS)
    : process.env.FRONTEND_BASE_URL
      ? parseOriginList(process.env.FRONTEND_BASE_URL)
      : [];

  const defaults = parseOriginList(DEFAULT_FRONTEND_BASE_URL);

  const extras = isProduction()
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://localhost:5500",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:5500"
      ].map(normalizeOrigin);

  const merged = Array.from(new Set([...configured, ...defaults, ...extras]));
  return parseAllowedOrigins(merged);
}

function matchesOriginPattern(origin: string, pattern: OriginPattern): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (protocol !== pattern.protocol) return false;

  const hostname = String(parsed.hostname || "").trim().toLowerCase();
  if (!hostname || !pattern.hostnameRegex.test(hostname)) return false;

  const port = parsed.port || "";
  if (pattern.port) {
    return port === pattern.port;
  }

  return port === "";
}

function isAllowedOrigin(origin: string, config: AllowedOriginsConfig): boolean {
  if (config.exact.has(origin)) return true;
  return config.patterns.some((pattern) => matchesOriginPattern(origin, pattern));
}

export function cors(req: Request, res: Response): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowedOrigins = getAllowedOriginsConfig();
  const normalizedOrigin = origin ? normalizeOrigin(origin) : "";
  const hasAllowedOrigins = allowedOrigins.exact.size > 0 || allowedOrigins.patterns.length > 0;
  const originAllowed = normalizedOrigin ? isAllowedOrigin(normalizedOrigin, allowedOrigins) : false;
  res.setHeader("Vary", "Origin");

  if (origin && hasAllowedOrigins && !originAllowed) {
    res.status(403).json({ error: "forbidden_origin" });
    return true;
  }

  if (origin && hasAllowedOrigins && originAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Matriculator-Token, X-Internal-Token, Idempotency-Key"
  );

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
