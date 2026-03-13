import assert from "node:assert/strict";
import test from "node:test";
import { buildPoolConfig, shouldWarnAboutSupabaseDirectConnection } from "../lib/dbConfig.js";

test("buildPoolConfig uses serverless-safe defaults and ssl for Supabase hosts", () => {
  const config = buildPoolConfig("postgres://user:pass@db.abcd.supabase.co:5432/postgres", {
    VERCEL: "1"
  });

  assert.equal(config.max, 3);
  assert.equal(config.idleTimeoutMillis, 5_000);
  assert.equal(config.connectionTimeoutMillis, 10_000);
  assert.equal(config.maxUses, 7_500);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("buildPoolConfig clamps pool env overrides to safe bounds", () => {
  const config = buildPoolConfig("postgres://user:pass@localhost:5432/postgres", {
    PG_POOL_MAX: "99",
    PG_IDLE_TIMEOUT_MS: "500",
    PG_CONNECT_TIMEOUT_MS: "70000",
    PG_MAX_USES: "50"
  });

  assert.equal(config.max, 30);
  assert.equal(config.idleTimeoutMillis, 1_000);
  assert.equal(config.connectionTimeoutMillis, 60_000);
  assert.equal(config.maxUses, 100);
});

test("shouldWarnAboutSupabaseDirectConnection detects direct db host and ignores pooler", () => {
  assert.equal(
    shouldWarnAboutSupabaseDirectConnection("postgres://u:p@db.xpigdmbphsxhfzyimdsd.supabase.co:5432/postgres"),
    true
  );
  assert.equal(
    shouldWarnAboutSupabaseDirectConnection(
      "postgres://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
    ),
    false
  );
});

