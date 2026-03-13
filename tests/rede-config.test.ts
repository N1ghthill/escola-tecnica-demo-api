import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEnvironment, normalizeEnvValue } from "../lib/rede.js";

test("normalizeEnvValue removes wrapping quotes and escaped newlines", () => {
  assert.equal(normalizeEnvValue("\"production\\n\""), "production");
  assert.equal(normalizeEnvValue("  'sandbox\\r\\n' "), "sandbox");
});

test("normalizeEnvironment accepts quoted production values", () => {
  assert.equal(normalizeEnvironment("\"production\\n\""), "production");
  assert.equal(normalizeEnvironment("'prod'"), "production");
  assert.equal(normalizeEnvironment("sandbox"), "sandbox");
});
