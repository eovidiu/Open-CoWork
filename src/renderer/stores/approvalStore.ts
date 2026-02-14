import { create } from 'zustand'

export type ToolTier = 'dangerous' | 'moderate'

export interface PendingApproval {
  id: string
  toolName: string
  args: Record<string, unknown>
  tier: ToolTier
}

interface ApprovalStore {
  pendingApproval: PendingApproval | null
  sessionAllowances: Set<ToolTier>

  requestApproval: (
    toolName: string,
    args: Record<string, unknown>,
    tier: ToolTier
  ) => Promise<boolean>
  approve: (id: string) => void
  deny: (id: string) => void
  allowAllForSession: (tier: ToolTier) => void
  clearSession: () => void
}

const AUTO_DENY_TIMEOUT_MS = 60_000

// Private map storing resolve functions — not exposed on Zustand state
const resolvers = new Map<string, (approved: boolean) => void>()
const timeouts = new Map<string, ReturnType<typeof setTimeout>>()

function resolveApproval(id: string, approved: boolean) {
  const resolver = resolvers.get(id)
  if (resolver) {
    const timeoutId = timeouts.get(id)
    if (timeoutId) clearTimeout(timeoutId)
    timeouts.delete(id)
    resolvers.delete(id)
    resolver(approved)
  }
}

export const useApprovalStore = create<ApprovalStore>((set, get) => ({
  pendingApproval: null,
  sessionAllowances: new Set<ToolTier>(),

  requestApproval: (toolName, args, tier) => {
    const state = get()

    // If tier already allowed for this session, approve immediately
    if (state.sessionAllowances.has(tier)) {
      return Promise.resolve(true)
    }

    // Auto-deny any existing pending approval before creating new one
    if (state.pendingApproval) {
      resolveApproval(state.pendingApproval.id, false)
    }

    return new Promise<boolean>((resolve) => {
      const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      resolvers.set(id, resolve)

      // Auto-deny after timeout
      const timeoutId = setTimeout(() => {
        const current = get().pendingApproval
        if (current && current.id === id) {
          set({ pendingApproval: null })
        }
        resolveApproval(id, false)
      }, AUTO_DENY_TIMEOUT_MS)

      timeouts.set(id, timeoutId)

      set({
        pendingApproval: { id, toolName, args, tier }
      })
    })
  },

  approve: (id) => {
    const state = get()
    if (state.pendingApproval && state.pendingApproval.id === id) {
      set({ pendingApproval: null })
      resolveApproval(id, true)
    }
  },

  deny: (id) => {
    const state = get()
    if (state.pendingApproval && state.pendingApproval.id === id) {
      set({ pendingApproval: null })
      resolveApproval(id, false)
    }
  },

  allowAllForSession: (tier) => {
    const state = get()
    const newAllowances = new Set(state.sessionAllowances)
    newAllowances.add(tier)

    if (state.pendingApproval && state.pendingApproval.tier === tier) {
      const pendingId = state.pendingApproval.id
      set({
        pendingApproval: null,
        sessionAllowances: newAllowances
      })
      resolveApproval(pendingId, true)
    } else {
      set({ sessionAllowances: newAllowances })
    }
  },

  clearSession: () => {
    set({ sessionAllowances: new Set<ToolTier>() })
  }
}))
