import { createOpenAI } from '@ai-sdk/openai'
import { streamText, generateText, type CoreMessage, type CoreTool } from 'ai'

// Simple token estimation (~4 chars per token on average)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Model context limits (conservative estimates)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'anthropic/claude-sonnet-4': 200000,
  'anthropic/claude-3.5-sonnet': 200000,
  'anthropic/claude-3-haiku': 200000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'google/gemini-2.0-flash-001': 1000000,
  'google/gemini-flash-1.5': 1000000,
  'default': 100000
}

export function getContextLimit(model: string): number {
  // Handle :online suffix
  const baseModel = model.replace(/:online$/, '')
  return MODEL_CONTEXT_LIMITS[baseModel] || MODEL_CONTEXT_LIMITS['default']
}

// Calculate total tokens in messages
export function calculateMessageTokens(
  messages: Array<{ role: string; content: string | unknown }>,
  systemPrompt: string
): number {
  let total = estimateTokens(systemPrompt)

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content)
    } else {
      // For multipart content, estimate based on JSON length
      total += estimateTokens(JSON.stringify(msg.content))
    }
  }

  return total
}

// Check if we're approaching context limit (80% threshold)
export function isApproachingContextLimit(
  messages: Array<{ role: string; content: string | unknown }>,
  systemPrompt: string,
  model: string
): boolean {
  const tokenCount = calculateMessageTokens(messages, systemPrompt)
  const limit = getContextLimit(model)
  return tokenCount > limit * 0.8
}

// Check if an error is a context-too-large error
export function isContextTooLargeError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('context') ||
      msg.includes('token') ||
      msg.includes('too long') ||
      msg.includes('too large') ||
      msg.includes('maximum') ||
      msg.includes('limit') ||
      msg.includes('exceeded') ||
      msg.includes('length')
    )
  }
  return false
}

export function createOpenRouterClient(apiKey: string) {
  return createOpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1'
  })
}

// Generate a short title for a conversation based on the first message
export async function generateConversationTitle(
  apiKey: string,
  userMessage: string
): Promise<string> {
  const client = createOpenRouterClient(apiKey)

  // Try multiple models in order of preference (fast & cheap)
  // Using correct OpenRouter model IDs - prioritize reliable, fast models
  const models = [
    'google/gemini-2.0-flash-001',
    'google/gemini-flash-1.5',
    'openai/gpt-4o-mini',
    'anthropic/claude-3-haiku'
  ]

  for (const modelId of models) {
    try {
      console.log(`[Title Generation] Trying model: ${modelId}`)
      const result = await generateText({
        model: client(modelId),
        messages: [
          {
            role: 'user',
            content: `Generate a very short title (3-6 words max) for a conversation that starts with this message. Return ONLY the title, no quotes, no explanation:\n\n${userMessage.slice(0, 300)}`
          }
        ],
        maxTokens: 30,
        maxRetries: 2
      })

      // Clean up the title
      let title = result.text.trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      // Remove "Title:" prefix if present
      title = title.replace(/^(title:?\s*)/i, '')
      // Limit length
      if (title.length > 50) {
        title = title.slice(0, 47) + '...'
      }

      if (title && title.length > 0) {
        console.log(`[Title Generation] Success with ${modelId}: "${title}"`)
        return title
      }
    } catch (error) {
      console.warn(`[Title Generation] Failed with ${modelId}:`, error)
      continue
    }
  }

  // Fallback to truncated message
  console.log('[Title Generation] All models failed, using fallback')
  return userMessage.slice(0, 40) + (userMessage.length > 40 ? '...' : '')
}

// Compact/summarize conversation history to reduce token count
// Keeps the last N messages intact and summarizes the rest
export async function compactConversation(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  keepLastN: number = 6
): Promise<{ summary: string; keptMessages: Array<{ role: string; content: string }> }> {
  // If we don't have enough messages to compact, return as-is
  if (messages.length <= keepLastN) {
    console.log('[Compaction] Not enough messages to compact')
    return { summary: '', keptMessages: messages }
  }

  const messagesToSummarize = messages.slice(0, -keepLastN)
  const keptMessages = messages.slice(-keepLastN)

  console.log(`[Compaction] Summarizing ${messagesToSummarize.length} messages, keeping ${keptMessages.length}`)

  const client = createOpenRouterClient(apiKey)

  // Build a text representation of the conversation to summarize
  const conversationText = messagesToSummarize
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1000)}${m.content.length > 1000 ? '...' : ''}`)
    .join('\n\n')

  // Use Gemini 3 Flash for summarization
  const modelId = 'google/gemini-3-flash-preview'

  try {
    console.log(`[Compaction] Using model: ${modelId}`)
    const result = await generateText({
      model: client(modelId),
      messages: [
        {
          role: 'user',
          content: `You are summarizing a conversation between a user and an AI assistant for context continuity. Create a concise summary that captures:
