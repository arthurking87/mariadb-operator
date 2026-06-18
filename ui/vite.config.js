import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  cacheDir: '/tmp/vite-cache-mariadb-ui',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
