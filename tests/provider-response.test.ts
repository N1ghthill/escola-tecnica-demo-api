import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeProviderResponse } from "../lib/providerResponse.js";

test("sanitizeProviderResponse keeps only safe, useful provider fields", () => {
  const sanitized = sanitizeProviderResponse({
    tid: "123456",
    reference: "chk-abc-123",
    returnCode: "51",
    returnMessage: "Saldo insuficiente",
    authorizationCode: "A1B2C3",
    brand: { name: "VISA" },
    threeDSecure: { url: "https://issuer.example/3ds?token=secret" },
    cardNumber: "4111111111111111",
    cvv: "123",
    token: "secret-token"
  } as any);

  assert.equal(sanitized.tid, "123456");
  assert.equal(sanitized.returnCode, "51");
  assert.deepEqual(sanitized.threeDSecure, { required: true });
  assert.equal("cardNumber" in sanitized, false);
  assert.equal("cvv" in sanitized, false);
  assert.equal("token" in sanitized, false);
});

test("sanitizeProviderResponse returns empty object for nullish values", () => {
  assert.deepEqual(sanitizeProviderResponse(null), {});
  assert.deepEqual(sanitizeProviderResponse(undefined), {});
});
