import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dotenv from 'dotenv';

// Загружаем переменные окружения
dotenv.config();

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
