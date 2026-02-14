import { describe, it, expect } from 'vitest'
import {
  validateArgs,
  fsPathSchema,
  fsWriteFileSchema,
  fsBashSchema,
  fsGlobSchema,
  fsGrepSchema,
  browserUrlSchema,
  browserSelectorSchema,
  browserTypeSchema,
  browserKeySchema,
  browserOpenForLoginSchema,
  settingsApiKeySchema
} from '../../src/main/ipc/ipc-validation'

// ---------------------------------------------------------------------------
// validateArgs core behavior
// ---------------------------------------------------------------------------

describe('validateArgs', () => {
  it('should return parsed data for valid input', () => {
    const result = validateArgs(fsPathSchema, '/some/path')
    expect(result).toBe('/some/path')
  })

  it('should throw with descriptive error for invalid input', () => {
    expect(() => validateArgs(fsPathSchema, '')).toThrow('IPC validation error')
  })

  it('should throw with field path in error message for object schemas', () => {
    expect(() => validateArgs(fsWriteFileSchema, { path: '', content: 'data' })).toThrow('path')
  })

  it('should throw for null input when string expected', () => {
    expect(() => validateArgs(fsPathSchema, null)).toThrow('IPC validation error')
  })

  it('should throw for undefined input when string expected', () => {
    expect(() => validateArgs(fsPathSchema, undefined)).toThrow('IPC validation error')
  })

  it('should throw for number input when string expected', () => {
    expect(() => validateArgs(fsPathSchema, 42)).toThrow('IPC validation error')
  })

  it('should pass through extra fields on object schemas (Zod default strip behavior)', () => {
    const result = validateArgs(fsWriteFileSchema, {
      path: '/test',
      content: 'hello',
      extra: 'ignored'
    })
    // Zod strips unknown keys by default
    expect(result).toEqual({ path: '/test', content: 'hello' })
    expect((result as Record<string, unknown>).extra).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// File system schemas
// ---------------------------------------------------------------------------

describe('fsPathSchema', () => {
  it('should accept non-empty strings', () => {
    expect(validateArgs(fsPathSchema, '/home/user/file.txt')).toBe('/home/user/file.txt')
  })

  it('should reject empty strings', () => {
    expect(() => validateArgs(fsPathSchema, '')).toThrow('IPC validation error')
    expect(() => validateArgs(fsPathSchema, '')).toThrow('Path must not be empty')
  })

  it('should reject non-string types', () => {
    expect(() => validateArgs(fsPathSchema, 123)).toThrow('IPC validation error')
    expect(() => validateArgs(fsPathSchema, true)).toThrow('IPC validation error')
    expect(() => validateArgs(fsPathSchema, {})).toThrow('IPC validation error')
    expect(() => validateArgs(fsPathSchema, [])).toThrow('IPC validation error')
  })
})

describe('fsWriteFileSchema', () => {
  it('should accept valid path and content', () => {
    const result = validateArgs(fsWriteFileSchema, { path: '/test.txt', content: 'hello' })
    expect(result).toEqual({ path: '/test.txt', content: 'hello' })
  })

  it('should accept empty content (content can be empty string)', () => {
    const result = validateArgs(fsWriteFileSchema, { path: '/test.txt', content: '' })
    expect(result).toEqual({ path: '/test.txt', content: '' })
  })

  it('should reject empty path', () => {
    expect(() => validateArgs(fsWriteFileSchema, { path: '', content: 'data' })).toThrow(
      'Path must not be empty'
    )
  })

  it('should reject missing content', () => {
    expect(() => validateArgs(fsWriteFileSchema, { path: '/test.txt' })).toThrow(
      'IPC validation error'
    )
  })

  it('should reject missing path', () => {
    expect(() => validateArgs(fsWriteFileSchema, { content: 'data' })).toThrow(
      'IPC validation error'
    )
  })
})

describe('fsBashSchema', () => {
  it('should accept command-only input', () => {
    const result = validateArgs(fsBashSchema, { command: 'ls -la' })
    expect(result).toEqual({ command: 'ls -la' })
  })

  it('should accept command with cwd and timeout', () => {
    const result = validateArgs(fsBashSchema, {
      command: 'git status',
      cwd: '/home/user/project',
      timeout: 5000
    })
    expect(result).toEqual({
      command: 'git status',
      cwd: '/home/user/project',
      timeout: 5000
    })
  })

  it('should reject empty command', () => {
    expect(() => validateArgs(fsBashSchema, { command: '' })).toThrow(
      'Invalid command: empty or malformed'
    )
  })

  it('should reject negative timeout', () => {
    expect(() => validateArgs(fsBashSchema, { command: 'ls', timeout: -1 })).toThrow(
      'IPC validation error'
    )
  })

  it('should reject zero timeout', () => {
    expect(() => validateArgs(fsBashSchema, { command: 'ls', timeout: 0 })).toThrow(
      'IPC validation error'
    )
  })

  it('should reject timeout exceeding 120000', () => {
    expect(() => validateArgs(fsBashSchema, { command: 'ls', timeout: 120001 })).toThrow(
      'IPC validation error'
    )
  })

  it('should accept timeout at the upper bound of 120000', () => {
    const result = validateArgs(fsBashSchema, { command: 'ls', timeout: 120000 })
    expect(result.timeout).toBe(120000)
  })

  it('should reject non-number timeout', () => {
    expect(() => validateArgs(fsBashSchema, { command: 'ls', timeout: 'fast' })).toThrow(
      'IPC validation error'
    )
  })
})

describe('fsGlobSchema', () => {
  it('should accept pattern-only input', () => {
    const result = validateArgs(fsGlobSchema, { pattern: '**/*.ts' })
    expect(result).toEqual({ pattern: '**/*.ts' })
  })

  it('should accept pattern with cwd', () => {
    const result = validateArgs(fsGlobSchema, { pattern: '*.js', cwd: '/src' })
    expect(result).toEqual({ pattern: '*.js', cwd: '/src' })
  })

  it('should reject empty pattern', () => {
    expect(() => validateArgs(fsGlobSchema, { pattern: '' })).toThrow('Pattern must not be empty')
  })
})

describe('fsGrepSchema', () => {
  it('should accept pattern and searchPath', () => {
    const result = validateArgs(fsGrepSchema, { pattern: 'TODO', searchPath: '/src' })
    expect(result).toEqual({ pattern: 'TODO', searchPath: '/src' })
  })

  it('should accept with options', () => {
    const result = validateArgs(fsGrepSchema, {
      pattern: 'TODO',
      searchPath: '/src',
      options: { maxResults: 50 }
    })
    expect(result.options?.maxResults).toBe(50)
  })

  it('should reject empty pattern', () => {
    expect(() => validateArgs(fsGrepSchema, { pattern: '', searchPath: '/src' })).toThrow(
      'Pattern must not be empty'
    )
  })

  it('should reject empty searchPath', () => {
    expect(() => validateArgs(fsGrepSchema, { pattern: 'TODO', searchPath: '' })).toThrow(
      'Search path must not be empty'
    )
  })
})

// ---------------------------------------------------------------------------
// Browser schemas
// ---------------------------------------------------------------------------

describe('browserUrlSchema', () => {
  it('should accept valid HTTP URLs', () => {
    expect(validateArgs(browserUrlSchema, 'https://example.com')).toBe('https://example.com')
  })

  it('should accept valid HTTP URL with path', () => {
    expect(validateArgs(browserUrlSchema, 'https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1'
    )
  })

  it('should accept non-URL strings (URL format validation is handled by validateBrowserUrl)', () => {
    // browserUrlSchema only ensures non-empty string; URL validation is downstream
    expect(validateArgs(browserUrlSchema, 'not-a-url')).toBe('not-a-url')
  })

  it('should reject empty strings', () => {
    expect(() => validateArgs(browserUrlSchema, '')).toThrow('Invalid URL')
  })

  it('should reject non-string values', () => {
    expect(() => validateArgs(browserUrlSchema, 42)).toThrow('IPC validation error')
    expect(() => validateArgs(browserUrlSchema, null)).toThrow('IPC validation error')
  })
})

describe('browserSelectorSchema', () => {
  it('should accept CSS selectors', () => {
    expect(validateArgs(browserSelectorSchema, '#submit-btn')).toBe('#submit-btn')
  })

  it('should reject empty selectors', () => {
    expect(() => validateArgs(browserSelectorSchema, '')).toThrow('Selector must not be empty')
  })
})

describe('browserTypeSchema', () => {
  it('should accept valid selector and text', () => {
    const result = validateArgs(browserTypeSchema, { selector: '#input', text: 'hello' })
    expect(result).toEqual({ selector: '#input', text: 'hello' })
  })

  it('should accept empty text (clearing an input)', () => {
    const result = validateArgs(browserTypeSchema, { selector: '#input', text: '' })
    expect(result).toEqual({ selector: '#input', text: '' })
  })

  it('should reject empty selector', () => {
    expect(() => validateArgs(browserTypeSchema, { selector: '', text: 'hello' })).toThrow(
      'Selector must not be empty'
    )
  })

  it('should reject missing text', () => {
    expect(() => validateArgs(browserTypeSchema, { selector: '#input' })).toThrow(
      'IPC validation error'
    )
  })
})

describe('browserKeySchema', () => {
  it('should accept key names', () => {
    expect(validateArgs(browserKeySchema, 'Enter')).toBe('Enter')
    expect(validateArgs(browserKeySchema, 'Tab')).toBe('Tab')
  })

  it('should reject empty key', () => {
    expect(() => validateArgs(browserKeySchema, '')).toThrow('Key must not be empty')
  })
})

describe('browserOpenForLoginSchema', () => {
  it('should accept valid url and siteName', () => {
    const result = validateArgs(browserOpenForLoginSchema, {
      url: 'https://github.com/login',
      siteName: 'GitHub'
    })
    expect(result).toEqual({ url: 'https://github.com/login', siteName: 'GitHub' })
  })

  it('should reject invalid URL', () => {
    expect(() =>
      validateArgs(browserOpenForLoginSchema, { url: 'not-a-url', siteName: 'Test' })
    ).toThrow('Must be a valid URL')
  })

  it('should reject empty siteName', () => {
    expect(() =>
      validateArgs(browserOpenForLoginSchema, { url: 'https://example.com', siteName: '' })
    ).toThrow('Site name must not be empty')
  })
})

// ---------------------------------------------------------------------------
// Settings schemas
// ---------------------------------------------------------------------------

describe('settingsApiKeySchema', () => {
  it('should accept non-empty API key strings', () => {
    expect(validateArgs(settingsApiKeySchema, 'sk-or-abc123')).toBe('sk-or-abc123')
  })

  it('should reject empty API key', () => {
    expect(() => validateArgs(settingsApiKeySchema, '')).toThrow('API key cannot be empty')
  })

  it('should reject whitespace-only API key', () => {
    expect(() => validateArgs(settingsApiKeySchema, '   ')).toThrow('API key cannot be empty')
  })

  it('should reject non-string values', () => {
    expect(() => validateArgs(settingsApiKeySchema, null)).toThrow('API key cannot be empty')
    expect(() => validateArgs(settingsApiKeySchema, undefined)).toThrow('API key cannot be empty')
    expect(() => validateArgs(settingsApiKeySchema, 12345)).toThrow('API key cannot be empty')
  })
})
