/**
 * OpenAI-compatible provider — works for OpenAI itself AND for DeepSeek
 * (DeepSeek's API is intentionally OpenAI-compatible at /v1/chat/completions).
 *
 * The only difference between the two is base URL + API key, which is why
 * a single class powers both providers in createAIClient().
 */

import OpenAI from "openai";

import type { ChatRequest, ChatResponse, Provider, VisionRequest } from "../types.js";

export class OpenAIProvider implements Provider {
  private client: OpenAI;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
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
    return {
      text: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
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
    return {
      text: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model ?? req.model,
    };
  }
}
