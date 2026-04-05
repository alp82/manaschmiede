import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { I18nProvider } from '../lib/i18n'
import appCss from '../styles/app.css?url'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Manaschmiede — MTG Deck Builder' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Inter:wght@400;500;600;700&display=swap',
      },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  return (
    <html lang="de" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-surface-900 text-surface-100 font-body min-h-screen antialiased">
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            <I18nProvider>
              <Outlet />
            </I18nProvider>
          </NuqsAdapter>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
