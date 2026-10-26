import config from "./playwright.config.js";

const apiServer = Array.isArray(config.webServer)
  ? config.webServer[0]
  : config.webServer;
if (!apiServer)
  throw new Error("Built browser checks require the API test harness");
export default {
  ...config,
  outputDir: ".cache/production-results",
  webServer: [
    apiServer,
    {
      command:
        "pnpm --filter @overleaf-pro/web preview --port 5273 --host 127.0.0.1",
      url: "http://127.0.0.1:5273",
      env: { API_ORIGIN: "http://127.0.0.1:3101" },
      reuseExistingServer: false,
    },
  ],
};
