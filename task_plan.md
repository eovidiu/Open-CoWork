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
**Currently in Phase 7** — Planning F002 (HITL approval gates)

---

## F002 Implementation Plan: HITL Approval Gates

### Problem
`DANGEROUS_TOOLS` and `MODERATE_TOOLS` are defined in `tools.ts:10-11` but never enforced. The AI can execute bash commands, navigate browsers, install skills, and type into pages without user consent.

### Architecture

**Key constraint:** The Vercel AI SDK's `streamText()` calls `tool.execute()` internally — there's no pre-execution hook. The approval gate must live INSIDE each tool's `execute()` function.

**Approach:** Promise-based blocking pattern (similar to existing `QuestionStore` / `QuestionSlider`).

1. **`approvalStore.ts`** — Zustand store for pending tool approvals
   - State: `pendingApproval: { id, toolName, args, tier, resolve, reject } | null`
   - Actions: `requestApproval(toolName, args, tier) → Promise<boolean>`, `approve(id)`, `deny(id)`, `approveAll(tier)`
   - The `requestApproval` call creates a Promise that blocks the tool's `execute()` until the user clicks Approve/Deny
   - Optional "Allow all [tier] tools for this session" toggle

2. **`ToolApprovalDialog.tsx`** — Renders when `pendingApproval` is non-null
   - Shows: tool name, risk tier badge, human-readable args summary
   - Buttons: "Approve", "Deny", "Allow all [DANGEROUS/MODERATE] for this session"
   - Rendered in ChatArea.tsx alongside QuestionSlider

3. **`executeWithApproval(toolName, args, execute)` wrapper** — in tools.ts
   - Checks if tool is DANGEROUS or MODERATE
   - If yes and no session-wide allowance, calls `approvalStore.requestApproval()` (blocks)
   - If approved (or session-allowance exists), calls original `execute(args)`
   - If denied, returns `{ error: true, message: 'User denied permission for [tool]' }`

4. **Wire into tools** — Wrap `execute` for these 7 tools:
   - DANGEROUS (5): `bash`, `browserNavigate`, `browserType`, `installSkill`, `requestLogin`
   - MODERATE (2): `browserClick`, `browserPress`
   - Note: `writeFile` is in MODERATE_TOOLS but doesn't exist as an actual tool — skip it

### Files to Create
| File | Purpose |
|------|---------|
| `src/renderer/stores/approvalStore.ts` | Approval state management |
| `src/renderer/components/chat/ToolApprovalDialog.tsx` | Approval UI |
| `tests/renderer/tool-approval.test.ts` | Approval gate tests |

### Files to Modify
| File | Change |
|------|--------|
| `src/renderer/services/ai/tools.ts` | Add `executeWithApproval` wrapper, wrap 7 tool execute functions |
| `src/renderer/components/chat/ChatArea.tsx` | Render ToolApprovalDialog |

### Phases
- [ ] Phase 7a: Create `approvalStore.ts` with blocking Promise pattern
- [ ] Phase 7b: Create `ToolApprovalDialog.tsx` component
- [ ] Phase 7c: Create `executeWithApproval` wrapper + wire into 7 tools in tools.ts
- [ ] Phase 7d: Render `ToolApprovalDialog` in ChatArea.tsx
- [ ] Phase 7e: Write tests for approval gate enforcement
- [ ] Phase 7f: Security verification (run security analyzer)

### Risk Assessment
- **Medium risk**: touches the hot path of tool execution — bugs could freeze the chat loop
- **Mitigation**: timeout on approval (auto-deny after 60s of no user action)
- **Testing**: primarily store-level unit tests + manual verification since renderer tests don't exist
