import { useCallback, useEffect, useRef, useState } from 'react'
import { getAudioContext, decodeAudioData } from './engine'
import type { SoundAsset } from './types'

interface UseSoundOptions {
  volume?: number
  playbackRate?: number
  interrupt?: boolean
  soundEnabled?: boolean
}

type PlayFunction = (overrides?: { volume?: number; playbackRate?: number }) => void

export function useSound(
  sound: SoundAsset,
  options: UseSoundOptions = {},
): [PlayFunction, { stop: () => void; isPlaying: boolean }] {
  const { volume = 1, playbackRate = 1, interrupt = false, soundEnabled = true } = options

  const [isPlaying, setIsPlaying] = useState(false)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)

  useEffect(() => {
    let cancelled = false
    decodeAudioData(sound.dataUri).then((buffer) => {
      if (!cancelled) bufferRef.current = buffer
    })
    return () => {
      cancelled = true
    }
  }, [sound.dataUri])

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop()
      } catch {
        /* already stopped */
      }
      sourceRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const play: PlayFunction = useCallback(
    (overrides) => {
      if (!soundEnabled || !bufferRef.current) return
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') ctx.resume()
      if (interrupt && sourceRef.current) stop()

      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = bufferRef.current
      source.playbackRate.value = overrides?.playbackRate ?? playbackRate
      gain.gain.value = overrides?.volume ?? volume
      source.connect(gain)
      gain.connect(ctx.destination)
      source.onended = () => setIsPlaying(false)
      source.start(0)
      sourceRef.current = source
      gainRef.current = gain
      setIsPlaying(true)
    },
    [soundEnabled, playbackRate, volume, interrupt, stop],
  )

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try {
          sourceRef.current.stop()
        } catch {
          /* */
        }
      }
      sourceRef.current = null
    }
  }, [])

  return [play, { stop, isPlaying }]
}
