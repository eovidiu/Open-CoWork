import { describe, it, expect } from 'vitest'
import { scanForPii, hasPii, redactPii, type PiiMatch } from '../../src/main/services/pii-scanner'

describe('PiiScanner', () => {
  describe('scanForPii', () => {
    // --- Empty / undefined input ---
    it('should return empty array for empty string', () => {
      const result = scanForPii('')
      expect(result).toEqual([])
    })

    it('should return empty array for clean text', () => {
      const result = scanForPii('This is perfectly normal text with no PII.')
      expect(result).toEqual([])
    })

    // --- Email addresses ---
    describe('email addresses', () => {
      it('should detect a simple email address', () => {
        const result = scanForPii('Contact me at john.doe@example.com please')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('email')
        expect(result[0].value).toBe('john.doe@example.com')
      })

      it('should detect email with subdomain', () => {
        const result = scanForPii('Email: admin@mail.company.co.uk')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('email')
      })

      it('should detect multiple emails', () => {
        const result = scanForPii('From alice@test.com to bob@test.com')
        const emails = result.filter((m) => m.type === 'email')
        expect(emails).toHaveLength(2)
      })

      it('should detect email with plus addressing', () => {
        const result = scanForPii('Send to user+tag@gmail.com')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('email')
      })

      it('should not match incomplete email-like strings', () => {
        const result = scanForPii('user@ or @domain.com')
        const emails = result.filter((m) => m.type === 'email')
        expect(emails).toHaveLength(0)
      })
    })

    // --- Phone numbers ---
    describe('phone numbers', () => {
      it('should detect US phone with dashes', () => {
        const result = scanForPii('Call me at 555-123-4567')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('phone')
        expect(result[0].value).toBe('555-123-4567')
      })

      it('should detect US phone with parentheses', () => {
        const result = scanForPii('Phone: (555) 123-4567')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('phone')
      })

      it('should detect US phone with +1 prefix', () => {
        const result = scanForPii('My number is +15551234567')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('phone')
      })

      it('should detect US phone with dots', () => {
        const result = scanForPii('Reach me at 555.123.4567')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('phone')
      })

      it('should detect international phone with country code', () => {
        const result = scanForPii('Call +44 20 7946 0958')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('phone')
      })

      it('should not match IP addresses as phone numbers', () => {
        const result = scanForPii('Server at 192.168.1.1')
        const phones = result.filter((m) => m.type === 'phone')
        expect(phones).toHaveLength(0)
      })

      it('should not match random short digit sequences', () => {
        const result = scanForPii('Version 3.14.159')
        const phones = result.filter((m) => m.type === 'phone')
        expect(phones).toHaveLength(0)
      })
    })

    // --- SSN ---
    describe('social security numbers', () => {
      it('should detect SSN in standard format', () => {
        const result = scanForPii('SSN: 123-45-6789')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('ssn')
        expect(result[0].value).toBe('123-45-6789')
      })

      it('should not match random 9-digit numbers without dashes', () => {
        const result = scanForPii('Reference: 123456789')
        const ssns = result.filter((m) => m.type === 'ssn')
        expect(ssns).toHaveLength(0)
      })

      it('should not match invalid SSN starting with 000', () => {
        const result = scanForPii('Number: 000-12-3456')
        const ssns = result.filter((m) => m.type === 'ssn')
        expect(ssns).toHaveLength(0)
      })

      it('should not match invalid SSN starting with 666', () => {
        const result = scanForPii('Number: 666-12-3456')
        const ssns = result.filter((m) => m.type === 'ssn')
        expect(ssns).toHaveLength(0)
      })

      it('should not match invalid SSN starting with 9xx', () => {
        const result = scanForPii('Number: 900-12-3456')
        const ssns = result.filter((m) => m.type === 'ssn')
        expect(ssns).toHaveLength(0)
      })
    })

    // --- Credit card numbers ---
    describe('credit card numbers', () => {
      it('should detect Visa card number', () => {
        const result = scanForPii('Card: 4111111111111111')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should detect Visa card with spaces', () => {
        const result = scanForPii('Card: 4111 1111 1111 1111')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should detect Visa card with dashes', () => {
        const result = scanForPii('Card: 4111-1111-1111-1111')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should detect MasterCard number', () => {
        const result = scanForPii('Card: 5500000000000004')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should detect Amex card number (15 digits)', () => {
        const result = scanForPii('Card: 378282246310005')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should detect Discover card number', () => {
        const result = scanForPii('Card: 6011111111111117')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('credit-card')
      })

      it('should reject card numbers that fail Luhn check', () => {
        // 4111111111111112 fails Luhn
        const result = scanForPii('Card: 4111111111111112')
        const cards = result.filter((m) => m.type === 'credit-card')
        expect(cards).toHaveLength(0)
      })

      it('should not match random long digit sequences as credit cards', () => {
        // Timestamp-like numbers
        const result = scanForPii('Timestamp: 1708012345678901')
        const cards = result.filter((m) => m.type === 'credit-card')
        expect(cards).toHaveLength(0)
      })

      it('should not match hex strings as credit cards', () => {
        const result = scanForPii('Hash: 4a3f1b2c9d8e7f60')
        const cards = result.filter((m) => m.type === 'credit-card')
        expect(cards).toHaveLength(0)
      })
    })

    // --- US mailing addresses ---
    describe('US mailing addresses', () => {
      it('should detect a street address', () => {
        const result = scanForPii('My address is 123 Main Street')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('address')
      })

      it('should detect address with abbreviated suffix', () => {
        const result = scanForPii('Located at 456 Oak Ave')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('address')
      })

      it('should detect address with Blvd', () => {
        const result = scanForPii('Office at 789 Sunset Blvd')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('address')
      })

      it('should detect address with Drive', () => {
        const result = scanForPii('Send to 1024 Technology Drive')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('address')
      })

      it('should detect address with Ln suffix', () => {
        const result = scanForPii('Lives at 42 Willow Ln')
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe('address')
      })

      it('should not match code-like text with numbers', () => {
        const result = scanForPii('line 42 of the function')
        const addresses = result.filter((m) => m.type === 'address')
        expect(addresses).toHaveLength(0)
      })
    })

    // --- False positive resistance ---
    describe('false positive resistance', () => {
      it('should not flag normal prose text', () => {
        const text = 'The quick brown fox jumps over the lazy dog. It was a beautiful day with 25 degrees outside.'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })

      it('should not flag code content', () => {
        const text = 'const port = 8080; const timeout = 3000; const maxRetries = 5;'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })

      it('should not flag version numbers', () => {
        const text = 'Node.js v18.17.1, npm 9.6.7, TypeScript 5.2.2'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })

      it('should not flag dates', () => {
        const text = 'Meeting on 2024-01-15 at 3pm'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })

      it('should not flag UUID-like strings as credit cards', () => {
        const text = '550e8400-e29b-41d4-a716-446655440000'
        const cards = scanForPii(text).filter((m) => m.type === 'credit-card')
        expect(cards).toHaveLength(0)
      })

      it('should not flag IPv4 addresses', () => {
        const text = 'Connect to 10.0.0.1 and 172.16.0.1'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })
    })

    // --- Mixed content ---
    describe('mixed content with multiple PII types', () => {
      it('should detect email and phone in same text', () => {
        const text = 'Email: jane@example.com, Phone: 555-987-6543'
        const result = scanForPii(text)
        const types = result.map((m) => m.type)
        expect(types).toContain('email')
        expect(types).toContain('phone')
      })

      it('should detect SSN and credit card in same text', () => {
        const text = 'SSN: 123-45-6789, Card: 4111111111111111'
        const result = scanForPii(text)
        const types = result.map((m) => m.type)
        expect(types).toContain('ssn')
        expect(types).toContain('credit-card')
      })

      it('should detect all PII types in a single text', () => {
        const text = [
          'Name: John Doe',
          'Email: john@example.com',
          'Phone: (555) 123-4567',
          'SSN: 234-56-7890',
          'Card: 4111 1111 1111 1111',
          'Address: 123 Main St'
        ].join('\n')
        const result = scanForPii(text)
        const types = new Set(result.map((m) => m.type))
        expect(types).toContain('email')
        expect(types).toContain('phone')
        expect(types).toContain('ssn')
        expect(types).toContain('credit-card')
        expect(types).toContain('address')
      })

      it('should correctly report index positions', () => {
        const text = 'SSN: 123-45-6789'
        const result = scanForPii(text)
        expect(result).toHaveLength(1)
        expect(result[0].index).toBe(text.indexOf('123-45-6789'))
      })
    })

    // --- Performance ---
    describe('performance', () => {
      it('should handle large text without catastrophic backtracking', () => {
        const longText = 'Normal text without any PII. '.repeat(10000)
        const start = Date.now()
        const result = scanForPii(longText)
        const elapsed = Date.now() - start
        expect(result).toHaveLength(0)
        expect(elapsed).toBeLessThan(1000)
      })

      it('should handle text with special regex characters', () => {
        const text = 'some $pecial (chars) [brackets] {braces} + more | pipes ^carets'
        const result = scanForPii(text)
        expect(result).toHaveLength(0)
      })
    })
  })

  describe('hasPii', () => {
    it('should return false for clean text', () => {
      expect(hasPii('Just some normal text')).toBe(false)
    })

    it('should return true when email is present', () => {
      expect(hasPii('Contact john@example.com')).toBe(true)
    })

    it('should return true when SSN is present', () => {
      expect(hasPii('SSN is 123-45-6789')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(hasPii('')).toBe(false)
    })
  })

  describe('redactPii', () => {
    it('should return clean text unchanged', () => {
      expect(redactPii('Hello world')).toBe('Hello world')
    })

    it('should redact email addresses', () => {
      const result = redactPii('Email: john@example.com')
      expect(result).toContain('[EMAIL REDACTED]')
      expect(result).not.toContain('john@example.com')
    })

    it('should redact phone numbers', () => {
      const result = redactPii('Call 555-123-4567')
      expect(result).toContain('[PHONE REDACTED]')
      expect(result).not.toContain('555-123-4567')
    })

    it('should redact SSN', () => {
      const result = redactPii('SSN: 123-45-6789')
      expect(result).toContain('[SSN REDACTED]')
      expect(result).not.toContain('123-45-6789')
    })

    it('should redact credit card numbers', () => {
      const result = redactPii('Card: 4111111111111111')
      expect(result).toContain('[CREDIT-CARD REDACTED]')
      expect(result).not.toContain('4111111111111111')
    })

    it('should redact addresses', () => {
      const result = redactPii('Located at 123 Main St')
      expect(result).toContain('[ADDRESS REDACTED]')
      expect(result).not.toContain('123 Main St')
    })

    it('should redact multiple PII types in one text', () => {
      const result = redactPii('Email: john@example.com, SSN: 123-45-6789')
      expect(result).toContain('[EMAIL REDACTED]')
      expect(result).toContain('[SSN REDACTED]')
      expect(result).not.toContain('john@example.com')
      expect(result).not.toContain('123-45-6789')
    })

    it('should return empty string for empty input', () => {
      expect(redactPii('')).toBe('')
    })

    it('should preserve surrounding text when redacting', () => {
      const result = redactPii('Before 123-45-6789 After')
      expect(result).toBe('Before [SSN REDACTED] After')
    })
  })
})
