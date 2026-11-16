import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// The backend (npm run server) owns WebRTC signaling, the telemetry socket and /api. Everything is
// proxied through the dev server so the browser and the phone only ever talk to ONE https origin.
const BACKEND = process.env.SMARTSPACE_BACKEND ?? 'http://127.0.0.1:8787'
const proxy = {
  '/signal': { target: BACKEND, ws: true, changeOrigin: false },
  '/telemetry': { target: BACKEND, ws: true, changeOrigin: false },
  '/api': { target: BACKEND, changeOrigin: false },
}

export default defineConfig({
  // Phones only allow camera access on https. basicSsl issues a self-signed certificate (the phone
  // shows a one-time warning). Set SMARTSPACE_HTTP=1 to serve plain http on localhost instead.
  plugins: [react(), tailwindcss(), ...(process.env.SMARTSPACE_HTTP ? [] : [basicSsl()])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  server: { host: true, proxy },
  preview: { host: true, proxy },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
})
