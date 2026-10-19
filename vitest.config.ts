import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "spec/**/*.test.ts", "tools/**/*.test.ts", "oracle/**/*.test.ts"],
    // The replay and coverage tests parse large recorded documents; under a full parallel run they outlast the 5 s default.
    testTimeout: 60_000,
  },
});
