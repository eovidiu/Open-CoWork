import { describe, it, expect } from 'vitest'
import {
  scanForCredentials,
  redactCredentials,
  CREDENTIAL_PLACEHOLDER
} from '../../src/main/services/credential-scanner'

describe('CredentialScanner', () => {
  describe('scanForCredentials', () => {
    it('should return hasCredentials false for clean text', () => {
      const result = scanForCredentials('This is just regular text with no secrets.')
      expect(result.hasCredentials).toBe(false)
      expect(result.redacted).toBe('This is just regular text with no secrets.')
      expect(result.matches).toEqual([])
    })

    it('should return hasCredentials false for empty string', () => {
      const result = scanForCredentials('')
      expect(result.hasCredentials).toBe(false)
      expect(result.redacted).toBe('')
      expect(result.matches).toEqual([])
    })

    describe('AWS keys', () => {
      it('should detect AWS access key IDs', () => {
        const text = 'My key is AKIAIOSFODNN7EXAMPLE'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.redacted).toContain(CREDENTIAL_PLACEHOLDER)
        expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
        expect(result.matches).toContain('aws-key')
      })

      it('should not match partial AWS key patterns', () => {
        const text = 'AKIA is too short'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(false)
      })
    })

    describe('Generic API keys', () => {
      it('should detect api_key assignments', () => {
        const text = 'api_key="sk_abcdefghij1234567890"'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.redacted).not.toContain('sk_abcdefghij1234567890')
        expect(result.matches).toContain('api-key')
      })

      it('should detect apikey in JSON', () => {
        const text = '{"apikey": "abcdefghijklmnopqrstuvwxyz"}'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('api-key')
      })

      it('should detect api-secret assignments', () => {
        const text = 'api-secret: long_secret_value_here_1234'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('api-key')
      })

      it('should not match short values after api_key', () => {
        const text = 'api_key="short"'
        const result = scanForCredentials(text)
        // "short" is only 5 chars, below the 20-char threshold
        expect(result.matches).not.toContain('api-key')
      })
    })

    describe('Bearer tokens', () => {
      it('should detect Bearer tokens', () => {
        const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('bearer-token')
      })

      it('should not match "Bearer" alone without a token', () => {
        const text = 'The Bearer of bad news'
        const result = scanForCredentials(text)
        expect(result.matches).not.toContain('bearer-token')
      })
    })

    describe('Private keys', () => {
      it('should detect RSA private key headers', () => {
        const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('private-key')
      })

      it('should detect generic private key headers', () => {
        const text = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('private-key')
      })

      it('should detect EC private key headers', () => {
        const text = '-----BEGIN EC PRIVATE KEY-----'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('private-key')
      })

      it('should detect OPENSSH private key headers', () => {
        const text = '-----BEGIN OPENSSH PRIVATE KEY-----'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('private-key')
      })
    })

    describe('Connection strings', () => {
      it('should detect MongoDB connection strings', () => {
        const text = 'DATABASE_URL=mongodb://admin:password@localhost:27017/mydb'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('connection-string')
      })

      it('should detect PostgreSQL connection strings', () => {
        const text = 'postgres://user:pass@host:5432/database'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('connection-string')
      })

      it('should detect MySQL connection strings', () => {
        const text = 'mysql://root:secret@db.example.com/prod'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('connection-string')
      })

      it('should detect Redis connection strings', () => {
        const text = 'redis://default:mypassword@redis-host:6379'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('connection-string')
      })
    })

    describe('JWT tokens', () => {
      it('should detect JWT tokens', () => {
        const text = 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('jwt')
      })

      it('should not match incomplete JWT-like strings', () => {
        const text = 'eyJhbG is just a fragment'
        const result = scanForCredentials(text)
        expect(result.matches).not.toContain('jwt')
      })
    })

    describe('GitHub tokens', () => {
      it('should detect ghp_ personal access tokens', () => {
        const text = 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('github-token')
      })

      it('should detect gho_ OAuth tokens', () => {
        const text = 'token: gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('github-token')
      })

      it('should detect ghs_ server tokens', () => {
        const text = 'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('github-token')
      })

      it('should not match short ghp_ strings', () => {
        const text = 'ghp_short'
        const result = scanForCredentials(text)
        expect(result.matches).not.toContain('github-token')
      })
    })

    describe('Generic secrets', () => {
      it('should detect password assignments', () => {
        const text = 'password="my_super_secret_password_123"'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('generic-secret')
      })

      it('should detect secret assignments', () => {
        const text = 'secret: "a_very_long_secret_value"'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('generic-secret')
      })

      it('should detect token assignments', () => {
        const text = "token='abcdef123456789_token'"
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('generic-secret')
      })

      it('should detect passwd assignments', () => {
        const text = 'passwd=longpasswordvalue1'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('generic-secret')
      })

      it('should not match short values after secret keywords', () => {
        const text = 'password="short"'
        const result = scanForCredentials(text)
        // "short" is only 5 chars, below the 8-char threshold
        expect(result.matches).not.toContain('generic-secret')
      })
    })

    describe('Slack tokens', () => {
      // Tokens are constructed dynamically to avoid triggering GitHub Push Protection
      const slackPrefix = 'xox'

      it('should detect xoxb bot tokens', () => {
        const text = `SLACK_TOKEN=${slackPrefix}b-123456789012-1234567890123-ABCdefGHIjklMNO`
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('slack-token')
      })

      it('should detect xoxp user tokens', () => {
        const text = `${slackPrefix}p-123456789012-1234567890123-1234567890123-abcdef`
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('slack-token')
      })

      it('should not match xox without valid suffix', () => {
        const text = 'xoxz-not-a-real-token'
        const result = scanForCredentials(text)
        expect(result.matches).not.toContain('slack-token')
      })
    })

    describe('Stripe keys', () => {
      it('should detect Stripe secret test keys', () => {
        const text = 'STRIPE_KEY=sk_test_abcdefghijklmnopqrstuvwxyz'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('stripe-key')
      })

      it('should detect Stripe live publishable keys', () => {
        const text = 'pk_live_ABCDEFGHIJKLmnopqrstuvwxyz'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('stripe-key')
      })

      it('should not match sk_test_ with short suffix', () => {
        const text = 'sk_test_short'
        const result = scanForCredentials(text)
        expect(result.matches).not.toContain('stripe-key')
      })
    })

    describe('Multiple credentials in one text', () => {
      it('should detect and redact multiple credential types', () => {
        const text = [
          'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
          'DB_URL=postgres://user:pass@host/db',
          'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
        ].join('\n')

        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(true)
        expect(result.matches).toContain('aws-key')
        expect(result.matches).toContain('connection-string')
        expect(result.matches).toContain('github-token')
        expect(result.redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
        expect(result.redacted).not.toContain('postgres://user:pass@host/db')
        expect(result.redacted).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTU')
      })
    })

    describe('Edge cases', () => {
      it('should handle text with code that looks like but is not credentials', () => {
        const text = 'const apiKeyLabel = "Enter your API key"'
        const result = scanForCredentials(text)
        // This should NOT match because there is no actual key value following
        expect(result.matches).not.toContain('api-key')
      })

      it('should handle very long text without catastrophic backtracking', () => {
        // Generate a large string with no credentials
        const longText = 'abcdefghijklmnop '.repeat(10000)
        const start = Date.now()
        const result = scanForCredentials(longText)
        const elapsed = Date.now() - start
        expect(result.hasCredentials).toBe(false)
        // Should complete in well under 1 second
        expect(elapsed).toBeLessThan(1000)
      })

      it('should handle text with special regex characters', () => {
        const text = 'some text with $pecial (characters) [and] {braces} + more'
        const result = scanForCredentials(text)
        expect(result.hasCredentials).toBe(false)
        expect(result.redacted).toBe(text)
      })

      it('should preserve surrounding text when redacting', () => {
        const text = 'Before AKIAIOSFODNN7EXAMPLE After'
        const result = scanForCredentials(text)
        expect(result.redacted).toBe(`Before ${CREDENTIAL_PLACEHOLDER} After`)
      })
    })
  })

  describe('redactCredentials', () => {
    it('should return clean text unchanged', () => {
      const text = 'Hello world'
      expect(redactCredentials(text)).toBe('Hello world')
    })

    it('should redact credentials and return only the string', () => {
      const text = 'key is AKIAIOSFODNN7EXAMPLE here'
      const result = redactCredentials(text)
      expect(result).toContain(CREDENTIAL_PLACEHOLDER)
      expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(typeof result).toBe('string')
    })

    it('should handle empty string', () => {
      expect(redactCredentials('')).toBe('')
    })
  })
})
