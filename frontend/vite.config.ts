import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // The landing page's optional "Built by" section renders only if the photo exists (DESIGN.md §7).
    __HAS_FOUNDER__: JSON.stringify(existsSync(new URL('./public/founder.jpg', import.meta.url))),
  },
})
