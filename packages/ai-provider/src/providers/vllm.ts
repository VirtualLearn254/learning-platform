/**
 * vLLM provider — talks to a self-hosted vLLM OpenAI-compatible endpoint.
 *
 * vLLM exposes the OpenAI Chat Completions API at /v1/chat/completions, so we
 * can reuse the OpenAI SDK pointed at vllm's base URL. We keep this in its
 * own file because it's the primary production path and we may want to add
 * vLLM-specific features (guided decoding, lora adapters, etc.) later.
 *
 * Vision support: when serving a multimodal model like Qwen2-VL via vLLM, the
 * same /v1/chat/completions endpoint accepts image content blocks identical
 * to OpenAI's format. We exercise that here.
 */

import OpenAI from "openai";

import type { ChatRequest, ChatResponse, Provider, VisionRequest } from "../types.js";

export class VllmProvider implements Provider {
  private client: OpenAI;

  constructor(opts: { baseUrl: string; apiKey?: string }) {
    this.client = new OpenAI({
      baseURL: opts.baseUrl,
      // vLLM doesn't require a real key; pass a placeholder to satisfy the SDK
      apiKey: opts.apiKey ?? "vllm-local",
    });
  }

  async chat(req: ChatRequest & { model: string }): Promise<ChatResponse> {
    const completion = await this.client.chat.completions.create({
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stop: req.stop,
      response_format: req.jsonMode ? { type: "json_object" } : undefined,
    });

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? "";
    const truncated = choice?.finish_reason === "length";
    const usage = completion.usage;

    return {
      text,
      truncated,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      },
      model: completion.model ?? req.model,
    };
  }

  async vision(req: VisionRequest & { model: string }): Promise<ChatResponse> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: req.prompt },
    ];
    for (const img of req.images) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    }
    messages.push({ role: "user", content: userContent });

    const completion = await this.client.chat.completions.create({
      model: req.model,
      messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      response_format: req.jsonMode ? { type: "json_object" } : undefined,
    });

    const choice = completion.choices[0];
    const text = choice?.message?.content ?? "";
    const truncated = choice?.finish_reason === "length";
    const usage = completion.usage;

    return {
      text,
      truncated,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      },
      model: completion.model ?? req.model,
    };
  }
}
