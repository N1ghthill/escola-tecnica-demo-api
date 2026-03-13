import assert from "node:assert/strict";
import test from "node:test";
import { getFriendlyDeclineMessage, getPaymentUserMessage } from "../lib/paymentMessages.js";

test("getFriendlyDeclineMessage maps return code 80 to a user friendly message", () => {
  const message = getFriendlyDeclineMessage("80", "Transaction denied");
  assert.match(message, /saldo\/limite/i);
});

test("getFriendlyDeclineMessage falls back to provider return message for unknown codes", () => {
  const message = getFriendlyDeclineMessage("XYZ", "Dados inválidos para autorização");
  assert.equal(message, "Dados inválidos para autorização");
});

test("getFriendlyDeclineMessage hides technical provider messages from end users", () => {
  const message = getFriendlyDeclineMessage("51", "Product or service disabled for this merchant. Contact Rede.");
  assert.equal(
    message,
    "Não foi possível autorizar o pagamento no momento. Tente novamente em instantes."
  );
});

test("getPaymentUserMessage returns status-specific message for approved and pending_authentication", () => {
  assert.equal(
    getPaymentUserMessage({ status: "approved", returnCode: "00", returnMessage: "APPROVED" }),
    "Pagamento aprovado com sucesso."
  );
  assert.equal(
    getPaymentUserMessage({
      status: "pending_authentication",
      returnCode: "220",
      returnMessage: "3DS required"
    }),
    "Pagamento pendente de autenticação. Continue para concluir."
  );
});
