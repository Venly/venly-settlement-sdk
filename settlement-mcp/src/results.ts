function toStructured(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { result: data };
}
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: toStructured(data),
  };
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(client_secret\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export function errorResult(message: string) {
  const safeMessage = sanitizeErrorMessage(message);
  return {
    content: [{ type: "text" as const, text: `Error: ${safeMessage}` }],
    structuredContent: { error: safeMessage },
    isError: true,
  };
}
