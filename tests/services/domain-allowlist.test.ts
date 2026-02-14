import { describe, it, expect, beforeEach } from 'vitest'
import { DomainAllowlistService } from '../../src/main/services/domain-allowlist.service'

describe('DomainAllowlistService', () => {
  let service: DomainAllowlistService

  beforeEach(() => {
    service = new DomainAllowlistService()
  })

  describe('extractDomain', () => {
    it('should extract domain from a simple URL', () => {
      expect(DomainAllowlistService.extractDomain('https://example.com')).toBe('example.com')
    })

    it('should extract domain from a URL with path', () => {
      expect(DomainAllowlistService.extractDomain('https://example.com/path/to/page')).toBe(
        'example.com'
      )
    })

    it('should extract domain from a URL with port', () => {
      expect(DomainAllowlistService.extractDomain('https://example.com:8080/path')).toBe(
        'example.com'
      )
    })

    it('should extract domain from a URL with query string', () => {
      expect(DomainAllowlistService.extractDomain('https://example.com?q=test')).toBe(
        'example.com'
      )
    })

    it('should extract domain from a URL with subdomain', () => {
      expect(DomainAllowlistService.extractDomain('https://api.github.com/repos')).toBe(
        'api.github.com'
      )
    })

    it('should extract domain from http URL', () => {
      expect(DomainAllowlistService.extractDomain('http://example.com')).toBe('example.com')
    })

    it('should normalize domain to lowercase', () => {
      expect(DomainAllowlistService.extractDomain('https://EXAMPLE.COM')).toBe('example.com')
    })

    it('should throw for invalid URLs', () => {
      expect(() => DomainAllowlistService.extractDomain('not-a-url')).toThrow()
    })

    it('should throw for empty string', () => {
      expect(() => DomainAllowlistService.extractDomain('')).toThrow()
    })

    it('should extract domain from URL with fragment', () => {
      expect(DomainAllowlistService.extractDomain('https://example.com/page#section')).toBe(
        'example.com'
      )
    })

    it('should extract domain from URL with auth info', () => {
      expect(DomainAllowlistService.extractDomain('https://user:pass@example.com/path')).toBe(
        'example.com'
      )
    })
  })

  describe('default permanent allowlist', () => {
    it('should include google.com by default', () => {
      expect(service.isDomainAllowed('https://google.com')).toBe(true)
    })

    it('should include github.com by default', () => {
      expect(service.isDomainAllowed('https://github.com')).toBe(true)
    })

    it('should include stackoverflow.com by default', () => {
      expect(service.isDomainAllowed('https://stackoverflow.com')).toBe(true)
    })

    it('should include docs.python.org by default (subdomain of python.org)', () => {
      expect(service.isDomainAllowed('https://docs.python.org/3/library')).toBe(true)
    })

    it('should include developer.mozilla.org by default (subdomain of mozilla.org)', () => {
      expect(service.isDomainAllowed('https://developer.mozilla.org/en-US/docs')).toBe(true)
    })

    it('should include npmjs.com by default', () => {
      expect(service.isDomainAllowed('https://npmjs.com/package/express')).toBe(true)
    })

    it('should not allow an unknown domain by default', () => {
      expect(service.isDomainAllowed('https://malicious-site.example')).toBe(false)
    })
  })

  describe('isDomainAllowed - exact matching', () => {
    it('should allow an exact match on permanent allowlist', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://example.com')).toBe(true)
    })

    it('should allow an exact match on session allowlist', () => {
      service.allowForSession('example.com')
      expect(service.isDomainAllowed('https://example.com/page')).toBe(true)
    })

    it('should reject a domain not in any allowlist', () => {
      expect(service.isDomainAllowed('https://evil.com')).toBe(false)
    })
  })

  describe('isDomainAllowed - subdomain matching', () => {
    it('should allow subdomains of a permanently allowed domain', () => {
      service.allowPermanently('github.com')
      expect(service.isDomainAllowed('https://api.github.com/repos')).toBe(true)
    })

    it('should allow subdomains of a session-allowed domain', () => {
      service.allowForSession('example.com')
      expect(service.isDomainAllowed('https://www.example.com')).toBe(true)
    })

    it('should allow deeply nested subdomains', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://a.b.c.example.com')).toBe(true)
    })

    it('should not match partial domain names (notexample.com vs example.com)', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://notexample.com')).toBe(false)
    })

    it('should not match if allowed domain is a subdomain and URL is parent', () => {
      service.allowPermanently('api.example.com')
      expect(service.isDomainAllowed('https://example.com')).toBe(false)
    })
  })

  describe('isDomainAllowed - case insensitivity', () => {
    it('should match case-insensitively when domain was added in lowercase', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://EXAMPLE.COM')).toBe(true)
    })

    it('should match case-insensitively when domain was added in uppercase', () => {
      service.allowPermanently('EXAMPLE.COM')
      expect(service.isDomainAllowed('https://example.com')).toBe(true)
    })

    it('should match case-insensitively for subdomains', () => {
      service.allowPermanently('GitHub.com')
      expect(service.isDomainAllowed('https://API.GITHUB.COM/repos')).toBe(true)
    })
  })

  describe('allowForSession', () => {
    it('should add a domain to the session allowlist', () => {
      service.allowForSession('session-only.com')

      const domains = service.getAllowedDomains()
      expect(domains.session).toContain('session-only.com')
    })

    it('should normalize domain to lowercase', () => {
      service.allowForSession('SESSION.COM')

      const domains = service.getAllowedDomains()
      expect(domains.session).toContain('session.com')
    })
  })

  describe('allowPermanently', () => {
    it('should add a domain to the permanent allowlist', () => {
      service.allowPermanently('new-permanent.com')

      const domains = service.getAllowedDomains()
      expect(domains.permanent).toContain('new-permanent.com')
    })

    it('should normalize domain to lowercase', () => {
      service.allowPermanently('PERMANENT.COM')

      const domains = service.getAllowedDomains()
      expect(domains.permanent).toContain('permanent.com')
    })

    it('should not add duplicates', () => {
      service.allowPermanently('example.com')
      service.allowPermanently('example.com')

      const domains = service.getAllowedDomains()
      const count = domains.permanent.filter((d) => d === 'example.com').length
      // Sets inherently prevent duplicates, but verify through the getter
      expect(count).toBeLessThanOrEqual(1)
    })
  })

  describe('removePermanent', () => {
    it('should remove a domain from the permanent allowlist', () => {
      service.allowPermanently('to-remove.com')
      service.removePermanent('to-remove.com')

      expect(service.isDomainAllowed('https://to-remove.com')).toBe(false)
    })

    it('should handle case-insensitive removal', () => {
      service.allowPermanently('to-remove.com')
      service.removePermanent('TO-REMOVE.COM')

      expect(service.isDomainAllowed('https://to-remove.com')).toBe(false)
    })

    it('should not throw when removing a non-existent domain', () => {
      expect(() => service.removePermanent('nonexistent.com')).not.toThrow()
    })

    it('should not affect session allowlist', () => {
      service.allowForSession('both.com')
      service.allowPermanently('both.com')

      service.removePermanent('both.com')

      // Should still be allowed via session
      expect(service.isDomainAllowed('https://both.com')).toBe(true)
    })
  })

  describe('clearSession', () => {
    it('should clear all session domains', () => {
      service.allowForSession('session1.com')
      service.allowForSession('session2.com')

      service.clearSession()

      const domains = service.getAllowedDomains()
      expect(domains.session).toHaveLength(0)
    })

    it('should not clear permanent domains', () => {
      service.allowPermanently('permanent.com')
      service.allowForSession('session.com')

      service.clearSession()

      const domains = service.getAllowedDomains()
      expect(domains.permanent).toContain('permanent.com')
      expect(domains.session).not.toContain('session.com')
    })

    it('should not affect default permanent domains', () => {
      service.clearSession()

      // Default domains should still be present
      expect(service.isDomainAllowed('https://github.com')).toBe(true)
      expect(service.isDomainAllowed('https://google.com')).toBe(true)
    })
  })

  describe('getAllowedDomains', () => {
    it('should return both permanent and session domains', () => {
      service.allowPermanently('perm.com')
      service.allowForSession('sess.com')

      const domains = service.getAllowedDomains()

      expect(domains.permanent).toContain('perm.com')
      expect(domains.session).toContain('sess.com')
    })

    it('should return default domains in permanent list', () => {
      const domains = service.getAllowedDomains()

      expect(domains.permanent).toContain('google.com')
      expect(domains.permanent).toContain('github.com')
      expect(domains.permanent).toContain('stackoverflow.com')
    })

    it('should return empty session list initially', () => {
      const domains = service.getAllowedDomains()
      expect(domains.session).toHaveLength(0)
    })

    it('should return arrays (not sets)', () => {
      const domains = service.getAllowedDomains()
      expect(Array.isArray(domains.permanent)).toBe(true)
      expect(Array.isArray(domains.session)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle URL with trailing slash', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://example.com/')).toBe(true)
    })

    it('should handle URL with www prefix when base domain is allowed', () => {
      service.allowPermanently('example.com')
      expect(service.isDomainAllowed('https://www.example.com')).toBe(true)
    })

    it('should handle domain that is a suffix of another (e.g., com vs example.com)', () => {
      service.allowPermanently('example.com')
      // "com" alone should not match
      expect(service.isDomainAllowed('https://com')).toBe(false)
    })

    it('should throw for invalid URL in isDomainAllowed', () => {
      expect(() => service.isDomainAllowed('not-a-url')).toThrow()
    })

    it('should handle localhost', () => {
      service.allowForSession('localhost')
      expect(service.isDomainAllowed('http://localhost:3000')).toBe(true)
    })

    it('should handle IP addresses', () => {
      service.allowForSession('192.168.1.1')
      expect(service.isDomainAllowed('http://192.168.1.1:8080')).toBe(true)
    })
  })
})
