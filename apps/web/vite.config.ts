import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";

function compilerPolicy(): Plugin {
  const configure = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] === "/compiler/worker.js") {
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'none'",
        );
        response.setHeader("Cache-Control", "no-store");
      }
      next();
    });
  };
  return {
    name: "compiler-worker-policy",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [compilerPolicy(), react()],
    // Worker-specific policy; the rest of the app retains its API connection.
    // configurePreviewServer covers the locally served production build too.
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
