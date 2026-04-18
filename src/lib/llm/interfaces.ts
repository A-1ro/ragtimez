export interface LlmTextRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  model: string;
}

export interface ILlmClient {
  generateText(request: LlmTextRequest): Promise<string>;
}
