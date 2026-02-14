# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Standards

- Address the user as "Ovidiu"
- Present a plan and wait for "Go ahead" before non-trivial work
- Use TDD for features and bugfixes
- Never push to main without explicit confirmation
- Never commit secrets
- No sycophancy — push back when something is wrong
- Commit messages: no auto-generated signatures, write as a human

## Commands

```bash
pnpm install                    # Install dependencies (runs postinstall: electron-builder install-app-deps, prisma generate, copy-prisma)
pnpm dev                        # Development mode (electron-vite with hot reload)
pnpm test                       # Run tests in watch mode
pnpm test:run                   # Run tests once
pnpm test:coverage              # Run tests with v8 coverage (covers src/main/services/**)
vitest run tests/services/conversation.service.test.ts  # Run a single test file
pnpm db:migrate                 # Create/run Prisma migration (dev)
pnpm db:push                    # Push schema changes to SQLite (no migration file)
pnpm db:generate                # Regenerate Prisma client after schema changes
pnpm build:mac                  # Full macOS build (prebuild + electron-vite + postbuild + electron-builder)
pnpm build:win                  # Windows build
pnpm build:linux                # Linux build
```

The `postbuild` step runs `scripts/inject-prisma-bootstrap.js` which patches `out/main/index.js` with Prisma module resolution hooks for packaged ASAR builds.

## Architecture

Electron app with three process layers:

**Main process** (`src/main/`): Node.js — database, filesystem, shell, browser automation, IPC handlers.
**Preload** (`src/preload/`): Context bridge exposing `window.api` (typed IPC wrappers) and `window.electron` (raw electronAPI from `@electron-toolkit/preload`).
**Renderer** (`src/renderer/`): React 18 SPA — no router, single `AppShell` layout with conditional rendering.

### Main Process

Entry: `src/main/index.ts` → `initDatabase()` → `registerIpcHandlers()` → `createWindow()`

**IPC handlers** (`src/main/ipc/`): Each file registers `ipcMain.handle()` for a domain — `database.ipc.ts`, `file-system.ipc.ts`, `permissions.ipc.ts`, `settings.ipc.ts`, `browser.ipc.ts`, `skillregistry.ipc.ts`, `image.ipc.ts`, `export.ipc.ts`. All registered in `ipc/index.ts`.

**Services** (`src/main/services/`): Business logic layer consumed by IPC handlers. Each service takes a PrismaClient and operates on one domain. Tests exist for all services in `tests/services/`.

**Database** (`src/main/database.ts`): Initializes Prisma with SQLite. Dev uses `prisma/dev.db`, production uses `userData/open-cowork.db`. Pre-installs PDF/XLSX/DOCX/PPTX skills on first launch.

### Renderer

**AI orchestration lives in the renderer**, not main process:
- `hooks/useChat.ts` — Main chat loop: sends messages, streams AI responses, executes tools, handles context compaction
- `services/ai/openrouter.ts` — Creates OpenAI-compatible client pointing at OpenRouter, handles streaming with `streamText` from Vercel AI SDK
- `services/ai/tools.ts` — All AI tool definitions (filesystem, bash, browser, skills, TODO, image query). Tools call `window.api.*` for system operations
- `services/ai/system-prompt.ts` — Builds the system prompt with tool descriptions and enabled skill content
- `services/ai/imageQuery.ts` — Vision model queries using `anthropic/claude-3.5-sonnet:beta`

**State management:**
- Zustand stores (`stores/`): `uiStore` (sidebar, active conversation, model selection — persisted), `todoStore`, `browserStore`, `questionStore`, `attachmentStore`
- TanStack Query: server state for conversations, settings, skills (1 min stale time, 1 retry)

**UI components** use shadcn/ui (Radix primitives + Tailwind). Component source is in `src/renderer/components/ui/` (gitignored — regenerated from shadcn). Path aliases: `@/` and `@renderer/` both resolve to `src/renderer/`.

### Data Flow

1. User sends message → `useChat.sendMessage()` saves to DB, builds history, calls `streamChat()`
2. AI streams response with tool requests → tool functions execute (some local state, some via IPC to main)
3. Browser tools → IPC to main → Playwright with persistent context → screenshots saved to image registry
4. Tool results returned to AI for next step (multi-step agent loop)
5. Final assistant message + tool calls saved to DB

### Database Schema

Prisma + SQLite (`prisma/schema.prisma`). Key models: `Conversation` → has many `Message` → has many `ToolCall`. Also: `Skill` (marketplace skills with content), `Permission` (path+operation grants), `Settings` (singleton, id="default"), `Image` (filesystem-backed, per-conversation sequence numbers).

### Testing

Vitest with node environment. Tests in `tests/` — currently only main process service tests and one IPC test. No renderer or E2E tests. Test DB helper (`tests/helpers/test-db.ts`) creates isolated SQLite in temp dirs using `prisma db push`. Coverage targets `src/main/services/**/*.ts`.

## Gotchas

- `window.electron.ipcRenderer.invoke()` can reach ANY IPC handler — the curated `window.api` is security theater while raw ipcRenderer is exposed
- Permission service (`src/main/services/permission.service.ts`) is fully implemented but never wired into any IPC handler
- Auto-update URL in `electron-builder.yml` is `example.com` — placeholder, do not ship
- Dual lockfiles exist: `pnpm-lock.yaml` + `package-lock.json` — use pnpm only
- `electron-builder` 24.x has CVE-2024-27303 (ASAR integrity bypass)
- Sandbox is disabled (`sandbox: false` in `src/main/index.ts:17`)
- `shell:execute` in `settings.ipc.ts` has zero safety checks — arbitrary command execution
- Bash blocklist in `file-system.ipc.ts` is regex-based and fundamentally bypassable
- Both shell endpoints use `exec()` (full shell) instead of `execFile()`/`spawn()`
- Skills from skillregistry.io are injected raw into the system prompt — no signing or sanitization
- Playwright is bundled as a production dependency (400+ transitive deps)
- The `@/` path alias means different things in different TS configs: `src/renderer/` in web, `src/` in vitest
- `src/renderer/components/ui/` is gitignored (shadcn/ui generated components)

## Repository

- **Fork (push access):** `git@github.com:eovidiu/Open-CoWork.git`
- **Upstream:** `git@github.com:Autonoma-Labs/Open-CoWork.git`
- Security analysis files may exist in `analysis/` (gitignored)
- 14 `fix/*` branches exist from a security remediation effort — see `HANDOFF.md` for full list
- CI runs tests on PRs to main/master (`.github/workflows/test.yml` — Ubuntu, Node 20)
