import type { PoolConfig } from "pg";

type RuntimeEnv = Record<string, string | undefined>;

function parseIntEnv(
  rawValue: string | undefined,
  fallback: number,
  options: { min: number; max: number }
): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  if (parsed < options.min) return options.min;
  if (parsed > options.max) return options.max;
  return parsed;
}

function isServerlessRuntime(runtimeEnv: RuntimeEnv): boolean {
  return Boolean(
    runtimeEnv.VERCEL ||
      runtimeEnv.AWS_LAMBDA_FUNCTION_NAME ||
      runtimeEnv.AWS_EXECUTION_ENV ||
      runtimeEnv.K_SERVICE
  );
}

function normalizePort(protocol: string, rawPort: string): string {
  if (rawPort) return rawPort;
  if (protocol === "postgresql:" || protocol === "postgres:") return "5432";
  return "";
}

export function shouldWarnAboutSupabaseDirectConnection(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const host = String(parsed.hostname || "").toLowerCase();
    const port = normalizePort(parsed.protocol, parsed.port);

    const isSupabaseHost =
      host.endsWith(".supabase.co") || host.endsWith(".supabase.com") || host.endsWith(".supabase.net");
    const isDirectHost = host.startsWith("db.");
    const isPoolerHost = host.includes(".pooler.");

    return isSupabaseHost && isDirectHost && !isPoolerHost && port !== "6543";
  } catch {
    return false;
  }
}

export function buildPoolConfig(
  connectionString: string,
  runtimeEnv: RuntimeEnv = process.env
): PoolConfig {
  const useSupabaseSsl = /supabase\.co|supabase\.com|supabase\.net/i.test(connectionString);
  const serverless = isServerlessRuntime(runtimeEnv);

  const max = parseIntEnv(runtimeEnv.PG_POOL_MAX, serverless ? 3 : 10, { min: 1, max: 30 });
  const idleTimeoutMillis = parseIntEnv(runtimeEnv.PG_IDLE_TIMEOUT_MS, serverless ? 5_000 : 10_000, {
    min: 1_000,
    max: 120_000
  });
  const connectionTimeoutMillis = parseIntEnv(runtimeEnv.PG_CONNECT_TIMEOUT_MS, 10_000, {
    min: 1_000,
    max: 60_000
  });
  const maxUses = parseIntEnv(runtimeEnv.PG_MAX_USES, 7_500, { min: 100, max: 1_000_000 });

  return {
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    maxUses,
    allowExitOnIdle: false,
    ...(useSupabaseSsl ? { ssl: { rejectUnauthorized: false } } : {})
  };
}

