import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          if (moduleId.includes("libsodium")) return "crypto";
          if (moduleId.includes("react")) return "react";
          if (moduleId.includes("zod")) return "validation";
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Voice Relay",
        short_name: "Voice Relay",
        description: "把手机语音文字安全发送到 Windows 当前输入框",
        theme_color: "#171A1F",
        background_color: "#F7F5EF",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
