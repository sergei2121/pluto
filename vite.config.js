import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite сам загружает переменные из .env (префикс VITE_).
// Для значений без префикса (например, VAPID_PUBLIC_KEY) используем process.env напрямую.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(process.env.VAPID_PUBLIC_KEY || ''),
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    hmr: {
      port: 8080,
    },
  },
});
