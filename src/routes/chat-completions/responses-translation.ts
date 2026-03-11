/**
 * Translates between OpenAI Chat Completions format and the Responses API format.
 * Used when a codex model is requested through /v1/chat/completions.
 */

import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  ResponseFormat,
  Tool,
  ToolCall,
} from "~/services/copilot/create-chat-completions"
import type {
  ResponsesInput,
  ResponsesInputMessage,
  ResponsesPayload,
  ResponsesResponse,
  ResponsesTextFormat,
  ResponsesTool,
} from "~/services/copilot/create-responses"

// --- Request: Chat Completions → Responses ---

export function chatCompletionsToResponses(
  payload: ChatCompletionsPayload,
  reasoningEffort?: string,
): ResponsesPayload {
  return {
    model: payload.model,
    input: translateMessages(payload.messages),
    stream: payload.stream ?? undefined,
    max_output_tokens: payload.max_tokens,
    temperature: payload.temperature,
    top_p: payload.top_p,
    stop: payload.stop,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
    text: translateResponseFormat(payload.response_format),
    user: payload.user,
  }
}

function translateMessages(messages: Array<Message>): ResponsesInput {
  const result: Array<ResponsesInputMessage> = []

  for (const msg of messages) {
    if (msg.role === "tool") {
      // Tool results become function_call_output items attached to the previous assistant message
      // or as a standalone input item
      result.push({
        role: "user",
        type: "message",
        content: [
          {
            type: "function_call_output",
            call_id: msg.tool_call_id ?? "",
            output:
              typeof msg.content === "string" ?
                msg.content
              : JSON.stringify(msg.content),
          },
        ],
      })
      continue
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      // Assistant message with tool calls: emit the text + function_call items
      const content: ResponsesInputMessage["content"] = []
      if (typeof msg.content === "string" && msg.content) {
        content.push({ type: "input_text", text: msg.content })
      }
      for (const tc of msg.tool_calls) {
        content.push({
          type: "function_call",
          id: tc.id,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        })
      }
      result.push({ role: "assistant", type: "message", content })
      continue
    }

    // Regular message
    result.push({
      role: msg.role,
      type: "message",
      content: translateContent(msg.content),
    })
  }

  return result
}

function translateContent(content: Message["content"]):
  | string
  | Array<
      | { type: "input_text"; text: string }
      | {
          type: "input_image"
          image_url: string
          detail?: "low" | "high" | "auto"
        }
    > {
  if (typeof content === "string") {
    return content
  }
  if (!content) {
    return ""
  }
  return content.map((part: ContentPart) => {
    if (part.type === "text") {
      return { type: "input_text" as const, text: part.text }
    }
    // image_url
    return {
      type: "input_image" as const,
      image_url: part.image_url.url,
      detail: part.image_url.detail,
    }
  })
}

function translateTools(
  tools: Array<Tool> | null | undefined,
): Array<ResponsesTool> | undefined {
  if (!tools) return undefined
  return tools.map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }))
}

function translateToolChoice(
  choice: ChatCompletionsPayload["tool_choice"],
): ResponsesPayload["tool_choice"] {
  if (!choice) return undefined
  if (typeof choice === "string") {
    const validChoices: Array<ResponsesPayload["tool_choice"]> = [
      "none",
      "auto",
      "required",
    ]
    const match = validChoices.find((v) => v === choice)
    return match ?? undefined
  }
  // { type: "function", function: { name } } → for Responses API we just use "auto"
  return "auto"
}

function translateResponseFormat(
  format: ResponseFormat | null | undefined,
): ResponsesTextFormat | undefined {
  if (!format) return undefined
  if (format.type === "json_object") {
    return { format: { type: "json_object" } }
  }
  if (format.type === "json_schema") {
    return {
      format: {
        type: "json_schema",
        name: format.json_schema.name,
        description: format.json_schema.description,
        schema: format.json_schema.schema,
        strict: format.json_schema.strict,
      },
    }
  }
  return undefined
}

// --- Response: Responses → Chat Completions (non-streaming) ---

export function responsesToChatCompletion(
  resp: ResponsesResponse,
): ChatCompletionResponse {
  let textContent = ""
  const toolCalls: Array<ToolCall> = []

  for (const item of resp.output) {
    if (item.type === "message") {
      for (const c of item.content) {
        textContent += c.text
      }
    } else {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      })
    }
  }

  const finishReason: "stop" | "tool_calls" =
    toolCalls.length > 0 ? "tool_calls" : "stop"

  return {
    id: resp.id,
    object: "chat.completion",
    created: resp.created_at ?? Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    usage:
      resp.usage ?
        {
          prompt_tokens: resp.usage.input_tokens,
          completion_tokens: resp.usage.output_tokens,
          total_tokens: resp.usage.total_tokens,
          ...(resp.usage.input_tokens_details ?
            {
              prompt_tokens_details: {
                cached_tokens: resp.usage.input_tokens_details.cached_tokens,
              },
            }
          : {}),
        }
      : undefined,
  }
}

