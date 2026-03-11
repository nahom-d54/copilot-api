import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import {
  isClaudeModel,
  isCodexModel,
  isGpt5PlusModel,
  parseModelName,
} from "~/lib/model-routing"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletions,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"
import {
  createResponses,
  type ResponsesResponse,
} from "~/services/copilot/create-responses"

import {
  chatCompletionsToResponses,
  createResponsesStreamState,
  responsesEventToChatCompletionChunks,
  responsesToChatCompletion,
} from "./responses-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Parse model name suffix for reasoning effort
  const { model: baseModel, reasoningEffort } = parseModelName(payload.model)
  payload = { ...payload, model: baseModel }

  // Find the selected model (look up by base name)
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  // Route codex and GPT-5+ models through Responses API
  if (isCodexModel(payload.model) || isGpt5PlusModel(payload.model)) {
    return handleResponsesCompletion(c, payload, reasoningEffort)
  }

  // For Claude models with reasoning effort, add thinking configuration
  if (reasoningEffort && isClaudeModel(payload.model)) {
    payload = addClaudeThinking(payload, reasoningEffort)
  }

  // For non-Claude models with reasoning effort, pass it as a top-level field
  if (reasoningEffort && !isClaudeModel(payload.model)) {
    payload = {
      ...payload,
      reasoning_effort: reasoningEffort,
    } as ChatCompletionsPayload & { reasoning_effort: string }
  }

  const response = await createChatCompletions(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
  })
}

async function handleResponsesCompletion(
  c: Context,
  payload: ChatCompletionsPayload,
  reasoningEffort?: string,
) {
  const responsesPayload = chatCompletionsToResponses(payload, reasoningEffort)
  consola.debug(
    "Responses: translated to Responses API payload:",
    JSON.stringify(responsesPayload).slice(-400),
  )

  const response = await createResponses(responsesPayload)

  if (isResponsesNonStreaming(response)) {
    consola.debug(
      "Responses: non-streaming response:",
      JSON.stringify(response),
    )
    const chatResponse = responsesToChatCompletion(response)
    return c.json(chatResponse)
  }

  consola.debug("Responses: streaming response")
  return streamSSE(c, async (stream) => {
    const streamState = createResponsesStreamState()

    for await (const rawEvent of response) {
      consola.debug("Responses raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        await stream.writeSSE({ data: "[DONE]" })
        break
      }

      if (!rawEvent.data) continue

      const event = JSON.parse(rawEvent.data) as Record<string, unknown>
      const chunks = responsesEventToChatCompletionChunks(event, streamState)

      for (const chunk of chunks) {
        consola.debug("Responses translated chunk:", JSON.stringify(chunk))
        await stream.writeSSE({
          data: JSON.stringify(chunk),
        } as SSEMessage)
      }

      if (streamState.done) {
        await stream.writeSSE({ data: "[DONE]" })
        break
      }
    }
  })
}

function addClaudeThinking(
  payload: ChatCompletionsPayload,
  reasoningEffort: string,
): ChatCompletionsPayload {
  // The payload type doesn't include thinking, but we pass it through
  // to the Copilot API which supports it for Claude models
  const extended = payload as ChatCompletionsPayload & {
    reasoning_effort?: string
    thinking?: { type: string; effort?: string; budget_tokens?: number }
  }

  const thinking =
    extended.thinking ?
      { ...extended.thinking, effort: reasoningEffort }
    : { type: "enabled", effort: reasoningEffort }

  return {
    ...payload,
    reasoning_effort: reasoningEffort,
    thinking,
  } as ChatCompletionsPayload
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isResponsesNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response, "output")
