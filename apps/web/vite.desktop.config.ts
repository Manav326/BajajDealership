import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Package only the staff application into the desktop binary. The vendor license
// console and public download page remain web-only entry points.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-desktop',
    emptyOutDir: true,
    rollupOptions: { input: 'index.html' },
  },
});