// --- Streaming: Responses SSE → Chat Completions SSE chunks ---

export interface ResponsesStreamState {
  chunkId: string
  model: string
  createdAt: number
  currentTextContent: string
  toolCalls: Array<{
    id: string
    callId: string
    name: string
    arguments: string
  }>
  done: boolean
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    chunkId: "",
    model: "",
    createdAt: Math.floor(Date.now() / 1000),
    currentTextContent: "",
    toolCalls: [],
    done: false,
  }
}

function getString(obj: Record<string, unknown>, key: string): string {
  const val = obj[key]
  return typeof val === "string" ? val : ""
}

function getRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const val = obj[key]
  return typeof val === "object" && val !== null ?
      (val as Record<string, unknown>)
    : undefined
}

/**
 * Translates a single Responses API SSE event into zero or more
 * Chat Completions SSE chunks.
 */
export function responsesEventToChatCompletionChunks(
  event: Record<string, unknown>,
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const eventType = getString(event, "type")

  switch (eventType) {
    case "response.created": {
      return handleResponseCreated(event, streamState)
    }
    case "response.output_text.delta": {
      return handleTextDelta(event, streamState)
    }
    case "response.function_call_arguments.delta": {
      return handleFunctionCallDelta(event, streamState)
    }
    case "response.output_item.added": {
      return handleOutputItemAdded(event, streamState)
    }
    case "response.completed": {
      return handleResponseCompleted(streamState)
    }
    default: {
      return []
    }
  }
}

function handleResponseCreated(
  event: Record<string, unknown>,
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const response = getRecord(event, "response")
  if (response) {
    streamState.chunkId = getString(response, "id") || streamState.chunkId
    streamState.model = getString(response, "model") || streamState.model
  }
  return [makeChunk(streamState, { role: "assistant" }, null)]
}

function handleTextDelta(
  event: Record<string, unknown>,
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const delta = getString(event, "delta")
  streamState.currentTextContent += delta
  return [makeChunk(streamState, { content: delta }, null)]
}

function handleFunctionCallDelta(
  event: Record<string, unknown>,
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const callId = getString(event, "call_id")
  const argDelta = getString(event, "delta")

  let tc = streamState.toolCalls.find((t) => t.callId === callId)
  if (!tc) {
    tc = {
      id: callId,
      callId,
      name: getString(event, "name"),
      arguments: "",
    }
    streamState.toolCalls.push(tc)
  }
  tc.arguments += argDelta

  const idx = streamState.toolCalls.indexOf(tc)
  const isFirst = tc.arguments === argDelta

  return [
    makeChunk(
      streamState,
      {
        tool_calls: [
          {
            index: idx,
            ...(isFirst ?
              {
                id: tc.callId,
                type: "function" as const,
                function: { name: tc.name, arguments: argDelta },
              }
            : { function: { arguments: argDelta } }),
          },
        ],
      },
      null,
    ),
  ]
}

function handleOutputItemAdded(
  event: Record<string, unknown>,
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const item = getRecord(event, "item")
  if (!item || getString(item, "type") !== "function_call") {
    return []
  }

  const callId = getString(item, "call_id") || getString(item, "id")
  const name = getString(item, "name")
  const existingTc = streamState.toolCalls.find((t) => t.callId === callId)
  if (!existingTc) {
    streamState.toolCalls.push({ id: callId, callId, name, arguments: "" })
  }
  const idx = streamState.toolCalls.findIndex((t) => t.callId === callId)

  return [
    makeChunk(
      streamState,
      {
        tool_calls: [
          {
            index: idx,
            id: callId,
            type: "function" as const,
            function: { name, arguments: "" },
          },
        ],
      },
      null,
    ),
  ]
}

function handleResponseCompleted(
  streamState: ResponsesStreamState,
): Array<ChatCompletionChunk> {
  const finishReason: "stop" | "tool_calls" =
    streamState.toolCalls.length > 0 ? "tool_calls" : "stop"
  streamState.done = true
  return [makeChunk(streamState, {}, finishReason)]
}

function makeChunk(
  state: ResponsesStreamState,
  delta: ChatCompletionChunk["choices"][0]["delta"],
  finishReason: ChatCompletionChunk["choices"][0]["finish_reason"],
): ChatCompletionChunk {
  return {
    id: state.chunkId || `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: state.createdAt,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  }
}
