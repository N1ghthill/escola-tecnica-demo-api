import type { RedeTransactionResponse } from "./rede.js";

function sanitizeText(value: unknown, maxLen: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function getBrandName(brandRaw: unknown): string | null {
  if (typeof brandRaw === "string") return sanitizeText(brandRaw, 80);
  if (!brandRaw || typeof brandRaw !== "object") return null;
  return sanitizeText((brandRaw as { name?: unknown }).name, 80);
}

export function sanitizeProviderResponse(
  data: RedeTransactionResponse | null | undefined
): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};

  const output: Record<string, unknown> = {};

  const tid = sanitizeText(data.tid, 120);
  if (tid) output.tid = tid;

  const reference = sanitizeText(data.reference, 120);
  if (reference) output.reference = reference;

  const returnCode = sanitizeText(data.returnCode, 16);
  if (returnCode) output.returnCode = returnCode;

  const returnMessage = sanitizeText(data.returnMessage, 240);
  if (returnMessage) output.returnMessage = returnMessage;

  const authorizationCode = sanitizeText(data.authorizationCode, 40);
  if (authorizationCode) output.authorizationCode = authorizationCode;

  const brand = getBrandName(data.brand);
  if (brand) output.brand = brand;

  const threeDSecureUrl = sanitizeText(data?.threeDSecure?.url, 500);
  if (threeDSecureUrl) {
    output.threeDSecure = { required: true };
  } else if (data.threeDSecure && typeof data.threeDSecure === "object") {
    output.threeDSecure = { required: false };
  }

  return output;
}

