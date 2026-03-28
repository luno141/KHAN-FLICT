function readNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  const direct =
    typeof record.shortMessage === "string"
      ? record.shortMessage
      : typeof record.reason === "string"
        ? record.reason
        : typeof record.message === "string"
          ? record.message
          : null;

  if (direct) {
    return direct;
  }

  return (
    readNestedMessage(record.error) ??
    readNestedMessage(record.info) ??
    readNestedMessage(record.data) ??
    null
  );
}

function normalizeMessage(message: string) {
  return message
    .replace(/^Error:\s*/i, "")
    .replace(/^execution reverted:\s*/i, "")
    .replace(/^Internal JSON-RPC error\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonPayloadMessage(message: string) {
  const firstBrace = message.indexOf("{");
  const lastBrace = message.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = message.slice(firstBrace, lastBrace + 1);

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const nested =
      readNestedMessage(parsed) ??
      (typeof parsed.error === "string" ? parsed.error : null);

    return nested ? normalizeMessage(nested) : null;
  } catch {
    return null;
  }
}

export function getUiErrorMessage(error: unknown, fallback: string) {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : readNestedMessage(error);

  if (!raw) {
    return fallback;
  }

  const jsonPayloadMessage = extractJsonPayloadMessage(raw);
  const message = normalizeMessage(jsonPayloadMessage ?? raw);
  const lower = message.toLowerCase();

  if (
    lower.includes("action_rejected") ||
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "The request was cancelled in your wallet.";
  }

  if (lower.includes("insufficient funds")) {
    return "Your wallet does not have enough MON for this action.";
  }

  if (
    lower.includes("bad_data") ||
    lower.includes("could not decode result data") ||
    lower.includes("missing revert data")
  ) {
    return "That contract action is unavailable on the connected network.";
  }

  if (lower.includes("network changed") || lower.includes("chain changed")) {
    return "Your wallet network changed. Please try the action again.";
  }

  if (lower.includes("timeout")) {
    return "The request took too long. Please try again.";
  }

  if (lower.includes("not deployed on the connected network")) {
    return message;
  }

  if (message.startsWith("{") || message.startsWith("[")) {
    return fallback;
  }

  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}
