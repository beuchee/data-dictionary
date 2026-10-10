import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Pure-logic unit tests only, in Node: volatile React components are not unit-tested
    // (see docs/conventions.md).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
})
