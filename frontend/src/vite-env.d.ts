/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_API_URL: string
}

/** Set in vite.config.ts: public/founder.jpg exists. */
declare const __HAS_FOUNDER__: boolean
