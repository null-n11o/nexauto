import { defineConfig, devices } from '@playwright/test'

// Public-page and routing checks need no database, users, or platform credentials.
export default defineConfig({
  testDir: './public',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://localhost:3002', ...devices['Desktop Chrome'], channel: 'chrome' },
  webServer: {
    command: 'npm run dev -- --port 3002',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'demo-only',
    },
  },
})
