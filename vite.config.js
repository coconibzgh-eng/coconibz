import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pages = [
  "index.html",
  "account.html",
  "admin.html",
  "operations.html",
  "why-coconibz.html",
].map((page) => fileURLToPath(new URL(page, import.meta.url)));

export default defineConfig({
  build: {
    rollupOptions: {
      input: pages,
    },
  },
});
