import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate reloads the page the moment a
      // new service worker activates, which would discard a half-filled report
      // out from under a farmer in the field. The user gets a toast instead.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'PashuRaksha — Livestock Outbreak Surveillance',
        short_name: 'PashuRaksha',
        description:
          'Field reporting and outbreak surveillance for livestock. Submit symptom reports by Pashu Aadhaar and track active disease clusters across India.',
        theme_color: '#161625',
        background_color: '#161625',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        lang: 'en-IN',
        categories: ['health', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Separate maskable entry: Android crops to its own shape, so this
          // one is full-bleed with the mark inside the safe zone. Declaring a
          // rounded icon as maskable gets it cropped twice and looks clipped.
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Submit a report', short_name: 'Report', url: '/?tab=submit' },
          { name: 'Outbreak map', short_name: 'Map', url: '/?tab=map' },
        ],
      },
      workbox: {
        // india.json is ~480KB and the JS bundle is ~257KB, both well over the
        // 2MB default cap but worth precaching: the map is the app's main
        // screen and must render on a phone with no signal.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // `json` matters here: the India TopoJSON is a static asset, and
        // without it the map renders empty on an offline launch -- which is
        // the exact situation the offline support exists for.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json}'],
        // SPA fallback: a cold launch from the home screen requests the
        // start_url, which must resolve to the app shell offline.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Google Fonts stylesheet — the only cross-origin request the app
            // makes. Stale-while-revalidate so a cold offline start still gets
            // Archivo rather than falling back to system sans.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Surveillance data. NetworkFirst, never CacheFirst: an outbreak
            // dashboard showing yesterday's clusters as if they were current is
            // worse than showing nothing. The cache is a fallback for a dead
            // connection, with a short timeout so a flaky rural link falls back
            // fast instead of hanging on a spinner.
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pashuraksha-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Lets the service worker be exercised with `npm run dev` instead of
        // only in a production build.
        enabled: false,
        type: 'module',
      },
    }),
  ],
})
