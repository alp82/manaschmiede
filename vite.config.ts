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
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
