import { useCallback, useEffect, useRef } from 'react'
import { getAudioContext, decodeAudioData } from '~/lib/sound-engine'
import type { SoundAsset } from '~/lib/sound-types'

/**
 * Like useSound, but accepts an array of assets and picks one at random on each play.
 * Pre-decodes all variants on mount so playback is instant.
 */
export function useSoundGroup(
  assets: SoundAsset[],
  options: { volume?: number; soundEnabled?: boolean; interrupt?: boolean } = {},
) {
  const { volume = 1, soundEnabled = true, interrupt = true } = options
  const buffersRef = useRef<AudioBuffer[]>([])
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all(assets.map((a) => decodeAudioData(a.dataUri))).then((buffers) => {
      if (!cancelled) buffersRef.current = buffers
    })
    return () => { cancelled = true }
  }, [assets])

  const play = useCallback(() => {
    if (!soundEnabled || buffersRef.current.length === 0) return
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') ctx.resume()

    if (interrupt && sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current = null
    }

    const buffer = buffersRef.current[Math.floor(Math.random() * buffersRef.current.length)]
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    gain.gain.value = volume
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start(0)
    sourceRef.current = source
  }, [soundEnabled, volume, interrupt])

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop() } catch { /* already stopped */ }
      }
    }
  }, [])

  return play
}
