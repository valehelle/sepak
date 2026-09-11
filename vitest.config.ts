import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['tests/**/*.integration.test.ts'],
          testTimeout: 20_000,
          // `fileParallelism` is root-only in this vitest version (it is not
          // part of the per-project `ProjectConfig` type, so setting it here
          // fails to typecheck). `poolOptions.forks.singleFork` is the
          // per-project equivalent: it confines this project to a single
          // process, so its test files run one at a time against the shared
          // local Postgres instead of racing each other.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
})
