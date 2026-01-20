import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useConversations() {
  const queryClient = useQueryClient()

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => window.api.getConversations()
  })

  const createConversation = useMutation({
    mutationFn: (title: string) => window.api.createConversation(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  const updateConversation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; pinned?: boolean } }) =>
      window.api.updateConversation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  const deleteConversation = useMutation({
    mutationFn: (id: string) => window.api.deleteConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  return {
    conversations,
    isLoading,
    createConversation: createConversation.mutateAsync,
    updateConversation: updateConversation.mutate,
    deleteConversation: deleteConversation.mutate,
    isCreating: createConversation.isPending
  }
}

export function useConversation(id: string | null) {
  const queryClient = useQueryClient()

  const { data: conversation, isLoading } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => (id ? window.api.getConversation(id) : null),
    enabled: !!id
  })

  const createMessage = useMutation({
    mutationFn: (data: {
      conversationId: string
      role: string
      content: string
      thinking?: string
    }) => window.api.createMessage(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', id] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }
  })

  const updateMessage = useMutation({
    mutationFn: ({ msgId, data }: { msgId: string; data: { content?: string; thinking?: string } }) =>
      window.api.updateMessage(msgId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversation', id] })
    }
  })

  return {
    conversation,
    messages: conversation?.messages ?? [],
    isLoading,
    createMessage: createMessage.mutateAsync,
    updateMessage: updateMessage.mutate,
    isCreatingMessage: createMessage.isPending
  }
}
