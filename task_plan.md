# Task Plan: F019 - Structured Audit Logging Service

## Goal
Implement a file-based structured audit logging service with hash-chain tamper detection, wire it into high-risk IPC handlers, and remove the agent's ability to modify ToolCall records.

## Phases
- [x] Phase 1: Create `tests/services/audit-log.test.ts` (TDD - tests first) -- 16 tests, all pass
- [x] Phase 2: Create `src/main/services/audit-log.service.ts` -- implemented
- [x] Phase 3: Wire audit logging into IPC handlers (fs:bash, fs:writeFile, browser:navigate, browser:openForLogin, permissions grant/revoke)
- [SKIP] Phase 4: Remove `db:toolCalls:update` -- skipped per Ovidiu's instruction
- [x] Phase 5: Initialize audit log in main process startup
- [x] Phase 6: Run all tests and verify -- 877 tests pass across 27 files

## Key Decisions
- Audit log is file-based JSONL, NOT in Prisma/SQLite
- Synchronous writes (appendFileSync) to avoid crash data loss
- SHA-256 hash chain for tamper detection
- Log directory: `{userData}/audit/`
- `db:toolCalls:update` is defined in preload + type declarations but never actually called from renderer code, so removal is safe

## Files to Create
1. `src/main/services/audit-log.service.ts` - The service
2. `tests/services/audit-log.test.ts` - Tests

## Files to Modify
1. `src/main/ipc/file-system.ipc.ts` - Add audit logging to fs:bash and fs:writeFile
2. `src/main/ipc/browser.ipc.ts` - Add audit logging to browser:navigate and browser:openForLogin
3. `src/main/ipc/permissions.ipc.ts` - Add audit logging to permissions:grant and permissions:revoke
4. `src/main/ipc/database.ipc.ts` - Remove db:toolCalls:update handler
5. `src/main/index.ts` - Initialize audit log on startup
6. `src/preload/index.ts` - Remove updateToolCall from preload API
7. `src/preload/index.d.ts` - Remove updateToolCall from type declaration
8. `src/renderer/env.d.ts` - Remove updateToolCall from renderer types

## Status
**COMPLETE** - All phases done, all 877 tests pass
