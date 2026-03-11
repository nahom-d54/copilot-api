import { describe, test, expect } from "bun:test"

import type { ChatCompletionsPayload } from "~/services/copilot/create-chat-completions"
import type { ResponsesResponse } from "~/services/copilot/create-responses"

import {
  chatCompletionsToResponses,
  responsesToChatCompletion,
} from "../src/routes/chat-completions/responses-translation"

describe("Chat Completions -> Responses API translation", () => {
  test("should translate basic chat payload to responses format", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "Hello!" }],
      max_tokens: 100,
      stream: false,
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.model).toBe("gpt-5.3-codex")
    expect(result.max_output_tokens).toBe(100)
    expect(result.stream).toBe(false)
    expect(Array.isArray(result.input)).toBe(true)
  })

  test("should translate system message", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    }

    const result = chatCompletionsToResponses(payload)
    const input = result.input as Array<{ role: string; content: string }>
    expect(input[0].role).toBe("system")
    expect(input[0].content).toBe("You are helpful.")
  })

  test("should include reasoning effort when provided", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "Hi" }],
    }

    const result = chatCompletionsToResponses(payload, "high")
    expect(result.reasoning).toEqual({ effort: "high" })
  })

  test("should not include reasoning when not provided", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "Hi" }],
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.reasoning).toBeUndefined()
  })

  test("should translate tool calls in assistant messages", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location":"NYC"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "Sunny, 72F",
        },
      ],
    }

    const result = chatCompletionsToResponses(payload)
    const input = result.input as Array<{ role: string; content: unknown }>
    // assistant message should have function_call parts
    const assistantMsg = input.find((m) => m.role === "assistant")
    expect(assistantMsg).toBeDefined()
    expect(Array.isArray(assistantMsg?.content)).toBe(true)
  })

  test("should translate tools definitions", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "Hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather info",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.tools).toHaveLength(1)
    expect(result.tools?.[0].name).toBe("get_weather")
    expect(result.tools?.[0].type).toBe("function")
  })

  test("should translate response_format json_object to text format", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Reply in JSON" }],
      response_format: { type: "json_object" },
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.text).toEqual({ format: { type: "json_object" } })
  })

  test("should translate response_format json_schema to text format", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Evaluate this" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "EvaluationAnswerSchema",
          schema: {
            type: "object",
            properties: {
              preferred: { type: "string" },
              pros: { type: "string" },
              cons: { type: "string" },
            },
            required: ["preferred", "pros", "cons"],
          },
          strict: true,
        },
      },
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.text).toEqual({
      format: {
        type: "json_schema",
        name: "EvaluationAnswerSchema",
        schema: {
          type: "object",
          properties: {
            preferred: { type: "string" },
            pros: { type: "string" },
            cons: { type: "string" },
          },
          required: ["preferred", "pros", "cons"],
        },
        strict: true,
      },
    })
  })

  test("should not set text format when response_format is absent", () => {
    const payload: ChatCompletionsPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    }

    const result = chatCompletionsToResponses(payload)
    expect(result.text).toBeUndefined()
  })
})

describe("Responses API -> Chat Completions translation", () => {
  test("should translate text response", () => {
    const resp: ResponsesResponse = {
      id: "resp_001",
      object: "response",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "message",
          id: "msg_001",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello there!" }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    }

    const result = responsesToChatCompletion(resp)
    expect(result.id).toBe("resp_001")
    expect(result.object).toBe("chat.completion")
    expect(result.choices[0].message.content).toBe("Hello there!")
    expect(result.choices[0].finish_reason).toBe("stop")
    expect(result.usage?.prompt_tokens).toBe(10)
    expect(result.usage?.completion_tokens).toBe(5)
  })

  test("should translate function call response", () => {
    const resp: ResponsesResponse = {
      id: "resp_002",
      object: "response",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "function_call",
          id: "fc_001",
          call_id: "call_001",
          name: "get_weather",
          arguments: '{"location":"NYC"}',
        },
      ],
    }

    const result = responsesToChatCompletion(resp)
    expect(result.choices[0].message.tool_calls).toHaveLength(1)
    expect(result.choices[0].message.tool_calls?.[0].function.name).toBe(
      "get_weather",
    )
    expect(result.choices[0].finish_reason).toBe("tool_calls")
  })

  test("should handle mixed output with text and function calls", () => {
    const resp: ResponsesResponse = {
      id: "resp_003",
      object: "response",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "message",
          id: "msg_001",
          role: "assistant",
          content: [{ type: "output_text", text: "I'll check for you." }],
        },
        {
          type: "function_call",
          id: "fc_001",
          call_id: "call_001",
          name: "search",
          arguments: '{"q":"test"}',
        },
      ],
    }

    const result = responsesToChatCompletion(resp)
    expect(result.choices[0].message.content).toBe("I'll check for you.")
    expect(result.choices[0].message.tool_calls).toHaveLength(1)
    expect(result.choices[0].finish_reason).toBe("tool_calls")
  })
})
