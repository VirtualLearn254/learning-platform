/**
 * Anthropic provider — Claude API via @anthropic-ai/sdk.
 *
 * Uses the Messages API (not chat completions): role/content shape differs
 * from OpenAI, system prompts go on a separate field, and image content
 * blocks use base64 source objects.
 *
 * Vision: Claude 3.5+ models natively accept image blocks in user messages.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { ChatRequest, ChatResponse, Provider, VisionRequest } from "../types.js";

export class AnthropicProvider implements Provider {
  private client: Anthropic;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
  }

  async chat(req: ChatRequest & { model: string }): Promise<ChatResponse> {
    const { system, messages } = splitSystem(req.messages);
    const completion = await this.client.messages.create({
      model: req.model,
      system: req.jsonMode ? appendJsonInstruction(system) : system,
      messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens ?? 4096,
      stop_sequences: req.stop,
    });
    return shape(completion, req.model);
  }

  async vision(req: VisionRequest & { model: string }): Promise<ChatResponse> {
    const completion = await this.client.messages.create({
      model: req.model,
      system: req.system,
      messages: [{
        role: "user",
        content: [
          ...req.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 },
          })),
          { type: "text" as const, text: req.prompt },
        ],
      }],
      temperature: req.temperature,
      max_tokens: req.maxTokens ?? 2048,
    });
    return shape(completion, req.model);
  }
}

/** Anthropic puts system prompts on a separate field, not in messages[]. */
function splitSystem(messages: ChatRequest["messages"]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
  const nonSystem = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return {
    system: systems.length ? systems.join("\n\n") : undefined,
    messages: nonSystem,
  };
}

function appendJsonInstruction(system: string | undefined): string {
  const instr = "Respond ONLY with a valid JSON object. No prose, no markdown fences.";
  return system ? `${system}\n\n${instr}` : instr;
}

function shape(completion: Anthropic.Message, model: string): ChatResponse {
  const text = completion.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    truncated: completion.stop_reason === "max_tokens",
    usage: {
      inputTokens: completion.usage.input_tokens,
      outputTokens: completion.usage.output_tokens,
    },
    model: completion.model ?? model,
  };
}
