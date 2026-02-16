import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  normalizeToolArgs,
  repairToolArgs,
  wrapToolsForProvider
} from '../../src/renderer/services/ai/tool-normalizer'

describe('normalizeToolArgs', () => {
  it('should unwrap Ollama envelope format', () => {
    const args = {
      function: 'askQuestion',
      parameters: { questions: [{ id: '1', question: 'How are you?' }] }
    }
    const result = normalizeToolArgs(args)
    expect(result).toEqual({ questions: [{ id: '1', question: 'How are you?' }] })
  })

  it('should pass through flat OpenAI format unchanged', () => {
    const args = { questions: [{ id: '1', question: 'How are you?' }] }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when function is not a string', () => {
    const args = { function: 42, parameters: { foo: 'bar' } }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when parameters is not an object', () => {
    const args = { function: 'test', parameters: 'not-object' }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when parameters is an array', () => {
    const args = { function: 'test', parameters: [1, 2, 3] }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when parameters is null', () => {
    const args = { function: 'test', parameters: null }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when extra keys are present beyond function and parameters', () => {
    const args = { function: 'test', parameters: { foo: 'bar' }, extra: true }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when only function key is present', () => {
    const args = { function: 'test' }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })

  it('should pass through when only parameters key is present', () => {
    const args = { parameters: { foo: 'bar' } }
    const result = normalizeToolArgs(args)
    expect(result).toEqual(args)
  })
})

describe('repairToolArgs', () => {
  describe('askQuestion', () => {
    it('should repair flat singular format from Ollama', () => {
      const args = {
        question: 'Is everything okay?',
        options: ['Yes', 'No'],
        custom_answer: ''
      }
      const result = repairToolArgs('askQuestion', args)
      expect(result).toEqual({
        questions: [
          {
            id: '1',
            question: 'Is everything okay?',
            options: [
              { id: '1', label: 'Yes' },
              { id: '2', label: 'No' }
            ],
            allowCustom: true
          }
        ]
      })
    })

    it('should repair singular question with no options', () => {
      const args = { question: 'How are you?' }
      const result = repairToolArgs('askQuestion', args)
      expect(result.questions).toHaveLength(1)
      const q = (result.questions as Array<Record<string, unknown>>)[0]
      expect(q.question).toBe('How are you?')
      expect(q.options).toEqual([
        { id: '1', label: 'Yes' },
        { id: '2', label: 'No' }
      ])
      expect(q.allowCustom).toBe(true)
    })

    it('should repair singular question with custom_answer: false', () => {
      const args = {
        question: 'Choose one',
        options: ['A', 'B', 'C'],
        custom_answer: false
      }
      const result = repairToolArgs('askQuestion', args)
      const q = (result.questions as Array<Record<string, unknown>>)[0]
      expect(q.allowCustom).toBe(false)
    })

    it('should repair questions array with string options', () => {
      const args = {
        questions: [
          { question: 'Pick one', options: ['X', 'Y'] }
        ]
      }
      const result = repairToolArgs('askQuestion', args)
      const q = (result.questions as Array<Record<string, unknown>>)[0]
      expect(q.id).toBe('1')
      expect(q.options).toEqual([
        { id: '1', label: 'X' },
        { id: '2', label: 'Y' }
      ])
      expect(q.allowCustom).toBe(true)
    })

    it('should preserve already-correct questions array', () => {
      const args = {
        questions: [
          {
            id: '1',
            question: 'Test?',
            options: [
              { id: '1', label: 'Yes' },
              { id: '2', label: 'No' }
            ],
            allowCustom: false
          }
        ]
      }
      const result = repairToolArgs('askQuestion', args)
      expect(result).toEqual(args)
    })

    it('should auto-generate ids for questions missing them', () => {
      const args = {
        questions: [
          { question: 'First?' },
          { question: 'Second?' }
        ]
      }
      const result = repairToolArgs('askQuestion', args)
      const questions = result.questions as Array<Record<string, unknown>>
      expect(questions[0].id).toBe('1')
      expect(questions[1].id).toBe('2')
    })

    it('should handle mixed correct and incorrect option formats', () => {
      const args = {
        questions: [
          {
            question: 'Pick',
            options: [
              { id: 'a', label: 'Option A' },
              'Option B'
            ]
          }
        ]
      }
      const result = repairToolArgs('askQuestion', args)
      const q = (result.questions as Array<Record<string, unknown>>)[0]
      expect(q.options).toEqual([
        { id: 'a', label: 'Option A' },
        { id: '2', label: 'Option B' }
      ])
    })

    it('should pass through args unchanged for unknown tools', () => {
      const args = { foo: 'bar' }
      const result = repairToolArgs('unknownTool', args)
      expect(result).toBe(args)
    })
  })
})

