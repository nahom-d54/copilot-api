import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { isClaudeModel, parseModelName } from "~/lib/model-routing"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  consola.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  // Parse model name for reasoning effort suffix
  const { model: baseModel, reasoningEffort } = parseModelName(
    anthropicPayload.model,
  )

  // Apply reasoning effort to the Anthropic payload before translation
  const adjustedPayload: AnthropicMessagesPayload = {
    ...anthropicPayload,
    model: baseModel,
    ...(reasoningEffort && isClaudeModel(baseModel) ?
      {
        thinking:
          anthropicPayload.thinking ?
            { ...anthropicPayload.thinking, effort: reasoningEffort }
          : { type: "enabled" as const, effort: reasoningEffort },
      }
    : {}),
  }

  let openAIPayload: ChatCompletionsPayload = translateToOpenAI(adjustedPayload)

  // Add reasoning effort for the underlying API call
  if (reasoningEffort) {
    openAIPayload = {
      ...openAIPayload,
      reasoning_effort: reasoningEffort,
      ...(isClaudeModel(baseModel) ?
        {
          thinking: adjustedPayload.thinking ?? {
            type: "enabled",
            effort: reasoningEffort,
          },
        }
      : {}),
    } as ChatCompletionsPayload & {
      reasoning_effort: string
      thinking?: { type: string; effort?: string }
    }
  }

  consola.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response).slice(-400),
    )
    const anthropicResponse = translateToAnthropic(response)
    consola.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
    }

    for await (const rawEvent of response) {
      consola.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        consola.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
