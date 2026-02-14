// Mock API for browser development/testing
// Uses localStorage to persist data when window.api is not available (non-Electron)

interface Settings {
  id: string
  theme: string
  defaultModel: string
  analyticsOptIn: boolean
  onboardingComplete: boolean
}

interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface Message {
  id: string
  conversationId: string
  role: string
  content: string
  thinking?: string | null
  createdAt: string
}

interface Skill {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
}

interface ToolCall {
  id: string
  messageId: string
  toolName: string
  input: string
  output?: string | null
  status: string
}

const STORAGE_KEYS = {
  settings: 'mock-settings',
  conversations: 'mock-conversations',
  messages: 'mock-messages',
  toolCalls: 'mock-tool-calls',
  skills: 'mock-skills',
  apiKey: 'mock-api-key'
}

function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : defaultValue
  } catch {
    return defaultValue
  }
}

function setToStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

export const mockApi = {
  // Settings
  getSettings: async (): Promise<Settings> => {
    return getFromStorage<Settings>(STORAGE_KEYS.settings, {
      id: 'default',
      theme: 'system',
      defaultModel: 'google/gemini-3-flash-preview',
      analyticsOptIn: false,
      onboardingComplete: false
    })
  },

  updateSettings: async (data: Partial<Settings>): Promise<Settings> => {
    const current = await mockApi.getSettings()
    const updated = { ...current, ...data }
    setToStorage(STORAGE_KEYS.settings, updated)
    return updated
  },

  // API Key
  hasApiKey: async (): Promise<boolean> => {
    return !!localStorage.getItem(STORAGE_KEYS.apiKey)
  },

  getApiKeyMasked: async (): Promise<{ exists: boolean; masked: string; length: number } | null> => {
    const key = localStorage.getItem(STORAGE_KEYS.apiKey)
    if (!key) return null
    return {
      exists: true,
      masked: '••••••••' + key.slice(-4),
      length: key.length
    }
  },

  setApiKey: async (key: string): Promise<void> => {
    localStorage.setItem(STORAGE_KEYS.apiKey, key)
  },

  deleteApiKey: async (): Promise<void> => {
    localStorage.removeItem(STORAGE_KEYS.apiKey)
  },

  // Conversations
  getConversations: async (): Promise<Conversation[]> => {
    return getFromStorage<Conversation[]>(STORAGE_KEYS.conversations, [])
  },

  getConversation: async (id: string): Promise<(Conversation & { messages: (Message & { toolCalls?: ToolCall[] })[] }) | null> => {
    const conversations = await mockApi.getConversations()
    const conversation = conversations.find((c) => c.id === id)
    if (!conversation) return null
    const messages = await mockApi.getMessages(id)
    const allToolCalls = getFromStorage<ToolCall[]>(STORAGE_KEYS.toolCalls, [])

    // Attach tool calls to their respective messages
    const messagesWithToolCalls = messages.map((msg) => ({
      ...msg,
      toolCalls: allToolCalls.filter((tc) => tc.messageId === msg.id)
    }))

    return { ...conversation, messages: messagesWithToolCalls }
  },

  createConversation: async (title: string): Promise<Conversation> => {
    const conversations = await mockApi.getConversations()
    const newConv: Conversation = {
      id: generateId(),
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    setToStorage(STORAGE_KEYS.conversations, [...conversations, newConv])
    return newConv
  },

  updateConversation: async (id: string, data: { title: string }): Promise<Conversation> => {
    const conversations = await mockApi.getConversations()
    const index = conversations.findIndex((c) => c.id === id)
    if (index === -1) throw new Error('Conversation not found')
    conversations[index] = { ...conversations[index], ...data, updatedAt: new Date().toISOString() }
    setToStorage(STORAGE_KEYS.conversations, conversations)
    return conversations[index]
  },

  deleteConversation: async (id: string): Promise<void> => {
    const conversations = await mockApi.getConversations()
    setToStorage(
      STORAGE_KEYS.conversations,
      conversations.filter((c) => c.id !== id)
    )
    // Also delete messages for this conversation
    const allMessages = getFromStorage<Message[]>(STORAGE_KEYS.messages, [])
    setToStorage(
      STORAGE_KEYS.messages,
      allMessages.filter((m) => m.conversationId !== id)
    )
  },

  // Messages
  getMessages: async (conversationId: string): Promise<Message[]> => {
    const allMessages = getFromStorage<Message[]>(STORAGE_KEYS.messages, [])
    return allMessages.filter((m) => m.conversationId === conversationId)
  },

  createMessage: async (data: {
    conversationId: string
    role: string
    content: string
    thinking?: string
  }): Promise<Message> => {
    const allMessages = getFromStorage<Message[]>(STORAGE_KEYS.messages, [])
    const newMessage: Message = {
      id: generateId(),
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      thinking: data.thinking || null,
      createdAt: new Date().toISOString()
    }
    setToStorage(STORAGE_KEYS.messages, [...allMessages, newMessage])

    // Update conversation timestamp
    const conversations = await mockApi.getConversations()
    const convIndex = conversations.findIndex((c) => c.id === data.conversationId)
    if (convIndex >= 0) {
      conversations[convIndex].updatedAt = new Date().toISOString()
      setToStorage(STORAGE_KEYS.conversations, conversations)
    }

    return newMessage
  },

  // Tool calls
  createToolCall: async (data: {
    messageId: string
    toolName: string
    input: string
    output?: string
    status?: string
  }): Promise<ToolCall> => {
    const allToolCalls = getFromStorage<ToolCall[]>(STORAGE_KEYS.toolCalls, [])
    const newToolCall: ToolCall = {
      id: generateId(),
      messageId: data.messageId,
      toolName: data.toolName,
      input: data.input,
      output: data.output || null,
      status: data.status || 'success'
    }
    setToStorage(STORAGE_KEYS.toolCalls, [...allToolCalls, newToolCall])
    return newToolCall
  },

  // Skills
  getSkills: async (): Promise<Skill[]> => {
    return getFromStorage<Skill[]>(STORAGE_KEYS.skills, [])
  },

  installSkill: async (skill: Omit<Skill, 'enabled'>): Promise<Skill> => {
    const skills = await mockApi.getSkills()
    const newSkill: Skill = { ...skill, enabled: true }
    setToStorage(STORAGE_KEYS.skills, [...skills, newSkill])
    return newSkill
  },

  uninstallSkill: async (id: string): Promise<void> => {
    const skills = await mockApi.getSkills()
    setToStorage(
      STORAGE_KEYS.skills,
      skills.filter((s) => s.id !== id)
    )
  },

  toggleSkill: async (id: string, enabled: boolean): Promise<Skill> => {
    const skills = await mockApi.getSkills()
    const index = skills.findIndex((s) => s.id === id)
    if (index === -1) throw new Error('Skill not found')
    skills[index].enabled = enabled
    setToStorage(STORAGE_KEYS.skills, skills)
    return skills[index]
  },

  // File system (mock - limited functionality)
  readFile: async (path: string): Promise<string> => {
    return `[Mock] File contents of ${path}`
  },

  writeFile: async (path: string, content: string): Promise<void> => {
    console.log(`[Mock] Would write to ${path}:`, content)
  },

  readDirectory: async (path: string): Promise<Array<{
    name: string
    path: string
    isDirectory: boolean
    size?: number
    modifiedAt?: Date
  }>> => {
    // Return mock directory listing
    return [
      { name: 'Documents', path: `${path}/Documents`, isDirectory: true },
      { name: 'Desktop', path: `${path}/Desktop`, isDirectory: true },
      { name: 'Downloads', path: `${path}/Downloads`, isDirectory: true },
      { name: 'notes.txt', path: `${path}/notes.txt`, isDirectory: false, size: 1024 },
      { name: 'photo.jpg', path: `${path}/photo.jpg`, isDirectory: false, size: 2048576 }
    ]
  },

  glob: async (pattern: string, cwd?: string): Promise<Array<{
    name: string
    path: string
    isDirectory: boolean
    size?: number
    modifiedAt?: Date
  }>> => {
    const basePath = cwd || '/Users/mock'
    // Return mock results based on pattern
    if (pattern.includes('*.txt')) {
      return [
        { name: 'notes.txt', path: `${basePath}/notes.txt`, isDirectory: false, size: 1024 },
        { name: 'readme.txt', path: `${basePath}/readme.txt`, isDirectory: false, size: 512 }
      ]
    }
    if (pattern.includes('*.pdf')) {
      return [
        { name: 'document.pdf', path: `${basePath}/document.pdf`, isDirectory: false, size: 102400 },
        { name: 'report.pdf', path: `${basePath}/report.pdf`, isDirectory: false, size: 204800 }
      ]
    }
    return [
      { name: 'example-file', path: `${basePath}/example-file`, isDirectory: false, size: 1024 }
    ]
  },

  grep: async (pattern: string, searchPath: string, options?: { maxResults?: number }): Promise<Array<{
    file: string
    line: number
    content: string
    match: string
  }>> => {
    // Return mock search results
    return [
      { file: `${searchPath}/example.ts`, line: 10, content: `// Contains ${pattern} in comment`, match: pattern },
      { file: `${searchPath}/config.json`, line: 5, content: `"key": "${pattern}"`, match: pattern }
    ].slice(0, options?.maxResults || 100)
  },

  // Commands (mock)
  executeCommand: async (
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    console.log(`[Mock] Would execute:`, command)
    return { stdout: `[Mock] Command output for: ${command}`, stderr: '', exitCode: 0 }
  },

  // Permissions
  requestPermission: async (): Promise<boolean> => true,
  checkPermission: async (): Promise<boolean> => true,
  revokePermission: async (): Promise<void> => {}
}

// Install mock API if window.api doesn't exist
export function installMockApi(): void {
  if (typeof window !== 'undefined' && !window.api) {
    console.log('[Mock API] Installing browser mock for window.api')
    ;(window as unknown as { api: typeof mockApi }).api = mockApi
  }
}
