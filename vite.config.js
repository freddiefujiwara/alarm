import { defineConfig } from "vite";

export default defineConfig({
  base: "/alarm/",
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
  },
});
