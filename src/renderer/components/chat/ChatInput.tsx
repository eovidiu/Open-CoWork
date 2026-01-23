import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  memo
} from 'react'
import { Globe, Paperclip, FileText, Loader2, Square, X } from 'lucide-react'
import { ModelPicker } from './ModelPicker'
import { cn } from '../../lib/utils'

export interface Attachment {
  id: string
  type: 'image' | 'file'
  name: string
  data: string
  mimeType: string
}

export interface ChatInputHandle {
  addFiles: (files: FileList) => Promise<void>
  setValue: (value: string) => void
}

interface ChatInputProps {
  isLoading: boolean
  activeConversationId: string | null
  onSubmit: (content: string, attachments: Attachment[]) => Promise<void>
  onStop: (conversationId?: string) => void
  searchEnabled: boolean
  toggleSearch: () => void
  currentModelSupportsSearch: boolean
}

const ChatInputBase = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    isLoading,
    activeConversationId,
    onSubmit,
    onStop,
    searchEnabled,
    toggleSearch,
    currentModelSupportsSearch
  },
  ref
) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isStopHovered, setIsStopHovered] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const compressImage = useCallback(
    (file: File, maxSize: number = 1024, quality: number = 0.8): Promise<string> => {
      return new Promise((resolve, reject) => {
        const img = new Image()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        img.onload = () => {
          let { width, height } = img
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width)
              width = maxSize
            } else {
              width = Math.round((width * maxSize) / height)
              height = maxSize
            }
          }

          canvas.width = width
          canvas.height = height
          ctx?.drawImage(img, 0, 0, width, height)

          const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
          const dataUrl = canvas.toDataURL(mimeType, quality)

          resolve(dataUrl)
        }

        img.onerror = reject

        const reader = new FileReader()
        reader.onload = () => {
          img.src = reader.result as string
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },
    []
  )

  const fileToDataUrl = useCallback(
    async (file: File): Promise<string> => {
      if (file.type.startsWith('image/')) {
        return compressImage(file)
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },
    [compressImage]
  )

  const addFiles = useCallback(async (files: FileList) => {
    const newAttachments: Attachment[] = []
    for (const file of Array.from(files)) {
      const data = await fileToDataUrl(file)
      const isImage = file.type.startsWith('image/')
      newAttachments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: isImage ? 'image' : 'file',
        name: file.name,
        data,
        mimeType: file.type
      })
    }
    setAttachments((prev) => [...prev, ...newAttachments])
  }, [fileToDataUrl])

  useImperativeHandle(ref, () => ({
    addFiles,
    setValue: (value: string) => setInput(value)
  }), [addFiles])

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const data = await fileToDataUrl(file)
          setAttachments((prev) => [...prev, {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type: 'image',
            name: `pasted-image-${Date.now()}.png`,
            data,
            mimeType: file.type
          }])
        }
      }
    }
  }, [fileToDataUrl])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachments.length === 0) || isLoading) return
    const content = input.trim()
    const currentAttachments = [...attachments]
    setInput('')
    setAttachments([])
    await onSubmit(content, currentAttachments)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  return (
    <div className="bg-background p-4">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css,.scss,.yaml,.yml,.xml,.sql,.sh,.bash,.zsh,.env,.gitignore,.toml,.rs,.go,.java,.c,.cpp,.h,.hpp,.swift,.kt,.rb,.php"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />

        <div className="rounded-2xl border bg-card shadow-sm">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b p-3">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative flex items-center gap-2 rounded-lg border bg-muted/50 p-2"
                >
                  {attachment.type === 'image' && attachment.data ? (
                    <img
                      src={attachment.data}
                      alt={attachment.name}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <span className="max-w-[80px] truncate text-xs">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 pt-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="How can I help you today?"
              className="w-full resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground"
              disabled={isLoading}
              rows={1}
            />
          </div>

          <div className="flex items-center justify-between px-3 pb-3 pt-2">
            <div className="flex items-center gap-1">
              <ModelPicker variant="minimal" />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleSearch}
                disabled={!currentModelSupportsSearch}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
                  searchEnabled && currentModelSupportsSearch
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  !currentModelSupportsSearch && 'cursor-not-allowed opacity-40'
                )}
                title={
                  currentModelSupportsSearch
                    ? searchEnabled
                      ? 'Web search enabled - click to disable'
                      : 'Click to enable web search'
                    : 'This model does not support web search'
                }
              >
                <Globe className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title="Add attachment"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              {isLoading && (
                <button
                  type="button"
                  onClick={() => onStop(activeConversationId || undefined)}
                  onMouseEnter={() => setIsStopHovered(true)}
                  onMouseLeave={() => setIsStopHovered(false)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
                    isStopHovered
                      ? 'bg-destructive/15 text-destructive'
                      : 'text-muted-foreground'
                  )}
                  title="Stop generating"
                >
                  {isStopHovered ? (
                    <Square className="h-4 w-4 fill-current" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {!isLoading && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Press Enter to send · Shift+Enter for new line
          </p>
        )}
      </form>
    </div>
  )
})

export const ChatInput = memo(ChatInputBase)
ChatInput.displayName = 'ChatInput'
