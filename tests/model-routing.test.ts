import { describe, test, expect } from "bun:test"

import {
  expandModelsWithReasoningVariants,
  isClaudeModel,
  isCodexModel,
  isGpt5PlusModel,
  isGptModel,
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

describe("isGptModel", () => {
  test("should return true for gpt models", () => {
    expect(isGptModel("gpt-4o")).toBe(true)
    expect(isGptModel("gpt-4.1")).toBe(true)
    expect(isGptModel("gpt-4.1-mini")).toBe(true)
    expect(isGptModel("gpt-5.3-codex")).toBe(true)
  })

  test("should return false for non-gpt models", () => {
    expect(isGptModel("claude-opus-4.6")).toBe(false)
    expect(isGptModel("o3")).toBe(false)
  })
})

describe("isGpt5PlusModel", () => {
  test("should return true for gpt-5+ models", () => {
    expect(isGpt5PlusModel("gpt-5")).toBe(true)
    expect(isGpt5PlusModel("gpt-5.3")).toBe(true)
    expect(isGpt5PlusModel("gpt-5.4")).toBe(true)
    expect(isGpt5PlusModel("gpt-6")).toBe(true)
    expect(isGpt5PlusModel("gpt-10")).toBe(true)
  })

  test("should return false for gpt-4.x and below", () => {
    expect(isGpt5PlusModel("gpt-4o")).toBe(false)
    expect(isGpt5PlusModel("gpt-4.1")).toBe(false)
    expect(isGpt5PlusModel("gpt-4.1-mini")).toBe(false)
    expect(isGpt5PlusModel("gpt-4")).toBe(false)
    expect(isGpt5PlusModel("gpt-3.5-turbo")).toBe(false)
  })

  test("should return false for non-gpt models", () => {
    expect(isGpt5PlusModel("claude-opus-4.6")).toBe(false)
    expect(isGpt5PlusModel("o3")).toBe(false)
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
    const base = [{ id: "o3" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([])
  })

  test("should not expand gpt-4.x models", () => {
    const base = [{ id: "gpt-4o" }, { id: "gpt-4.1" }, { id: "gpt-4.1-mini" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([])
  })

  test("should expand gpt-5+ models with 3 reasoning levels", () => {
    const base = [{ id: "gpt-5.4" }]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toEqual([
      { id: "gpt-5.4(low)" },
      { id: "gpt-5.4(medium)" },
      { id: "gpt-5.4(high)" },
    ])
  })

  test("should expand mixed list correctly", () => {
    const base = [
      { id: "o3" },
      { id: "gpt-4o" },
      { id: "gpt-5.4" },
      { id: "gpt-5.3-codex" },
      { id: "claude-opus-4.6" },
      { id: "claude-sonnet-4.6" },
    ]
    const variants = expandModelsWithReasoningVariants(base)
    expect(variants).toHaveLength(3 + 4 + 3 + 3) // gpt5(3) + codex(4) + opus(3) + sonnet(3)
  })
})
