import { useCallback, useSyncExternalStore } from 'react'
import { useSoundGroup } from '~/hooks/use-sound-group'
import { cardSlide1Sound } from '~/lib/card-slide-1'
import { cardPlace1Sound } from '~/lib/card-place-1'
import { cardShuffleSound } from '~/lib/card-shuffle'
import { clickSoftSound } from '~/lib/click-soft'
import { confirmation001Sound } from '~/lib/confirmation-001'
import { close001Sound } from '~/lib/close-001'

const STORAGE_KEY = 'manaschmiede-sound'
const DEBOUNCE_MS = 100

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

function getServerSnapshot(): boolean {
  return false
}

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

export function useSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setEnabled = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off')
    // Trigger re-render in same tab
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
  }, [])
  return [enabled, setEnabled]
}

const DEFAULT_VOLUME = 0.3
const TYPING_VOLUME = 0.12
const TYPING_DEBOUNCE_MS = 40

const lastPlayed = new Map<string, number>()
function debounced(key: string, fn: () => void, ms = DEBOUNCE_MS) {
  const now = Date.now()
  const last = lastPlayed.get(key) ?? 0
  if (now - last < ms) return
  lastPlayed.set(key, now)
  fn()
}

// Sound groups - add variants to each array for random selection
const UI_CLICK_SOUNDS = [clickSoftSound]
const CARD_SLIDE_SOUNDS = [cardSlide1Sound]
const CARD_OPEN_SOUNDS = [cardPlace1Sound]
const SHUFFLE_SOUNDS = [cardShuffleSound]
const FLOURISH_SOUNDS = [confirmation001Sound]
const DISMISS_SOUNDS = [close001Sound]

export function useDeckSounds() {
  const [enabled] = useSoundEnabled()
  const opts = { volume: DEFAULT_VOLUME, soundEnabled: enabled, interrupt: true }

  const typingOpts = { volume: TYPING_VOLUME, soundEnabled: enabled, interrupt: true }

  const playUiClick = useSoundGroup(UI_CLICK_SOUNDS, opts)
  const playCardSlide = useSoundGroup(CARD_SLIDE_SOUNDS, opts)
  const playCardOpen = useSoundGroup(CARD_OPEN_SOUNDS, opts)
  const playShuffle = useSoundGroup(SHUFFLE_SOUNDS, opts)
  const playFlourish = useSoundGroup(FLOURISH_SOUNDS, opts)
  const playDismiss = useSoundGroup(DISMISS_SOUNDS, opts)
  const playTyping = useSoundGroup(UI_CLICK_SOUNDS, typingOpts)

  return {
    uiClick: useCallback(() => debounced('click', playUiClick), [playUiClick]),
    cardOpen: useCallback(() => debounced('open', playCardOpen), [playCardOpen]),
    cardSlide: useCallback(() => debounced('slide', playCardSlide), [playCardSlide]),
    dismiss: useCallback(() => debounced('dismiss', playDismiss), [playDismiss]),
    aiShuffle: useCallback(() => debounced('shuffle', playShuffle), [playShuffle]),
    deckComplete: useCallback(() => debounced('flourish', playFlourish), [playFlourish]),
    typing: useCallback(() => debounced('typing', playTyping, TYPING_DEBOUNCE_MS), [playTyping]),
  }
}
