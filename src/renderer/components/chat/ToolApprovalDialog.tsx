import { useState, useEffect } from 'react'
import { ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { useApprovalStore } from '../../stores/approvalStore'
import { cn } from '../../lib/utils'

const AUTO_DENY_TIMEOUT_SECONDS = 60

// Human-friendly tool names matching toolDisplayInfo in ChatArea.tsx
const friendlyToolNames: Record<string, string> = {
  bash: 'Run Shell Command',
  browserNavigate: 'Open Webpage',
  browserType: 'Type in Browser',
  browserClick: 'Click in Browser',
  browserPress: 'Press Key in Browser',
  installSkill: 'Install Skill',
  requestLogin: 'Request Login'
}

function formatArgs(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
      return String(args.command ?? '')
    case 'browserNavigate':
      return String(args.url ?? '')
    case 'browserType':
      return `${args.selector ?? ''}: "${args.text ?? ''}"`
    case 'browserClick':
      return String(args.selector ?? '')
    case 'browserPress':
      return String(args.key ?? '')
    case 'installSkill':
      return `${args.name ?? args.skillId ?? ''}`
    case 'requestLogin':
      return `${args.siteName ?? ''} (${args.url ?? ''})`
    default:
      return JSON.stringify(args, null, 2)
  }
}

export function ToolApprovalDialog() {
  const { pendingApproval, approve, deny, allowAllForSession } = useApprovalStore()
  const [secondsLeft, setSecondsLeft] = useState(AUTO_DENY_TIMEOUT_SECONDS)

  // Countdown timer
  useEffect(() => {
    if (!pendingApproval) {
      setSecondsLeft(AUTO_DENY_TIMEOUT_SECONDS)
      return
    }

    setSecondsLeft(AUTO_DENY_TIMEOUT_SECONDS)

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [pendingApproval?.id])

  if (!pendingApproval) return null

  const { id, toolName, args, tier } = pendingApproval
  const isDangerous = tier === 'dangerous'
  const friendlyName = friendlyToolNames[toolName] ?? toolName
  const argsSummary = formatArgs(toolName, args)

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-lg">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        {isDangerous ? (
          <ShieldAlert className="h-5 w-5 text-red-500" />
        ) : (
          <ShieldCheck className="h-5 w-5 text-yellow-500" />
        )}
        <span className="text-sm font-medium text-muted-foreground">Tool approval required</span>
        <span
          className={cn(
            'ml-2 rounded-full px-2 py-0.5 text-xs font-semibold',
            isDangerous
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
          )}
        >
          {tier}
        </span>
      </div>

      {/* Tool name */}
      <h3 className="mb-3 text-lg font-medium">{friendlyName}</h3>

      {/* Args summary */}
      {argsSummary && (
        <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {argsSummary}
        </pre>
      )}

      {/* Timer */}
      <div className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Timer className="h-4 w-4" />
        <span>Auto-deny in {secondsLeft}s</span>
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => approve(id)}
          className="rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Approve
        </button>
        <button
          onClick={() => deny(id)}
          className="rounded-xl bg-destructive px-6 py-3 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          Deny
        </button>
        <button
          onClick={() => allowAllForSession(tier)}
          className="ml-auto text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Allow all {tier} tools for this session
        </button>
      </div>
    </div>
  )
}
