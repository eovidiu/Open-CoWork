# Context Summary

## Active Context
- Currently working on: All implementable features complete (22/26). F022 (PII scanner) and F025 (domain allowlist) just completed.
- Blocking issues: F007 (code signing — needs certificates from Ovidiu)
- Remaining: F007 (blocked), F018 (SQLCipher — deferred, risky), F020 (skill signatures — deferred, complex), F026 (behavioral drift — deferred, complex)
- Test baseline: 987 tests across 29 test files

## Cross-Cutting Concerns
- This is an Electron app that executes shell commands and accesses the file system on behalf of an AI — security is the dominant concern
- Specification completeness is ~25% — most behavior is implicit in code
- No tests exist for renderer, E2E, or security paths
- **23 unique security FAIL findings** remaining (42 from analysis minus 19 resolved)
- 987 tests passing across 29 test files (up from 605 at baseline)

## Domain: Open CoWork

### Decisions
- Created project curator analysis in `analysis/` folder (2026-02-10)
- Created `open-cowork-security-auditor` skill tailored to this codebase (2026-02-10)
- Ran 7-dimension general security analysis with parallel agents (2026-02-11)
- Re-ran full 6-dimension analysis with general-security-analyzer skill (2026-02-14)

### Patterns
- Skill structure: SKILL.md + references/ directory with detailed checklists
- Curator output: numbered documents (01-06) with README index
- Security analysis: parallel agents per dimension, orchestrator deduplicates and consolidates

### Current Security Posture (2026-02-14)

**What was fixed (13 items from 2026-02-11 baseline):**
- shell:execute removed, raw ipcRenderer removed, sandbox enabled, IPC sender validation added
- will-navigate handler, DevTools disabled in prod, CSP script-src cleaned
- exec() → spawn(), path validation added, browser URL validation + ephemeral contexts
- Skill content sanitization added, API key uses safeStorage

**Remediated this session (5 items):**
1. ~~Bash allowlist includes interpreters~~ → F001: Removed 13 interpreters + added argument-level validation
6. ~~XSS: no rehype-sanitize~~ → F006: rehype-sanitize v6.0.0 with GitHub schema
- ~~fs:exists bypasses validatePath~~ → F012: validatePath added to fs:exists, glob CWD, bash CWD
- ~~Permission service never wired~~ → F004: Shared singleton, checks on 9 IPC handlers, 14 enforcement tests
- ~~getApiKey returns full key to renderer~~ → F005: Handler removed, webRequest injects key at network level
- ~~No HITL approval gates~~ → F002: approvalStore + ToolApprovalDialog, 7 tools wrapped with executeWithApproval

- ~~Electron Fuses unconfigured~~ → F003: afterPack hook flips 6 fuses, verified with macOS build

**Top remaining issues (see full report):**
1. No code signing or notarization — critical (F007, blocked on certs)
2. No credential detection/redaction in tool outputs — high (F009)
3. ~~No audit logging~~ — F019: AuditLogService with SHA-256 hash chain, JSONL file, wired into fs:bash, fs:writeFile, browser:navigate, browser:openForLogin, permissions:grant, permissions:revoke
4. ~~No privacy policy~~ — F008: PrivacyNotice (blocking first-launch) + PrivacyPolicy (Settings) implemented

### Gotchas
- CLAUDE.md now exists in the repo (was missing at 2026-02-10)
- Auto-update URL in electron-builder.yml is a placeholder (example.com) — do not ship
- HITL approval gates are renderer-only — IPC bypass possible (architectural, accepted for now)
- electron-builder 24.x has CVE-2024-27303 (ASAR integrity bypass)
- electron-updater 6.1.7 has CVE-2024-39698 (< 6.3.0)

### Remediation Priorities (Updated 2026-02-14)
**P0 — Before any distribution:**
1. Remove interpreters from bash allowlist
2. Wire HITL approval gates for DANGEROUS/MODERATE tools
3. Configure Electron Fuses
4. Wire PermissionService into handlers
5. Remove getApiKey from preload
6. Add rehype-sanitize
7. Code signing + notarization

**P1 — Before public release:**
8. ~~Privacy policy/data processing notice~~ → F008: PrivacyNotice + PrivacyPolicy components, privacyAccepted in Settings DB
9. Credential pattern scanner on outputs
10. ~~Process group kill on stop~~ → F010: ProcessTracker service + IPC handler + preload wiring
11. ~~File content injection sanitization~~ → F011: injection-scanner.ts service, 73 tests, wired into fs:readFile
12. Fix fs:exists to use validatePath
13. Update electron-updater >= 6.3.0
14. Add pnpm audit to CI
15. Runtime IPC argument validation (Zod)
16. ~~Remove unsafe-inline from style-src~~ → F016: CSP moved to main process HTTP headers, 'unsafe-inline' removed in production
17. Workspace boundary for file ops

**P2 — Medium-term:**
18-26. SQLCipher, audit logging, skill signatures, SBOM, PII detection, Playwright optional dep, etc.

### Privacy & Compliance (Dimension 4, 2026-02-14)
- 10 FAIL, 15 PARTIAL, 7 PASS, 29 N/A out of 61 findings
- Biggest gaps: no privacy policy, no PII minimization, unencrypted SQLite
- Full report: `analysis/04-privacy-compliance-audit.md`

### Electron Platform Security (Dimension 5, 2026-02-14)
- 18 FAIL, 10 PARTIAL, 27 PASS, 13 N/A out of 68 findings
- Full report: `analysis/electron-security-audit-2026-02-14.md`

## Closed Work Streams
- Project curation: completed 2026-02-10
- Security auditor skill: completed 2026-02-10
- First full security audit: completed 2026-02-10, report at analysis/security-audit-2026-02-10.md
- General 7-dimension security analysis: completed 2026-02-11, report at analysis/general-security-analysis-2026-02-11.md
- Privacy & Compliance audit (Dim 4): completed 2026-02-14, report at analysis/04-privacy-compliance-audit.md
- Electron platform audit (Dim 5): completed 2026-02-14, report at analysis/electron-security-audit-2026-02-14.md
- Full 6-dimension re-analysis: completed 2026-02-14, report at analysis/general-security-analysis-2026-02-14.md
