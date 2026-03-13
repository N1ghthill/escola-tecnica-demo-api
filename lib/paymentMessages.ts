const DECLINE_MESSAGES_BY_RETURN_CODE: Record<string, string> = {
  "05": "Pagamento não autorizado pela operadora. Revise os dados do cartão ou tente outro cartão.",
  "51": "Saldo ou limite insuficiente. Tente outro cartão ou outra forma de pagamento.",
  "54": "Cartão vencido. Revise a validade e tente novamente.",
  "57": "Transação não permitida para este cartão.",
  "58": "Transação não permitida para este estabelecimento.",
  "59": "Transação não autorizada por segurança. Contate o banco emissor.",
  "61": "Valor acima do limite permitido para este cartão.",
  "62": "Cartão com restrição de uso. Contate o banco emissor.",
  "63": "Falha de segurança na autorização. Tente novamente ou use outro cartão.",
  "65": "Limite de tentativas excedido. Aguarde alguns minutos e tente novamente.",
  "70": "Transação não permitida para este cartão. Contate o banco emissor.",
  "75": "Número máximo de tentativas excedido. Contate o banco emissor.",
  "80": "Transação não aprovada pela operadora. Verifique saldo/limite e tente outro cartão.",
  "91": "Banco emissor indisponível no momento. Tente novamente em instantes.",
  "96": "Falha sistêmica no emissor. Tente novamente em instantes."
};

type PaymentStatus =
  | "approved"
  | "pending_authentication"
  | "declined"
  | "processing"
  | "provider_unavailable"
  | string;

function sanitizeText(value: unknown, maxLen = 240): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function normalizeReturnCode(value: unknown): string | null {
  const text = sanitizeText(value, 16);
  return text ? text.toUpperCase() : null;
}

function isTechnicalProviderMessage(message: string): boolean {
  return /(merchant|contact rede|disabled|credentials?|token|pv|provider|timeout|internal)/i.test(message);
}

export function getFriendlyDeclineMessage(returnCode: string | null, returnMessage: string | null): string {
  const code = normalizeReturnCode(returnCode);
  const providerMessage = sanitizeText(returnMessage, 200);
  if (providerMessage && isTechnicalProviderMessage(providerMessage)) {
    return "Não foi possível autorizar o pagamento no momento. Tente novamente em instantes.";
  }

  if (code && DECLINE_MESSAGES_BY_RETURN_CODE[code]) return DECLINE_MESSAGES_BY_RETURN_CODE[code];
  if (providerMessage) return providerMessage;

  return "A operadora recusou a transação. Revise os dados e tente novamente.";
}

export function getPaymentUserMessage(input: {
  status: PaymentStatus;
  returnCode: string | null;
  returnMessage: string | null;
}): string {
  const status = String(input.status || "").trim().toLowerCase();

  if (status === "approved") return "Pagamento aprovado com sucesso.";
  if (status === "pending_authentication") {
    return "Pagamento pendente de autenticação. Continue para concluir.";
  }
  if (status === "processing") return "Pagamento em processamento.";
  if (status === "provider_unavailable") {
    return "Serviço de pagamento temporariamente indisponível. Tente novamente em instantes.";
  }
  if (status === "declined") {
    return getFriendlyDeclineMessage(input.returnCode, input.returnMessage);
  }

  return sanitizeText(input.returnMessage, 200) || "Não foi possível concluir o pagamento.";
}
