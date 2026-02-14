import { z } from 'zod'

/**
 * Validate unknown arguments against a Zod schema.
 * Throws a descriptive error on validation failure.
 * Works with object schemas (for grouped args) and primitive schemas (for individual args).
 */
export function validateArgs<T extends z.ZodType>(schema: T, args: unknown): z.infer<T> {
  const result = schema.safeParse(args)
  if (!result.success) {
    throw new Error(
      `IPC validation error: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// File System schemas
// ---------------------------------------------------------------------------

export const fsPathSchema = z.string().min(1, 'Path must not be empty')

export const fsWriteFileSchema = z.object({
  path: z.string().min(1, 'Path must not be empty'),
  content: z.string()
})

export const fsBashSchema = z.object({
  command: z.string().min(1, 'Invalid command: empty or malformed'),
  cwd: z.string().optional(),
  timeout: z.number().positive().max(120000).optional()
})

export const fsGlobSchema = z.object({
  pattern: z.string().min(1, 'Pattern must not be empty'),
  cwd: z.string().optional()
})

export const fsGrepSchema = z.object({
  pattern: z.string().min(1, 'Pattern must not be empty'),
  searchPath: z.string().min(1, 'Search path must not be empty'),
  options: z
    .object({
      maxResults: z.number().optional()
    })
    .optional()
})

// ---------------------------------------------------------------------------
// Browser schemas
// ---------------------------------------------------------------------------

// Note: URL format validation is handled by validateBrowserUrl() in the handler.
// This schema only ensures we get a non-empty string before that check.
export const browserUrlSchema = z.string().min(1, 'Invalid URL')

export const browserSelectorSchema = z.string().min(1, 'Selector must not be empty')

export const browserTypeSchema = z.object({
  selector: z.string().min(1, 'Selector must not be empty'),
  text: z.string()
})

export const browserKeySchema = z.string().min(1, 'Key must not be empty')

export const browserOpenForLoginSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  siteName: z.string().min(1, 'Site name must not be empty')
})

// ---------------------------------------------------------------------------
// Settings schemas
// ---------------------------------------------------------------------------

export const settingsApiKeySchema = z
  .string({ message: 'API key cannot be empty' })
  .min(1, 'API key cannot be empty')
  .refine((val) => val.trim().length > 0, { message: 'API key cannot be empty' })
