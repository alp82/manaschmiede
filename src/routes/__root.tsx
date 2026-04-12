import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { I18nProvider } from '../lib/i18n'
import { ToastProvider } from '../components/ui/Toast'
import { ErrorBoundary } from '../components/ErrorBoundary'
import appCss from '../styles/app.css?url'

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Manaschmiede - MTG Deck Builder' },
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
        href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Geist:wght@300..700&family=JetBrains+Mono:wght@400;500;600&display=swap',
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('manaschmiede-locale');if(l&&l!=='de'){var s=document.createElement('style');s.id='i18n-cloak';s.textContent='body{visibility:hidden}';document.head.appendChild(s)}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-surface-900 text-surface-100 font-body min-h-screen antialiased">
        <ConvexProvider client={convex}>
          <QueryClientProvider client={queryClient}>
            <NuqsAdapter>
              <I18nProvider>
                <ToastProvider>
                  <ErrorBoundary>
                    <Outlet />
                  </ErrorBoundary>
                </ToastProvider>
              </I18nProvider>
            </NuqsAdapter>
          </QueryClientProvider>
        </ConvexProvider>
        <Scripts />
      </body>
    </html>
  )
}
