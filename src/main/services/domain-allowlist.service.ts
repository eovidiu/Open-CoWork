const DEFAULT_PERMANENT_DOMAINS = [
  'google.com',
  'github.com',
  'stackoverflow.com',
  'python.org',
  'mozilla.org',
  'npmjs.com'
]

export class DomainAllowlistService {
  private permanentAllowlist: Set<string>
  private sessionAllowlist: Set<string>

  constructor() {
    this.permanentAllowlist = new Set(DEFAULT_PERMANENT_DOMAINS)
    this.sessionAllowlist = new Set()
  }

  /**
   * Check if a domain (extracted from the given URL) is allowed
   * in either the permanent or session allowlist.
   * Supports subdomain matching: api.github.com matches github.com.
   */
  isDomainAllowed(url: string): boolean {
    const domain = DomainAllowlistService.extractDomain(url)
    return this.isDomainInSet(domain, this.permanentAllowlist) ||
           this.isDomainInSet(domain, this.sessionAllowlist)
  }

  /** Add domain to session allowlist (cleared on conversation switch) */
  allowForSession(domain: string): void {
    this.sessionAllowlist.add(domain.toLowerCase())
  }

  /** Add domain to permanent allowlist */
  allowPermanently(domain: string): void {
    this.permanentAllowlist.add(domain.toLowerCase())
  }

  /** Remove domain from permanent allowlist */
  removePermanent(domain: string): void {
    this.permanentAllowlist.delete(domain.toLowerCase())
  }

  /** Clear session allowlist (called on conversation switch) */
  clearSession(): void {
    this.sessionAllowlist.clear()
  }

  /** Get all allowed domains for display */
  getAllowedDomains(): { permanent: string[]; session: string[] } {
    return {
      permanent: Array.from(this.permanentAllowlist),
      session: Array.from(this.sessionAllowlist)
    }
  }

  /** Extract the hostname from a URL, lowercased */
  static extractDomain(url: string): string {
    const parsed = new URL(url)
    return parsed.hostname.toLowerCase()
  }

  /**
   * Check if a domain matches any entry in the given set.
   * Matches exactly or as a subdomain (domain ends with .allowedDomain).
   */
  private isDomainInSet(domain: string, allowedSet: Set<string>): boolean {
    for (const allowed of allowedSet) {
      if (domain === allowed || domain.endsWith('.' + allowed)) {
        return true
      }
    }
    return false
  }
}

// Module-level singleton for use across IPC handlers
export let domainAllowlistService: DomainAllowlistService

export function initDomainAllowlist(): void {
  domainAllowlistService = new DomainAllowlistService()
}
