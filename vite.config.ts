import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import path from 'path'

export default defineConfig({
  server: { port: 3029, allowedHosts: ['.trycloudflare.com'] },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    nitro(),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
})
