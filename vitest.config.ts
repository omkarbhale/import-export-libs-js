import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "spec/**/*.test.ts", "tools/**/*.test.ts", "oracle/**/*.test.ts"],
    // The replay and coverage tests take several seconds each when the whole suite runs in parallel.
    testTimeout: 60_000,
  },
});
