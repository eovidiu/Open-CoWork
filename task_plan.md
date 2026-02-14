# Task Plan: P0 Security Remediation

## Goal
Implement all 7 P0 security remediation features from the 2026-02-14 consolidated analysis.

## Phases
- [x] Phase 1: Fix pre-existing test failures (8 tests, macOS compat)
- [x] Phase 2: Implement F001 (bash allowlist), F006 (rehype-sanitize), F012 (fs:exists) in parallel
- [x] Phase 3: Security verification + hardening of F001/F012 based on auditor findings
- [x] Phase 4: Implement F005 (remove getApiKey from preload)
- [x] Phase 5: Implement F004 (wire PermissionService into handlers)
- [x] Phase 6: Security verification + hardening of F004/F005 (5 bypass fixes)
- [ ] Phase 7: Implement F002 (HITL approval gates)
- [ ] Phase 8: Implement F003 (Electron Fuses) — needs build infrastructure
- [ ] Phase 9: Implement F007 (code signing) — needs certificates from Ovidiu

## Progress
| Feature | Status | Tests | Commit |
|---------|--------|-------|--------|
| F001 | DONE | 142 shell tests | e705f05, 9dbb026 |
| F006 | DONE | Verified by auditor | e705f05 |
| F012 | DONE | 1 new + CWD fixes | e705f05, 9dbb026 |
| F005 | DONE | 4 test files updated | 239754f |
| F004 | DONE | 14 enforcement tests | 239754f |
| F002 | Pending | — | — |
| F003 | Pending | — | — |
| F007 | BLOCKED (certs) | — | — |

## Status
**Currently in Phase 7** — Ready to implement F002 (HITL approval gates)
