import { extractText } from "./extractText";
import type { ILlmClient, LlmTextRequest } from "./interfaces";

export class WorkersAiLlmClient implements ILlmClient {
  constructor(
    private readonly ai: {
      run(model: string, options: unknown): Promise<unknown>;
    },
  ) {}

  async generateText(request: LlmTextRequest): Promise<string> {
    const response = await this.ai.run(request.model, {
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.3,
    });

    return extractText(response).trim();
  }
}
