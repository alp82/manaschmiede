import { query, mutation } from './_generated/server'
import { v } from 'convex/values'

const formatValidator = v.union(
  v.literal('standard'),
  v.literal('modern'),
  v.literal('casual'),
)

const zoneValidator = v.union(
  v.literal('main'),
  v.literal('sideboard'),
)

export const listByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('decks')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .order('desc')
      .collect()
  },
})

export const getById = query({
  args: { deckId: v.id('decks') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deckId)
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    format: formatValidator,
    description: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('decks', {
      ...args,
      cards: [],
      isPublic: args.isPublic ?? false,
      updatedAt: Date.now(),
    })
  },
})

export const update = mutation({
  args: {
    deckId: v.id('decks'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    format: v.optional(formatValidator),
    tags: v.optional(v.array(v.string())),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { deckId, ...fields } = args
    const updates: Record<string, unknown> = { updatedAt: Date.now() }
    for (const [k, val] of Object.entries(fields)) {
      if (val !== undefined) updates[k] = val
    }
    await ctx.db.patch(deckId, updates)
  },
})

export const addCard = mutation({
  args: {
    deckId: v.id('decks'),
    scryfallId: v.string(),
    quantity: v.number(),
    zone: zoneValidator,
  },
  handler: async (ctx, args) => {
    const deck = await ctx.db.get(args.deckId)
    if (!deck) throw new Error('Deck not found')
    const cards = [...deck.cards]
    const idx = cards.findIndex((c) => c.scryfallId === args.scryfallId && c.zone === args.zone)
    if (idx >= 0) {
      cards[idx] = { ...cards[idx], quantity: cards[idx].quantity + args.quantity }
    } else {
      cards.push({ scryfallId: args.scryfallId, quantity: args.quantity, zone: args.zone })
    }
    await ctx.db.patch(args.deckId, { cards, updatedAt: Date.now() })
  },
})

export const removeCard = mutation({
  args: {
    deckId: v.id('decks'),
    scryfallId: v.string(),
    zone: zoneValidator,
  },
  handler: async (ctx, args) => {
    const deck = await ctx.db.get(args.deckId)
    if (!deck) throw new Error('Deck not found')
    const cards = deck.cards.filter((c) => !(c.scryfallId === args.scryfallId && c.zone === args.zone))
    await ctx.db.patch(args.deckId, { cards, updatedAt: Date.now() })
  },
})

export const remove = mutation({
  args: { deckId: v.id('decks') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.deckId)
  },
})
