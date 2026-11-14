import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "My money",
        short_name: "My money",
        description: "Your money: income, spending, savings and payments to people.",
        theme_color: "#4f46e5",
        background_color: "#f6f4ee",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Keep the last known data so the app opens offline (read-only).
            urlPattern: /^\/api\/state$/,
            handler: "NetworkFirst",
            options: { cacheName: "api-state", networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: path.resolve(__dirname, "../dist/client"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Keep React in its own long-cached chunk so app updates stay tiny.
        manualChunks: { vendor: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
