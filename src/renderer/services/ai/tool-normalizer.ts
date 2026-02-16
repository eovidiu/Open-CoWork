import { z } from 'zod'
import type { CoreTool } from 'ai'

/**
 * Detect and unwrap the Ollama tool call envelope format.
 *
 * Ollama models sometimes wrap tool arguments as:
 *   { "function": "toolName", "parameters": { ...actual args } }
 *
 * OpenAI/OpenRouter returns flat args:
 *   { ...actual args }
 *
 * This function detects the envelope structurally and unwraps it.
 */
export function normalizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (
    typeof args.function === 'string' &&
    args.parameters !== null &&
    typeof args.parameters === 'object' &&
    !Array.isArray(args.parameters) &&
    Object.keys(args).length === 2
  ) {
    console.log(`[ToolNormalizer] Unwrapped Ollama envelope for tool: ${args.function}`)
    return args.parameters as Record<string, unknown>
  }
  return args
}

/**
 * Tool-specific argument repair functions.
 *
 * Ollama models (especially smaller ones) often simplify complex nested schemas.
 * These repair functions attempt to coerce malformed arguments into the expected
 * structure before validation.
 */
const toolRepairFns: Record<
  string,
  (args: Record<string, unknown>) => Record<string, unknown>
> = {
  askQuestion: repairAskQuestionArgs
}

/**
 * Repair malformed askQuestion arguments.
 *
 * Ollama sends:   { question: "...", options: ["Yes","No"], custom_answer: "" }
 * Expected:       { questions: [{ id: "1", question: "...", options: [{ id: "1", label: "Yes" }, ...], allowCustom: true }] }
 */
function repairAskQuestionArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  // Already has 'questions' array — try to repair individual items
  if (Array.isArray(args.questions)) {
    return {
      questions: args.questions.map((q: unknown, i: number) =>
        repairQuestionItem(q, i)
      )
    }
  }

  // Singular 'question' string → wrap in questions array
  if (typeof args.question === 'string') {
    const options = repairOptions(args.options)
    const allowCustom = resolveAllowCustom(args)

    return {
      questions: [
        {
          id: '1',
          question: args.question,
          options,
          allowCustom
        }
      ]
    }
  }

  return args
}

function repairQuestionItem(q: unknown, index: number): unknown {
  if (typeof q !== 'object' || q === null) return q
  const item = q as Record<string, unknown>
  const repaired: Record<string, unknown> = { ...item }

  // Auto-generate id if missing
  if (!repaired.id) {
    repaired.id = String(index + 1)
  }

  // Repair options if they're string arrays
  if (Array.isArray(repaired.options)) {
    repaired.options = repairOptions(repaired.options)
  }

  // Map custom_answer to allowCustom
  if (repaired.allowCustom === undefined) {
    repaired.allowCustom = resolveAllowCustom(repaired)
  }

  // Clean up non-schema keys
  delete repaired.custom_answer

  return repaired
}

function repairOptions(options: unknown): Array<{ id: string; label: string }> {
  if (!Array.isArray(options) || options.length === 0) {
    return [
      { id: '1', label: 'Yes' },
      { id: '2', label: 'No' }
    ]
  }

  return options.map((opt: unknown, i: number) => {
    if (typeof opt === 'string') {
      return { id: String(i + 1), label: opt }
    }
    if (typeof opt === 'object' && opt !== null) {
      const o = opt as Record<string, unknown>
      return {
        id: typeof o.id === 'string' ? o.id : String(i + 1),
        label: typeof o.label === 'string' ? o.label : String(opt)
      }
    }
    return { id: String(i + 1), label: String(opt) }
  })
}

function resolveAllowCustom(args: Record<string, unknown>): boolean {
  if (typeof args.allowCustom === 'boolean') return args.allowCustom
  if (args.custom_answer !== undefined) {
    // custom_answer: "" → true (field exists, user can type), custom_answer: false → false
    return args.custom_answer !== false
  }
  return true
}

/**
 * Attempt to repair tool arguments when initial validation fails.
 * Returns the repaired args, or the original args if no repair function exists.
 */
export function repairToolArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const repair = toolRepairFns[toolName]
  if (!repair) return args
  const repaired = repair(args)
  console.log(`[ToolNormalizer] Attempted repair for ${toolName}:`, JSON.stringify(repaired))
  return repaired
}

/**
 * Wrap tool definitions for Ollama compatibility.
 *
 * When provider is 'ollama', replaces each tool's zod schema with a permissive
 * one (z.record) and wraps the execute function to normalize arguments before
 * validating against the original schema. If validation fails, attempts
 * tool-specific argument repair before giving up.
 *
 * When provider is 'openrouter', returns tools unchanged.
 */
export function wrapToolsForProvider(
  tools: Record<string, CoreTool>,
  provider: 'openrouter' | 'ollama'
): Record<string, CoreTool> {
  if (provider !== 'ollama') {
    return tools
  }

  const wrapped: Record<string, CoreTool> = {}

  for (const [name, originalTool] of Object.entries(tools)) {
    const original = originalTool as {
      parameters: z.ZodType
      execute?: (args: unknown) => Promise<unknown>
      description?: string
    }

    if (!original.execute) {
      wrapped[name] = originalTool
      continue
    }

    const originalSchema = original.parameters
    const originalExecute = original.execute

    wrapped[name] = {
      description: original.description,
      parameters: z.record(z.unknown()),
      execute: async (rawArgs: Record<string, unknown>) => {
        const normalized = normalizeToolArgs(rawArgs)

        // First attempt: validate directly
        const result = originalSchema.safeParse(normalized)
        if (result.success) {
          return originalExecute(result.data)
        }

        // Second attempt: repair and re-validate
        const repaired = repairToolArgs(name, normalized)
        const retryResult = originalSchema.safeParse(repaired)
        if (retryResult.success) {
          console.log(`[ToolNormalizer] Repair succeeded for ${name}`)
          return originalExecute(retryResult.data)
        }

        console.error(
          `[ToolNormalizer] Validation failed for ${name} (after repair):`,
          retryResult.error.message
        )
        return {
          error: true,
          message: `Invalid arguments for tool ${name}: ${retryResult.error.message}`
        }
      }
    } as CoreTool
  }

  return wrapped
}
