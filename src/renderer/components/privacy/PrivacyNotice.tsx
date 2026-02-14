import { useState } from 'react'
import { Shield } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/dialog'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { PrivacyPolicyContent } from './PrivacyPolicy'
import { useSettings } from '../../hooks/useSettings'

interface PrivacyNoticeProps {
  onAccept: () => void
}

/**
 * Blocking modal shown on first launch. Cannot be dismissed without accepting.
 * Displays a summary of data processing practices with the full policy scrollable below.
 */
export function PrivacyNotice({ onAccept }: PrivacyNoticeProps) {
  const { updateSettings } = useSettings()
  const [accepting, setAccepting] = useState(false)

  const handleAccept = () => {
    setAccepting(true)
    updateSettings(
      { privacyAccepted: true },
      {
        onSuccess: () => {
          onAccept()
        },
        onError: () => {
          setAccepting(false)
        }
      }
    )
  }

  return (
    <Dialog open modal>
      {/* onOpenChange is intentionally omitted to prevent dismissal */}
      <DialogContent
        className="max-w-lg max-h-[85vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Data Processing Notice</DialogTitle>
              <DialogDescription>
                Please review how Open CoWork handles your data
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-md bg-muted p-4 text-sm">
          <p className="mb-2 font-medium">Before you begin, please be aware that:</p>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            <li>Your conversations are sent to OpenRouter and AI model providers for processing</li>
            <li>Conversation data is stored locally on your machine (unencrypted SQLite)</li>
            <li>The AI can execute shell commands, read/write files, and automate a browser</li>
            <li>Anonymous analytics may be collected via PostHog (you can opt out)</li>
            <li>AI skills from skillregistry.io are loaded into the AI context</li>
          </ul>
        </div>

        <ScrollArea className="flex-1 pr-4" style={{ maxHeight: 'calc(85vh - 22rem)' }}>
          <PrivacyPolicyContent />
        </ScrollArea>

        <DialogFooter>
          <Button className="w-full" onClick={handleAccept} disabled={accepting}>
            {accepting ? 'Saving...' : 'I Understand & Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
