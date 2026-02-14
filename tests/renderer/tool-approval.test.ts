import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock zustand's create to produce a real-ish store
// We import the actual store after setting up the environment
vi.mock('zustand', async () => {
  const actualZustand = await vi.importActual('zustand')
  return actualZustand
})

import { useApprovalStore } from '../../src/renderer/stores/approvalStore'
import type { ToolTier } from '../../src/renderer/stores/approvalStore'

describe('ApprovalStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useApprovalStore.setState({
      pendingApproval: null,
      sessionAllowances: new Set<ToolTier>()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('requestApproval', () => {
    it('creates a pending approval and blocks until resolved', async () => {
      const store = useApprovalStore.getState()

      // Start the request (will block)
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      // Verify pending approval was created
      const state = useApprovalStore.getState()
      expect(state.pendingApproval).not.toBeNull()
      expect(state.pendingApproval!.toolName).toBe('bash')
      expect(state.pendingApproval!.args).toEqual({ command: 'ls' })
      expect(state.pendingApproval!.tier).toBe('dangerous')

      // Resolve it via approve
      useApprovalStore.getState().approve(state.pendingApproval!.id)

      const result = await approvalPromise
      expect(result).toBe(true)
    })
  })

  describe('approve', () => {
    it('resolves the pending promise with true and clears pendingApproval', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      const pending = useApprovalStore.getState().pendingApproval!
      useApprovalStore.getState().approve(pending.id)

      const result = await approvalPromise
      expect(result).toBe(true)
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
    })

    it('does nothing if id does not match', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      const pending = useApprovalStore.getState().pendingApproval!
      useApprovalStore.getState().approve('wrong-id')

      // pendingApproval should still exist
      expect(useApprovalStore.getState().pendingApproval).not.toBeNull()
      expect(useApprovalStore.getState().pendingApproval!.id).toBe(pending.id)

      // Clean up: deny so the test doesn't hang
      useApprovalStore.getState().deny(pending.id)
      await approvalPromise
    })
  })

  describe('deny', () => {
    it('resolves the pending promise with false and clears pendingApproval', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'rm -rf /' }, 'dangerous')

      const pending = useApprovalStore.getState().pendingApproval!
      useApprovalStore.getState().deny(pending.id)

      const result = await approvalPromise
      expect(result).toBe(false)
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
    })

    it('does nothing if id does not match', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      const pending = useApprovalStore.getState().pendingApproval!
      useApprovalStore.getState().deny('wrong-id')

      expect(useApprovalStore.getState().pendingApproval).not.toBeNull()

      // Clean up
      useApprovalStore.getState().deny(pending.id)
      await approvalPromise
    })
  })

  describe('allowAllForSession', () => {
    it('adds the tier to sessionAllowances and resolves current pending with true', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      useApprovalStore.getState().allowAllForSession('dangerous')

      const result = await approvalPromise
      expect(result).toBe(true)
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
      expect(useApprovalStore.getState().sessionAllowances.has('dangerous')).toBe(true)
    })

    it('adds tier even when no pending approval exists', () => {
      useApprovalStore.getState().allowAllForSession('moderate')
      expect(useApprovalStore.getState().sessionAllowances.has('moderate')).toBe(true)
    })

    it('does not resolve pending approval of a different tier', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      useApprovalStore.getState().allowAllForSession('moderate')

      // Pending should still exist (it's dangerous, we allowed moderate)
      const pending = useApprovalStore.getState().pendingApproval!
      expect(pending).not.toBeNull()

      // Clean up
      useApprovalStore.getState().deny(pending.id)
      await approvalPromise
    })
  })

  describe('session allowance causes immediate approval', () => {
    it('resolves immediately with true when tier is in sessionAllowances', async () => {
      // First allow dangerous tools for the session
      useApprovalStore.getState().allowAllForSession('dangerous')

      // Now request approval - should resolve immediately
      const result = await useApprovalStore.getState().requestApproval(
        'bash',
        { command: 'echo hello' },
        'dangerous'
      )

      expect(result).toBe(true)
      // No pending approval should have been created
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
    })

    it('does not auto-approve a different tier', async () => {
      useApprovalStore.getState().allowAllForSession('moderate')

      // Request for dangerous tier - should block
      const approvalPromise = useApprovalStore.getState().requestApproval(
        'bash',
        { command: 'ls' },
        'dangerous'
      )

      const pending = useApprovalStore.getState().pendingApproval!
      expect(pending).not.toBeNull()

      // Clean up
      useApprovalStore.getState().deny(pending.id)
      await approvalPromise
    })
  })

  describe('auto-deny after timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('auto-denies after 60 seconds', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      expect(useApprovalStore.getState().pendingApproval).not.toBeNull()

      // Advance time by 60 seconds
      vi.advanceTimersByTime(60_000)

      const result = await approvalPromise
      expect(result).toBe(false)
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
    })

    it('does not auto-deny if approved before timeout', async () => {
      const store = useApprovalStore.getState()
      const approvalPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')

      // Advance time partially
      vi.advanceTimersByTime(30_000)

      // Approve before timeout
      const pending = useApprovalStore.getState().pendingApproval!
      useApprovalStore.getState().approve(pending.id)

      const result = await approvalPromise
      expect(result).toBe(true)

      // Advance past timeout - should not cause issues
      vi.advanceTimersByTime(60_000)
      expect(useApprovalStore.getState().pendingApproval).toBeNull()
    })
  })

  describe('clearSession', () => {
    it('removes all session allowances', () => {
      useApprovalStore.getState().allowAllForSession('dangerous')
      useApprovalStore.getState().allowAllForSession('moderate')

      expect(useApprovalStore.getState().sessionAllowances.size).toBe(2)

      useApprovalStore.getState().clearSession()

      expect(useApprovalStore.getState().sessionAllowances.size).toBe(0)
    })

    it('after clearing, requests require approval again', async () => {
      useApprovalStore.getState().allowAllForSession('dangerous')
      useApprovalStore.getState().clearSession()

      const approvalPromise = useApprovalStore.getState().requestApproval(
        'bash',
        { command: 'ls' },
        'dangerous'
      )

      // Should be blocking (pending approval created)
      const pending = useApprovalStore.getState().pendingApproval!
      expect(pending).not.toBeNull()

      // Clean up
      useApprovalStore.getState().deny(pending.id)
      await approvalPromise
    })
  })

  describe('only one pending approval at a time', () => {
    it('second request auto-denies the first and replaces it', async () => {
      const store = useApprovalStore.getState()

      // Start first request
      const firstPromise = store.requestApproval('bash', { command: 'ls' }, 'dangerous')
      const firstId = useApprovalStore.getState().pendingApproval!.id

      // Start second request - this auto-denies the first
      const secondPromise = useApprovalStore.getState().requestApproval(
        'browserNavigate',
        { url: 'https://example.com' },
        'dangerous'
      )

      // First promise should already be resolved (auto-denied)
      const firstResult = await firstPromise
      expect(firstResult).toBe(false)

      // Second is now the pending approval
      const secondPending = useApprovalStore.getState().pendingApproval!
      expect(secondPending.toolName).toBe('browserNavigate')
      expect(secondPending.id).not.toBe(firstId)

      // Approve the second one
      useApprovalStore.getState().approve(secondPending.id)
      const secondResult = await secondPromise
      expect(secondResult).toBe(true)
    })
  })
})
