# Task Plan: F016 - Remove 'unsafe-inline' from style-src in CSP

## Goal
Remove `'unsafe-inline'` from the `style-src` directive in the Content Security Policy, or implement a nonce-based approach if inline styles cannot be eliminated.

## Phases
- [x] Phase 1: Audit inline style usage in renderer
- [x] Phase 2: Determine approach (A, B, or C)
- [x] Phase 3: Implement the chosen approach
- [x] Phase 4: Test and verify
- [x] Phase 5: Report findings

## Key Questions
1. How many inline styles exist in JSX components? → 6 locations (3 fontFamily, 2 virtualizer, 1 textarea resize)
2. Do Radix UI / shadcn components inject dynamic inline styles? → Yes, but via JS (element.style) which is script-src, not style-src
3. Can all inline styles be converted to Tailwind classes? → fontFamily ones yes; virtualizer ones use dynamic values but are JS-applied (not affected by style-src)
4. Is a nonce-based approach needed? → No. CSP style-src only controls <style> elements and HTML style attributes, not JS-applied styles

## Decisions Made
- Moved CSP from HTML meta tag to main process HTTP headers via onHeadersReceived (authoritative control)
- In production: 'unsafe-inline' removed from style-src (CSS extracted to files by Vite)
- In development: 'unsafe-inline' kept for style-src (Vite HMR injects <style> tags)
- Created separate csp.ts module to keep index.ts clean and allow independent testing
- Added "Space Mono" to Tailwind mono font family, replaced 3 inline fontFamily styles with font-mono class
- Virtualizer and textarea inline styles left as-is (they use JS element.style, not affected by style-src)

## Errors Encountered
- main-window-security.test.ts mock lacked onHeadersReceived → added typeof guard in csp.ts

## Status
**Complete** — All phases done. Not committed per instructions.
