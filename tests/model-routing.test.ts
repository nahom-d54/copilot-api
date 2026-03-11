import { describe, test, expect } from "bun:test"

import {
  expandModelsWithReasoningVariants,
  isClaudeModel,
  isCodexModel,
  parseModelName,
} from "../src/lib/model-routing"

describe("parseModelName", () => {
  test("should parse model name without suffix", () => {
    expect(parseModelName("gpt-4o")).toEqual({
      model: "gpt-4o",
    })
  })

  test("should parse codex model with high reasoning effort", () => {
    expect(parseModelName("gpt-5.3-codex(high)")).toEqual({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    })
  })

  test("should parse codex model with xhigh reasoning effort", () => {
    expect(parseModelName("gpt-5.3-codex(xhigh)")).toEqual({
      model: "gpt-5.3-codex",
      reasoningEffort: "xhigh",
    })
  })

  test("should parse codex model with low reasoning effort", () => {
    expect(parseModelName("gpt-5.3-codex(low)")).toEqual({
      model: "gpt-5.3-codex",
      reasoningEffort: "low",
    })
  })

  test("should parse codex model with medium reasoning effort", () => {
    expect(parseModelName("gpt-5.3-codex(medium)")).toEqual({
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    })
  })

  test("should parse claude model with reasoning effort", () => {
    expect(parseModelName("claude-opus-4.6(high)")).toEqual({
      model: "claude-opus-4.6",
      reasoningEffort: "high",
    })
  })

  test("should parse claude-fast model with reasoning effort", () => {
    expect(parseModelName("claude-opus-4.6-fast(medium)")).toEqual({
      model: "claude-opus-4.6-fast",
      reasoningEffort: "medium",
    })
  })

  test("should parse claude-sonnet with reasoning effort", () => {
    expect(parseModelName("claude-sonnet-4.6(low)")).toEqual({
      model: "claude-sonnet-4.6",
      reasoningEffort: "low",
    })
  })

  test("should not parse invalid suffix", () => {
    expect(parseModelName("gpt-4o(invalid)")).toEqual({
      model: "gpt-4o(invalid)",
    })
  })

  test("should not parse empty suffix", () => {
    expect(parseModelName("gpt-4o()")).toEqual({
      model: "gpt-4o()",
    })
  })
})

describe("isCodexModel", () => {
  test("should return true for codex models", () => {
    expect(isCodexModel("gpt-5.3-codex")).toBe(true)
  })

  test("should return false for non-codex models", () => {
    expect(isCodexModel("gpt-4o")).toBe(false)
    expect(isCodexModel("claude-sonnet-4.6")).toBe(false)
  })
})

describe("isClaudeModel", () => {
  test("should return true for claude models", () => {
    expect(isClaudeModel("claude-opus-4.6")).toBe(true)
    expect(isClaudeModel("claude-sonnet-4.6")).toBe(true)
    expect(isClaudeModel("claude-opus-4.6-fast")).toBe(true)
  })

  test("should return false for non-claude models", () => {
    expect(isClaudeModel("gpt-4o")).toBe(false)
    expect(isClaudeModel("gpt-5.3-codex")).toBe(false)
  })
})

describe("expandModelsWithReasoningVariants", () => {
  test("should expand codex models with all 4 levels", () => {
    const base = [{ id: "gpt-5.3-codex" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([
      { id: "gpt-5.3-codex(low)" },
      { id: "gpt-5.3-codex(medium)" },
      { id: "gpt-5.3-codex(high)" },
      { id: "gpt-5.3-codex(xhigh)" },
    ])
  })

  test("should expand claude models with 3 levels (no xhigh)", () => {
    const base = [{ id: "claude-opus-4.6" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([
      { id: "claude-opus-4.6(low)" },
      { id: "claude-opus-4.6(medium)" },
      { id: "claude-opus-4.6(high)" },
    ])
  })

  test("should not expand regular models", () => {
    const base = [{ id: "gpt-4o" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([])
  })

  test("should expand mixed list correctly", () => {
    const base = [
      { id: "gpt-5.4" },
      { id: "gpt-5.3-codex" },
      { id: "claude-opus-4.6" },
      { id: "claude-sonnet-4.6" },
    ]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toHaveLength(4 + 3 + 3) // codex(4) + opus(3) + sonnet(3)
  })
})
