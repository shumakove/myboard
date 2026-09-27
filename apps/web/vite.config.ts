/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Страница тестов открыта по IP в LAN, как в разработке (без localhost).
    environmentOptions: { jsdom: { url: "http://192.168.1.20:8080/" } },
    setupFiles: ["./src/test-setup.ts"],
  },
});