1. Key topics discussed
2. Important decisions made
3. Current task/goal status
4. Any relevant file paths, code snippets, or technical details mentioned

Be thorough but concise. Focus on information that would help continue the conversation.

CONVERSATION TO SUMMARIZE:
${conversationText}

Provide only the summary, no preamble.`
        }
      ],
      maxTokens: 2000,
      maxRetries: 2
    })

    const summary = result.text.trim()
    if (summary) {
      console.log(`[Compaction] Success, summary length: ${summary.length} chars`)
      return { summary, keptMessages }
    }
  } catch (error) {
    console.warn(`[Compaction] Failed:`, error)
  }

  // Fallback: just truncate the old messages
  console.log('[Compaction] Model failed, using truncation fallback')
  const fallbackSummary = `[Earlier conversation contained ${messagesToSummarize.length} messages that were truncated to save context space.]`
  return { summary: fallbackSummary, keptMessages }
}

type MessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image'; image: string }>

interface ToolCallEvent {
  id: string
  name: string
  args: Record<string, unknown>
}

interface ToolResultEvent {
  id: string
  name: string
  result: unknown
}

interface StreamChatOptions {
  client: ReturnType<typeof createOpenRouterClient>
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: MessageContent }>
  tools: Record<string, CoreTool>
  model?: string
  maxSteps?: number
  maxRetries?: number
  abortSignal?: AbortSignal
  onText?: (text: string) => void
  onToolCall?: (toolCall: ToolCallEvent) => void
  onToolResult?: (toolResult: ToolResultEvent) => void
}

export async function streamChat({
  client,
  systemPrompt,
  messages,
  tools,
  model = 'anthropic/claude-sonnet-4',
  maxSteps = 15,
  maxRetries = 3,
  abortSignal,
  onText,
  onToolCall,
  onToolResult
}: StreamChatOptions): Promise<{ text: string; steps: number }> {
  // Build messages array - the SDK accepts multipart content with images
  const coreMessages: CoreMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content
    }))
  ] as unknown as CoreMessage[]

  let fullText = ''
  let stepCount = 0

  try {
    const result = await streamText({
      model: client(model),
      messages: coreMessages,
      tools,
      maxSteps, // Allow multiple agent steps for tool use and self-correction
      maxRetries, // Retry on transient errors (default: 3)
      abortSignal,

      // This callback fires after each agent step with full context
      onStepFinish: (event) => {
        stepCount++

        // Process tool results from this step
        // The SDK automatically feeds these back to the model for the next step
        if (event.toolResults && Array.isArray(event.toolResults)) {
          for (const tr of event.toolResults) {
            // Type assertion since the SDK types are complex
            const toolResult = tr as { toolCallId: string; toolName: string; result: unknown }
            onToolResult?.({
              id: toolResult.toolCallId,
              name: toolResult.toolName,
              result: toolResult.result
            })
          }
        }

        console.log('Agent step finished:', {
          step: stepCount,
          type: event.stepType,
          finishReason: event.finishReason,
          toolCalls: event.toolCalls?.length || 0,
          toolResults: event.toolResults?.length || 0,
          textLength: event.text?.length || 0
        })
      }
    })

    // Process the full stream for real-time updates
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          fullText += part.textDelta
          onText?.(part.textDelta)
          break

        case 'tool-call':
          // Tool is about to be executed by the SDK
          onToolCall?.({
            id: part.toolCallId,
            name: part.toolName,
            args: part.args as Record<string, unknown>
          })
          break

        case 'error':
          console.error('Stream error:', part.error)
          throw new Error(String(part.error))
      }
    }

    return { text: fullText, steps: stepCount }
  } catch (error) {
    console.error('streamChat error:', error)
    throw formatError(error)
  }
}

function formatError(error: unknown): Error {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('401') || msg.includes('unauthorized') || (msg.includes('invalid') && msg.includes('key')) || msg.includes('cookie auth')) {
      return new Error('Invalid API key. Please check your OpenRouter API key in settings.')
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      return new Error('Rate limit exceeded. Please wait a moment and try again.')
    }
    if (msg.includes('insufficient_quota') || msg.includes('402')) {
      return new Error('Insufficient credits. Please add credits to your OpenRouter account.')
    }
    if (msg.includes('model') && (msg.includes('not found') || msg.includes('unavailable'))) {
      return new Error('The selected model is not available. Please try a different model.')
    }
    // Network/SSL errors
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('ssl') || msg.includes('err_ssl')) {
      return new Error('Network error connecting to OpenRouter. Please check your internet connection and try again.')
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return new Error('Request timed out. Please try again.')
    }
    return error
  }
  return new Error('An unknown error occurred')
}
