import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // Use port 3001 by default, or override with VITE_API_PROXY if needed.
        target: process.env.VITE_API_PROXY || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
