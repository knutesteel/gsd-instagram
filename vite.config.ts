import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version;

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __APP_UPDATED_AT__: JSON.stringify(new Date().toISOString()),
  },
});
