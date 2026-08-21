import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/nutbox': {
        target: 'https://bsc-api.tagai.fun',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