describe('wrapToolsForProvider', () => {
  const mockSchema = z.object({
    path: z.string(),
    encoding: z.string().optional()
  })

  const mockExecute = vi.fn(async (args: { path: string }) => ({
    content: `read ${args.path}`
  }))

  const mockTools = {
    readFile: {
      description: 'Read a file',
      parameters: mockSchema,
      execute: mockExecute
    }
  }

  it('should return tools unchanged for openrouter', () => {
    const result = wrapToolsForProvider(mockTools as any, 'openrouter')
    expect(result).toBe(mockTools)
  })

  it('should wrap tools for ollama', () => {
    const result = wrapToolsForProvider(mockTools as any, 'ollama')
    expect(result).not.toBe(mockTools)
    expect(result.readFile).toBeDefined()
    expect(result.readFile.description).toBe('Read a file')
  })

  it('wrapped tool should handle flat args correctly', async () => {
    const result = wrapToolsForProvider(mockTools as any, 'ollama')
    const execute = (result.readFile as any).execute
    await execute({ path: '/tmp/test.txt' })
    expect(mockExecute).toHaveBeenCalledWith({ path: '/tmp/test.txt' })
  })

  it('wrapped tool should unwrap envelope args', async () => {
    mockExecute.mockClear()
    const result = wrapToolsForProvider(mockTools as any, 'ollama')
    const execute = (result.readFile as any).execute
    await execute({
      function: 'readFile',
      parameters: { path: '/tmp/test.txt' }
    })
    expect(mockExecute).toHaveBeenCalledWith({ path: '/tmp/test.txt' })
  })

  it('wrapped tool should return error for invalid args after normalization and repair', async () => {
    const result = wrapToolsForProvider(mockTools as any, 'ollama')
    const execute = (result.readFile as any).execute
    const response = await execute({
      function: 'readFile',
      parameters: { wrongKey: 123 }
    })
    expect(response).toHaveProperty('error', true)
    expect(response.message).toContain('Invalid arguments')
  })

  it('should preserve tools without execute function', () => {
    const toolsWithoutExecute = {
      noExec: {
        description: 'No execute',
        parameters: mockSchema
      }
    }
    const result = wrapToolsForProvider(toolsWithoutExecute as any, 'ollama')
    expect(result.noExec).toBe(toolsWithoutExecute.noExec)
  })

  it('wrapped askQuestion tool should repair and execute with Ollama-style args', async () => {
    const askSchema = z.object({
      questions: z.array(
        z.object({
          id: z.string(),
          question: z.string(),
          options: z
            .array(z.object({ id: z.string(), label: z.string() }))
            .min(2)
            .max(5),
          allowCustom: z.boolean().default(true)
        })
      ).min(1).max(5)
    })

    const askExecute = vi.fn(async (args: unknown) => ({
      answered: true,
      args
    }))

    const tools = {
      askQuestion: {
        description: 'Ask user a question',
        parameters: askSchema,
        execute: askExecute
      }
    }

    const wrapped = wrapToolsForProvider(tools as any, 'ollama')
    const execute = (wrapped.askQuestion as any).execute

    // Simulate what Ollama actually sends
    const response = await execute({
      question: 'Is everything okay?',
      options: ['Yes', 'No'],
      custom_answer: ''
    })

    expect(response.answered).toBe(true)
    expect(askExecute).toHaveBeenCalledWith({
      questions: [
        {
          id: '1',
          question: 'Is everything okay?',
          options: [
            { id: '1', label: 'Yes' },
            { id: '2', label: 'No' }
          ],
          allowCustom: true
        }
      ]
    })
  })

  it('wrapped askQuestion tool should pass through correct args without repair', async () => {
    const askSchema = z.object({
      questions: z.array(
        z.object({
          id: z.string(),
          question: z.string(),
          options: z
            .array(z.object({ id: z.string(), label: z.string() }))
            .min(2)
            .max(5),
          allowCustom: z.boolean().default(true)
        })
      ).min(1).max(5)
    })

    const askExecute = vi.fn(async (args: unknown) => ({ answered: true }))

    const tools = {
      askQuestion: {
        description: 'Ask user a question',
        parameters: askSchema,
        execute: askExecute
      }
    }

    const wrapped = wrapToolsForProvider(tools as any, 'ollama')
    const execute = (wrapped.askQuestion as any).execute

    const correctArgs = {
      questions: [
        {
          id: '1',
          question: 'Test?',
          options: [
            { id: '1', label: 'Yes' },
            { id: '2', label: 'No' }
          ],
          allowCustom: true
        }
      ]
    }

    await execute(correctArgs)
    expect(askExecute).toHaveBeenCalledWith(correctArgs)
  })
})
