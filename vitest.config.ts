import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://www.youtube.com/" } },
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
