import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.COR_BROWSER_EXECUTABLE },
  },
  reporter: 'list',
  webServer: [
    {
      command: 'node --import tsx server/index.ts',
      url: 'http://localhost:3101/healthz',
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        NODE_ENV: 'test',
        DEMO_MODE: 'true',
        AGY_ENABLED: 'false',
        TELEGRAM_ENABLED: 'false',
        STT_ENABLED: 'false',
        HTTP_SOCKET: '',
        PORT: '3101',
        APP_ORIGIN: 'http://localhost:5273',
        OWNER_EMAIL: '',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      },
    },
    {
      command: 'npx vite --config vite.e2e.config.ts --host 127.0.0.1 --port 5273 --strictPort',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
