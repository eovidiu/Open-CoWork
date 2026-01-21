import { createOpenRouterClient } from './openrouter'
import { generateText } from 'ai'

// Vision-capable models in order of preference
const VISION_MODELS = [
  'google/gemini-2.0-flash-001',
  'google/gemini-flash-1.5',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4'
]

interface QueryImageResult {
  success: boolean
  response?: string
  error?: string
}

/**
 * Query an image using vision capabilities
 * Uses OpenRouter to send the image and prompt to a vision-capable model
 */
export async function queryImage(
  apiKey: string,
  conversationId: string,
  imageId: number,
  prompt: string
): Promise<QueryImageResult> {
  // Get the image from the registry
  const imageDataUrl = await window.api.getImage(conversationId, imageId)

  if (!imageDataUrl) {
    // Try to list available images for better error message
    const images = await window.api.listImages(conversationId)
    const availableIds = images.map((img: { sequenceNum: number }) => img.sequenceNum)

    if (availableIds.length === 0) {
      return {
        success: false,
        error: `Image #${imageId} not found. No images have been captured in this conversation yet.`
      }
    }

    return {
      success: false,
      error: `Image #${imageId} not found. Available images: ${availableIds.join(', ')}`
    }
  }

  const client = createOpenRouterClient(apiKey)

  // Try vision models in order until one works
  for (const modelId of VISION_MODELS) {
    try {
      console.log(`[ImageQuery] Trying model: ${modelId}`)

      const result = await generateText({
        model: client(modelId),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                image: imageDataUrl
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        maxTokens: 2000,
        maxRetries: 2
      })

      const response = result.text.trim()
      if (response) {
        console.log(`[ImageQuery] Success with ${modelId}, response length: ${response.length}`)

        // If this is a generic description query, cache it
        const isDescriptionQuery =
          prompt.toLowerCase().includes('describe') ||
          prompt.toLowerCase().includes('what is in') ||
          prompt.toLowerCase().includes('what do you see')

        if (isDescriptionQuery) {
          try {
            await window.api.updateImageDescription(conversationId, imageId, response)
            console.log(`[ImageQuery] Cached description for image #${imageId}`)
          } catch (err) {
            console.warn('[ImageQuery] Failed to cache description:', err)
          }
        }

        return { success: true, response }
      }
    } catch (error) {
      console.warn(`[ImageQuery] Failed with ${modelId}:`, error)
      continue
    }
  }

  return {
    success: false,
    error: 'Failed to analyze image with available vision models. Please try again.'
  }
}

/**
 * Get or generate a description for an image
 * Returns cached description if available, otherwise generates one
 */
export async function getImageDescription(
  apiKey: string,
  conversationId: string,
  imageId: number
): Promise<QueryImageResult> {
  // Check for cached description first
  const metadata = await window.api.getImageMetadata(conversationId, imageId)

  if (metadata?.description) {
    console.log(`[ImageQuery] Using cached description for image #${imageId}`)
    return { success: true, response: metadata.description }
  }

  // Generate description
  return queryImage(
    apiKey,
    conversationId,
    imageId,
    'Describe this image in detail. Include any visible text, UI elements, buttons, and important visual content.'
  )
}
