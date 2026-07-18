import type { ILlmClient, LlmTextRequest } from "./interfaces";

const DEFAULT_BASE_URL = "https://api.anthropic.com" as const;

export class AnthropicLlmClient implements ILlmClient {
  private readonly baseUrl: string;

  private readonly gatewayToken?: string;

  /**
   * @param apiKey       Anthropic API key (sent as x-api-key; also required when routing
   *                     through Cloudflare AI Gateway).
   * @param baseUrl      Optional API base URL override. Set to a Cloudflare AI Gateway
   *                     endpoint (e.g. https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/anthropic)
   *                     to get caching / rate limiting / logging. Falls back to the
   *                     Anthropic API when unset.
   * @param gatewayToken Optional Cloudflare AI Gateway auth token (Authenticated Gateway).
   *                     Sent as cf-aig-authorization. Required because this repo is public
   *                     and the gateway URL in wrangler.toml is visible — without gateway
   *                     auth, third parties could consume our rate-limit quota.
   */
  constructor(
    private readonly apiKey: string,
    baseUrl?: string,
    gatewayToken?: string,
  ) {
    this.baseUrl = (baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.gatewayToken = gatewayToken?.trim() || undefined;
  }

  async generateText(request: LlmTextRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        ...(this.gatewayToken ? { "cf-aig-authorization": `Bearer ${this.gatewayToken}` } : {}),
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        messages: [{ role: "user", content: request.user }],
        system: request.system,
        // Claude 5 世代（claude-sonnet-5 等）は temperature が deprecated で 400 を返すため送らない
        ...(/^claude-[a-z]+-5/.test(request.model)
          ? {}
          : { temperature: request.temperature ?? 0.3 }),
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
