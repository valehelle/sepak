import { copyFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeSessionPages } from './sessionPages.mjs'

const dist = resolve(import.meta.dirname, '..', 'dist')
const base = process.env.VITE_BASE ?? '/sepak/'
const origin = process.env.SITE_ORIGIN ?? 'https://valehelle.github.io'

// GitHub Pages has no rewrite rule, so a path it has no file for is
// answered with this one. It is a copy of index.html, which boots the app
// at whatever path the person actually asked for. Sessions get a richer
// page of their own below; this covers one created since the last build.
await copyFile(resolve(dist, 'index.html'), resolve(dist, '404.html'))
await writeFile(resolve(dist, '.nojekyll'), '')

console.log('postbuild: wrote 404.html and .nojekyll')

// Per-session share previews. Reads the same public anon key the site
// ships with, so no new secret is involved.
await writeSessionPages({
  dist,
  base,
  origin,
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.VITE_SUPABASE_ANON_KEY,
})
