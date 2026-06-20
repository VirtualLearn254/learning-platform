export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Force JSON output. The model will be instructed to return only a JSON object. */
  jsonMode?: boolean;
  /** Stop sequences. */
  stop?: string[];
}

export interface VisionRequest extends Omit<ChatRequest, "messages"> {
  /** A short prompt explaining what to look at; pairs with the image. */
  prompt: string;
  /** System instruction. */
  system?: string;
  /** Image(s) to analyze. Base64 PNG/JPEG. */
  images: Array<{ base64: string; mediaType: "image/png" | "image/jpeg" }>;
}

export interface ChatResponse {
  /** The model's text response. */
  text: string;
  /** Whether the model stopped because it hit max_tokens. */
  truncated: boolean;
  /** Token usage if the backend reports it. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Which provider/model actually served the response (for cost attribution + debugging). */
  model: string;
}

/**
 * The provider interface every backend (vLLM, OpenAI, DeepSeek, ...) implements.
 * `vision` is optional because some providers / models don't support it.
 */
export interface Provider {
  chat(req: ChatRequest & { model: string }): Promise<ChatResponse>;
  vision?(req: VisionRequest & { model: string }): Promise<ChatResponse>;
}
