import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target:
            process.env.API_ORIGIN ?? env.API_ORIGIN ?? "http://127.0.0.1:3001",
          changeOrigin: true,
        },
      },
    },
    preview: { port: 4173, strictPort: true },
  };
});
