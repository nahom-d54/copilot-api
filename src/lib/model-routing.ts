/**
 * Model routing: parses reasoning effort suffixes from model names
 * and determines whether to route through the Responses API.
 *
 * Examples:
 *   "gpt-5.3-codex(high)"   -> { model: "gpt-5.3-codex", reasoningEffort: "high" }
 *   "claude-opus-4.6(low)"   -> { model: "claude-opus-4.6", reasoningEffort: "low" }
 *   "gpt-4o"                 -> { model: "gpt-4o", reasoningEffort: undefined }
 */

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh"

const REASONING_SUFFIX_RE = /^(.+)\((low|medium|high|xhigh)\)$/

const CODEX_MODEL_RE = /codex/i

export interface ParsedModel {
  model: string
  reasoningEffort?: ReasoningEffort
}

export function parseModelName(raw: string): ParsedModel {
  const match = REASONING_SUFFIX_RE.exec(raw)
  if (match) {
    return {
      model: match[1],
      reasoningEffort: match[2] as ReasoningEffort,
    }
  }
  return { model: raw }
}

export function isCodexModel(model: string): boolean {
  return CODEX_MODEL_RE.test(model)
}

export function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-")
}

/** Models whose level-suffixed variants we expose in /v1/models */
const REASONING_EFFORT_LEVELS: Array<ReasoningEffort> = [
  "low",
  "medium",
  "high",
  "xhigh",
]

const CLAUDE_REASONING_EFFORT_LEVELS: Array<ReasoningEffort> = [
  "low",
  "medium",
  "high",
]

/**
 * Given base models from the Copilot API, produce extra virtual model entries
 * for every valid reasoning-effort suffix.
 */
export function expandModelsWithReasoningVariants(
  baseModels: Array<{ id: string }>,
): Array<{ id: string }> {
  const extras: Array<{ id: string }> = []

  for (const m of baseModels) {
    if (isCodexModel(m.id)) {
      for (const level of REASONING_EFFORT_LEVELS) {
        extras.push({ id: `${m.id}(${level})` })
      }
    } else if (isClaudeModel(m.id)) {
      for (const level of CLAUDE_REASONING_EFFORT_LEVELS) {
        extras.push({ id: `${m.id}(${level})` })
      }
    }
  }

  return extras
}
