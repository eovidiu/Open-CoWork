import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'

/**
 * These tests validate that the Prisma client has all expected models.
 * This catches issues where the bundled Prisma client is missing models
 * due to outdated generation or bundling issues.
 */
describe('Prisma Client Models', () => {
  it('should have all expected model accessors', () => {
    const prisma = new PrismaClient()

    // Check that all expected models exist as properties on the client
    // This would fail if the Prisma client was generated without these models
    expect(prisma).toHaveProperty('conversation')
    expect(prisma).toHaveProperty('message')
    expect(prisma).toHaveProperty('toolCall')
    expect(prisma).toHaveProperty('skill')
    expect(prisma).toHaveProperty('permission')
    expect(prisma).toHaveProperty('settings')
    expect(prisma).toHaveProperty('image') // The new model that was missing!

    // Verify they are functions (model delegates)
    expect(typeof prisma.conversation.findMany).toBe('function')
    expect(typeof prisma.message.findMany).toBe('function')
    expect(typeof prisma.toolCall.findMany).toBe('function')
    expect(typeof prisma.skill.findMany).toBe('function')
    expect(typeof prisma.permission.findMany).toBe('function')
    expect(typeof prisma.settings.findMany).toBe('function')
    expect(typeof prisma.image.findMany).toBe('function')
    expect(typeof prisma.image.findFirst).toBe('function')
    expect(typeof prisma.image.findUnique).toBe('function')
    expect(typeof prisma.image.create).toBe('function')
    expect(typeof prisma.image.update).toBe('function')
    expect(typeof prisma.image.delete).toBe('function')
  })

  it('should have Image model with expected query methods', () => {
    const prisma = new PrismaClient()

    // These are the specific methods we use in image.service.ts
    expect(typeof prisma.image.findFirst).toBe('function')
    expect(typeof prisma.image.findUnique).toBe('function')
    expect(typeof prisma.image.findMany).toBe('function')
    expect(typeof prisma.image.create).toBe('function')
    expect(typeof prisma.image.update).toBe('function')
  })
})

describe('Prisma Schema Validation', () => {
  it('should have the Image model in the generated schema', async () => {
    // Read the generated schema to verify Image model is present
    const fs = await import('fs')
    const path = await import('path')

    // Check multiple possible locations for the generated schema
    const possiblePaths = [
      path.join(process.cwd(), 'node_modules/.prisma/client/schema.prisma'),
      path.join(
        process.cwd(),
        'node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/schema.prisma'
      )
    ]

    let schemaContent: string | null = null
    for (const schemaPath of possiblePaths) {
      if (fs.existsSync(schemaPath)) {
        schemaContent = fs.readFileSync(schemaPath, 'utf-8')
        break
      }
    }

    expect(schemaContent).not.toBeNull()
    expect(schemaContent).toContain('model Image {')
    expect(schemaContent).toContain('conversationId')
    expect(schemaContent).toContain('sequenceNum')
    expect(schemaContent).toContain('@@unique([conversationId, sequenceNum])')
  })
})
