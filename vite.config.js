import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'esnext' },
  // hmr off: an automatic reload recompiles every shader
  // (seconds of 1–5 fps). Changes are still served fresh on a manual refresh (F5).
  server: { port: 5173, hmr: false }
});
