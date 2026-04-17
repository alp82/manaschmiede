import { createFileRoute } from '@tanstack/react-router'
import { Layout } from '../components/Layout'
import { CardSearch } from '../components/CardSearch'
import { useT } from '../lib/i18n'

export const Route = createFileRoute('/cards')({
  head: () => ({
    meta: [
      { title: 'Cards — Manaschmiede' },
      {
        name: 'description',
        content: 'Search the full Magic: the Gathering catalog.',
      },
    ],
  }),
  component: CardsPage,
})

function CardsPage() {
  const t = useT()

  return (
    <Layout>
      <section className="space-y-8">
        <header className="flex items-baseline justify-between border-t border-hairline pt-8">
          <div className="flex items-baseline gap-4">
            <span className="font-mono text-mono-label uppercase tracking-mono-label text-cream-400">
              {t('cards.eyebrow')}
            </span>
            <h1 className="font-display text-display-section uppercase leading-none tracking-section text-cream-100">
              {t('cards.title')}
            </h1>
          </div>
        </header>

        <CardSearch />
      </section>
    </Layout>
  )
}
