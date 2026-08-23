import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import path from 'path'

// Vitest boots this config during collection. The nitro() and tanstackStart()
// plugins spin up a dev/start server that never shuts down under the node-only
// test runner, so they're skipped when VITEST is set. The suite is pure logic
// and needs none of the framework wiring.
const isVitest = !!process.env.VITEST

export default defineConfig({
  server: { port: 3029, allowedHosts: ['.trycloudflare.com'] },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  plugins: isVitest
    ? [react()]
    : [
        nitro(),
        tailwindcss(),
        tanstackStart(),
        react(),
      ],
  test: {
    // One node project covers both trees: `src/` logic and the pure helpers in
    // `convex/` (parse / enforce / prompt-building), which need no Convex
    // runtime at import time.
    //
    // A `convex-test` suite is a different beast - per
    // `convex/_generated/ai/guidelines.md` it needs `environment: 'edge-runtime'`.
    // Under this single node project such a file would fail confusingly, so
    // adding one means splitting into `test.projects` first. (Vitest 4 removed
    // `environmentMatchGlobs`; `test.projects` is the replacement, and projects
    // do not inherit the root `plugins` or `resolve.alias` blocks.)
    environment: 'node',
    include: ['src/**/*.test.ts', 'convex/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
