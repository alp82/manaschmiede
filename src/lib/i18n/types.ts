export type Locale = 'de' | 'en'

export interface Translations {
  // Nav / Layout
  'nav.cards': string
  'nav.newDeck': string

  // Search
  'search.placeholder': string
  'search.noResults': string
  'search.tryDifferent': string
  'search.error': string
  'search.results': string
  'search.welcome': string
  'search.welcomeSub': string
  'search.cardSearch': string
  'search.searching': string

  // Filters
  'filter.allTypes': string
  'filter.creature': string
  'filter.instant': string
  'filter.sorcery': string
  'filter.enchantment': string
  'filter.artifact': string
  'filter.planeswalker': string
  'filter.land': string
  'filter.allCmc': string
  'filter.format': string
  'filter.allFormats': string
  'filter.budget': string
  'filter.budgetMax': string
  'filter.noBudget': string
  'filter.rarity': string
  'filter.keyword': string
  'filter.allKeywords': string
  'filter.clearAll': string

  // Mana colors
  'color.white': string
  'color.blue': string
  'color.black': string
  'color.red': string
  'color.green': string

  // Deck management
  'deck.yourDecks': string
  'deck.createFirst': string
  'deck.loadSamples': string
  'deck.deleteConfirm': string
  'deck.delete': string
  'deck.cards': string
  'deck.deckNotFound': string
  'deck.emptyDeck': string
  'deck.emptyDeckSub': string
  'deck.namePlaceholder': string
  'deck.descriptionPlaceholder': string
  'deck.noResults': string
  'deck.pdf': string
  'deck.pdfGenerating': string
  'deck.editMode': string
  'deck.doneEditing': string

  // Wizard shared
  'wizard.colors': string
  'wizard.strategy': string
  'wizard.coreCards': string
  'wizard.buildDeck': string
  'wizard.reset': string
  'wizard.back': string
  'wizard.skip': string
  'wizard.next': string

  // Step 1: Colors
  'colors.title': string
  'colors.subtitle': string
  'colors.splashQuestion': string
  'colors.maybe': string
  'colors.aiDecide': string
  'colors.format': string
  'colors.formatCasual': string
  'colors.formatModern': string
  'colors.formatStandard': string
  'colors.descCasual': string
  'colors.descModern': string
  'colors.descStandard': string
  'colors.nextCoreCards': string
  'colors.recommended': string

  // Step 2: Strategy
  'strategy.title': string
  'strategy.subtitle': string
  'strategy.archetypes': string
  'strategy.pickUpTo2': string
  'strategy.traitsThemes': string
  'strategy.filterPlaceholder': string
  'strategy.combatKeywords': string
  'strategy.mechanics': string
  'strategy.creatureTypes': string
  'strategy.describeStrategy': string
  'strategy.strategyPlaceholder': string
  'strategy.budgetPerCard': string
  'strategy.unlimited': string
  'strategy.noLimit': string
  'strategy.rarity': string
  'strategy.common': string
  'strategy.uncommon': string
  'strategy.rare': string
  'strategy.mythic': string
  'strategy.skipLong': string
  'strategy.nextColors': string
  'strategy.showAllTraits': string
  'strategy.advanced': string

  // Step 3: Core Cards
  'core.title': string
  'core.subtitle': string
  'core.analyzing': string
  'core.noValidCombos': string
  'core.tryAgain': string
  'core.strategyChanged': string
  'core.strategyChangedHint': string
  'core.refreshCombos': string
  'core.suggestDifferent': string
  'core.orSearch': string
  'core.searchPlaceholder': string
  'core.suggestWithCard': string
  'core.skipLong': string
  'core.nextBuildDeck': string

  // Step 4: Deck Fill
  'fill.yourDeck': string
  'fill.cardsCount': string
  'fill.candidates': string
  'fill.addToDeck': string
  'fill.inYourDeck': string
  'fill.building': string
  'fill.searchPlaceholder': string
  'fill.clearFilters': string
  'fill.finishOpen': string
  'fill.laneCore': string
  'fill.laneCreatures': string
  'fill.laneSpells': string
  'fill.laneSupport': string
  'fill.laneLands': string
  'fill.fillSection': string
  'fill.fillAll': string
  'fill.topUp': string
  'fill.autoFillLands': string
  'fill.topUpLands': string
  'fill.suggestReplacement': string
  'fill.qty': string
  'fill.remove': string
  'fill.fillingProgress': string
  'fill.cancel': string
  'fill.emptyPrompt': string
  'fill.unassigned': string

  // AI Chat
  'chat.emptyPrompt': string
  'chat.inputPlaceholder': string
  'chat.inputPending': string
  'chat.send': string
  'chat.noChanges': string
  'chat.apply': string
  'chat.discard': string
  'chat.quickFill': string
  'chat.quickFixMana': string
  'chat.quickAddCreatures': string
  'chat.quickAddRemoval': string

  // Balance Advisor
  'balance.lands': string
  'balance.spells': string
  'balance.avgCmc': string
  'balance.manaCurve': string
  'balance.colorDist': string
  'balance.cardTypes': string
  'balance.landColors': string
  'balance.suggestions': string

  // Card Lightbox
  'lightbox.manaCost': string

  // DeckCardList
  'cardlist.noCards': string
  'cardlist.removeConfirm': string
  'cardlist.unlock': string
  'cardlist.lock': string

  // Page title
  'meta.title': string

  // Scryfall search cards placeholder
  'deckPage.searchPlaceholder': string
  'deckPage.addOverlay': string

  // Trait descriptions (keyed by trait id)
  [key: `trait.${string}`]: string
  [key: `trait.desc.${string}`]: string

  // Balance warnings (dynamic, handled separately)
  'balance.warning.tooFewCards': string
  'balance.warning.tooFewLands': string
  'balance.warning.tooManyLands': string
  'balance.warning.highCmc': string
  'balance.warning.tooManyCopies': string
  'balance.warning.sideboardTooLarge': string
  'balance.warning.colorLandMismatch': string
  'balance.suggestion.addRemoval': string
  'balance.suggestion.addCardDraw': string
  'balance.suggestion.tribalSynergy': string
}
