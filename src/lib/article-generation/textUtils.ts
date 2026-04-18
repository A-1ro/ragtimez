export function sanitizeExternalContent(text: string): string {
  const controlPrefixPattern =
    /^(SYSTEM|INSTRUCTION|IGNORE|OVERRIDE|ASSISTANT|USER|ADMIN|PROMPT|COMMAND|EXECUTE|FORGET|DISREGARD)\s*[:：]/gim;
  let sanitized = text.replace(controlPrefixPattern, "[REMOVED]:");

  const ignorePattern =
    /\b(ignore|disregard|forget|override|bypass)\s+(all\s+)?(previous|above|prior|earlier|preceding|system|initial)\s+(instructions?|prompts?|rules?|context|guidelines?|constraints?)/gi;
  sanitized = sanitized.replace(ignorePattern, "[REMOVED]");

  const roleChangePattern =
    /\b(you\s+are\s+now|from\s+now\s+on|act\s+as|pretend\s+(to\s+be|you\s+are)|you\s+must\s+now|switch\s+to|new\s+role|change\s+your\s+role)\b/gi;
  sanitized = sanitized.replace(roleChangePattern, "[REMOVED]");

  return sanitized;
}

export function stripOuterMarkdownFence(text: string): string {
  const lines = text.split("\n");
  if (
    lines.length >= 2 &&
    /^```(?:markdown)?\s*$/i.test(lines[0].trim()) &&
    lines[lines.length - 1].trim() === "```"
  ) {
    return lines.slice(1, -1).join("\n").trim();
  }
  return text.trim();
}
