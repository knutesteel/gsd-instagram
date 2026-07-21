import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version;
// Vercel provides the commit SHA for every Git-triggered deployment.  Showing
// it in the UI makes the running build unambiguous when several deployments
// exist close together.  Local builds retain the package version as a useful
// fallback.
const deploymentIdentifier = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || packageVersion;

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
  define: {
    __APP_VERSION__: JSON.stringify(deploymentIdentifier.slice(0, 7)),
    __APP_UPDATED_AT__: JSON.stringify(new Date().toISOString()),
  },
});
