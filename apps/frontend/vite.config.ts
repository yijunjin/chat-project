import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [vue()],
   resolve: {
    alias: {
      '@backend': path.resolve(__dirname, 'apps/backend/src'),
      '@frontend': path.resolve(__dirname, 'apps/frontend/src'),
    }
  }
});
