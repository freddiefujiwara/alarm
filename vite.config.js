import { defineConfig } from "vite";

export default defineConfig({
  base: "/alarm/",
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.js"],
  },
});
