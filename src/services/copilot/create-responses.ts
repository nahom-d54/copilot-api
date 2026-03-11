import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
    "X-Initiator": "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create responses", response)
    throw new HTTPError("Failed to create responses", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesResponse
}

// --- Responses API types ---

export interface ResponsesPayload {
  model: string
  input: ResponsesInput
  stream?: boolean
  max_output_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  stop?: string | Array<string> | null
  tools?: Array<ResponsesTool> | null
  tool_choice?: "none" | "auto" | "required" | null
  reasoning?: {
    effort?: string
  } | null
  user?: string | null
}

export type ResponsesInput = string | Array<ResponsesInputMessage>

export interface ResponsesInputMessage {
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponsesContentPart>
  type?: "message"
}

export type ResponsesContentPart =
  | ResponsesTextPart
  | ResponsesImagePart
  | ResponsesToolCallPart
  | ResponsesToolResultPart

export interface ResponsesTextPart {
  type: "input_text"
  text: string
}

export interface ResponsesImagePart {
  type: "input_image"
  image_url: string
  detail?: "low" | "high" | "auto"
}

export interface ResponsesToolCallPart {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
}

export interface ResponsesToolResultPart {
  type: "function_call_output"
  call_id: string
  output: string
}

export interface ResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

// --- Response types ---

export interface ResponsesResponse {
  id: string
  object: "response"
  created_at?: number
  model: string
  output: Array<ResponsesOutputItem>
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_tokens_details?: {
      cached_tokens: number
    }
  }
  status?: string
}

export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesOutputFunctionCall

export interface ResponsesOutputMessage {
  type: "message"
  id: string
  role: "assistant"
  content: Array<ResponsesOutputContent>
  status?: string
}

export interface ResponsesOutputContent {
  type: "output_text"
  text: string
  annotations?: Array<unknown>
}

export interface ResponsesOutputFunctionCall {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
  status?: string
}

// --- Streaming types ---

export interface ResponsesStreamEvent {
  type: string
  // Various fields depending on event type
  [key: string]: unknown
}
