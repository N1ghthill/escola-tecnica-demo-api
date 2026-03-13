type TelegramOptions = {
  botTokenEnv?: string;
  chatIdEnv?: string;
  timeoutMs?: number;
};

function sanitizeEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function resolveBotToken(options?: TelegramOptions): string {
  const explicitEnv = String(options?.botTokenEnv || "").trim();
  if (explicitEnv) {
    const explicitValue = sanitizeEnv(explicitEnv);
    if (explicitValue) return explicitValue;
  }

  const salesToken = sanitizeEnv("TELEGRAM_SALES_BOT_TOKEN");
  if (salesToken) return salesToken;

  return sanitizeEnv("TELEGRAM_BOT_TOKEN");
}

function resolveChatId(options?: TelegramOptions): string {
  const explicitEnv = String(options?.chatIdEnv || "").trim();
  if (explicitEnv) {
    const explicitValue = sanitizeEnv(explicitEnv);
    if (explicitValue) return explicitValue;
  }

  const salesChatId = sanitizeEnv("TELEGRAM_SALES_CHAT_ID");
  if (salesChatId) return salesChatId;

  return sanitizeEnv("TELEGRAM_CHAT_ID");
}

export function isTelegramEnabled(envName = "TELEGRAM_NOTIFICATIONS_ENABLED"): boolean {
  const raw = sanitizeEnv(envName).toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

export async function sendTelegramMessage(text: string, options?: TelegramOptions): Promise<boolean> {
  const botToken = resolveBotToken(options);
  const chatId = resolveChatId(options);

  if (!botToken || !chatId) return false;

  const payload = new URLSearchParams();
  payload.set("chat_id", chatId);
  payload.set("text", text);

  const timeoutMs = Number.isFinite(Number(options?.timeoutMs))
    ? Math.max(1_000, Math.min(20_000, Math.trunc(Number(options?.timeoutMs))))
    : 8_000;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
      },
      body: payload.toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) return false;

    const data = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}
