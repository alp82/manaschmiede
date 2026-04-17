import { useQuery } from '@tanstack/react-query'
import { useI18n } from '../i18n'
import { localizedCardOptions } from './queries'
import type { ScryfallCard } from './types'

export function useLocalizedCard(params: {
  id: string | undefined
  set?: string
  collectorNumber?: string
  existing?: ScryfallCard | null
  enabled?: boolean
}) {
  const { scryfallLang } = useI18n()
  return useQuery({
    ...localizedCardOptions({
      id: params.id ?? '',
      set: params.set,
      collectorNumber: params.collectorNumber,
      existing: params.existing,
      lang: scryfallLang,
    }),
    enabled: (params.enabled ?? true) && Boolean(params.id),
  })
}
