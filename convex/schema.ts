import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  decks: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    format: v.union(
      v.literal('standard'),
      v.literal('modern'),
      v.literal('casual'),
    ),
    cards: v.array(
      v.object({
        scryfallId: v.string(),
        quantity: v.number(),
        zone: v.union(
          v.literal('main'),
          v.literal('sideboard'),
        ),
      }),
    ),
    tags: v.optional(v.array(v.string())),
    isPublic: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_public', ['isPublic']),
})
