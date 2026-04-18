import type { ILlmClient, LlmTextRequest } from "./interfaces";

export class AnthropicLlmClient implements ILlmClient {
  constructor(private readonly apiKey: string) {}

  async generateText(request: LlmTextRequest): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        messages: [{ role: "user", content: request.user }],
        system: request.system,
        temperature: request.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(failed to read body)");
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText} — ${errorBody.slice(0, 500)}`,
      );
    }

    const data = (await response.json()) as {
      content?: { type: string; text: string }[];
    };
    const text = data.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("Anthropic API returned empty content");
    }

    return text.trim();
  }
}
