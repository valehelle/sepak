import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/sepak/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // `--host 127.0.0.1`: without it, vite preview binds the bare hostname
    // `localhost`, which on some machines resolves to the IPv6 loopback
    // (::1) only — the readiness check against the IPv4 baseURL below then
    // never connects and the webServer step times out.
    command: 'pnpm build && pnpm preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/sepak/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
