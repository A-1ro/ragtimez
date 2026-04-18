export function extractText(response: unknown): string {
  if (typeof response === "string") return response;
  const r = response as Record<string, unknown>;
  if (r.response !== undefined) {
    return typeof r.response === "string" ? r.response : JSON.stringify(r.response);
  }
  const choices = r.choices as
    | { message: { content: string | null; reasoning: string | null } }[]
    | undefined;
  const msg = choices?.[0]?.message;
  if (msg) {
    if (typeof msg.content === "string") return msg.content;
    if (typeof msg.reasoning === "string") return msg.reasoning;
  }
  return JSON.stringify(response);
}
