/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
  /** Public VAPID key for web push. Public by design; see src/data/push.ts. */
  readonly VITE_VAPID_PUBLIC_KEY: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
