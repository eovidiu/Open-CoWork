# Task Plan: F003 — Configure Electron Fuses

## Goal
Flip Electron fuses on the packaged binary to disable dangerous capabilities (RunAsNode, NodeOptions, CLI inspect) and enable ASAR-only loading.

## Phases
- [ ] Phase 1: Install `@electron/fuses` as devDependency
- [ ] Phase 2: Create `scripts/set-electron-fuses.js` afterPack script
- [ ] Phase 3: Wire afterPack into electron-builder.yml
- [ ] Phase 4: Add build-time test that verifies fuses are set
- [ ] Phase 5: Test on macOS build, verify, commit

## Implementation Details

### Fuses to set (FuseV1Options):
| Fuse | Value | Why |
|------|-------|-----|
| RunAsNode | false | Prevents ELECTRON_RUN_AS_NODE TCC bypass on macOS |
| EnableNodeOptionsEnvironmentVariable | false | Prevents NODE_OPTIONS injection |
| EnableNodeCliInspectArguments | false | Prevents --inspect debugging in prod |
| OnlyLoadAppFromAsar | true | Prevents loading code outside ASAR |
| EnableEmbeddedAsarIntegrityValidation | true | Validates ASAR integrity at runtime |
| GrantFileProtocolExtraPrivileges | false | Removes extra file:// privileges |

### Script approach:
- electron-builder `afterPack` hook receives `context` with `appOutDir` and `packager`
- Script resolves the Electron binary path from `appOutDir`
- Calls `flipFuses()` with the binary path and fuse settings
- Platform-aware binary path resolution:
  - macOS: `${appOutDir}/${productName}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`
  - Actually, `flipFuses` accepts the app path directly (e.g., `Foo.app`) and handles framework resolution
  - Windows: `${appOutDir}/${productName}.exe`
  - Linux: `${appOutDir}/${productName}`

### Constraint — OnlyLoadAppFromAsar:
- The app uses `asarUnpack` for Prisma and better-sqlite3 native modules
- `OnlyLoadAppFromAsar` means app **code** loads from ASAR only
- Native modules in `app.asar.unpacked` are still accessible via Node's module system
- This should be fine — the fuse only affects the initial app code load path

### Constraint — EnableEmbeddedAsarIntegrityValidation:
- Requires electron-builder to generate integrity hashes
- electron-builder 24.x supports this via the `asar` config with `integrity` option
- May need `electronDist` configuration — will test and verify

## Key Questions
1. Does `OnlyLoadAppFromAsar` break Prisma's unpacked native modules? → Should be safe, unpacked modules are still loadable
2. Does ASAR integrity work with electron-builder 24.x? → May need to skip if it requires newer builder

## Decisions Made
- (pending)

## Errors Encountered
- (none yet)

## Status
**Currently in Phase 1** — Plan created, awaiting approval
