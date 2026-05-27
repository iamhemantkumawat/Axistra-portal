import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envPrefix: ['VITE_', 'REACT_APP_'],
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Accept the Emergent preview host(s) and any future cloud subdomain
    allowedHosts: [
      'localhost',
      '.preview.emergentagent.com',
      '.preview.emergentcf.cloud',
      '.emergentagent.com',
      '.emergentcf.cloud',
      'axistratech.com',
      '.axistratech.com',
    ],
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
});
