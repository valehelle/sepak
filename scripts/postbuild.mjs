import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeSessionPages } from './sessionPages.mjs'

const dist = resolve(import.meta.dirname, '..', 'dist')
const base = process.env.VITE_BASE ?? '/sepak/'
const origin = process.env.SITE_ORIGIN ?? 'https://valehelle.github.io'

// 404.html is no longer a copy of index.html. Routing moved into the URL
// fragment (see src/main.tsx), so every current link is really `${base}`,
// which Pages serves directly. What still arrives here is a link shared
// before that change -- `${base}s/<id>` -- which Pages answers with this
// file. Rewriting it to the fragment form keeps those links opening the
// right session instead of dumping people on the home page.
//
// Deliberately standalone: no bundle, no fonts, nothing to download before
// the redirect fires. `location.replace` keeps the dead path out of the
// back button.
const redirectShim = `<!doctype html>
<html lang="ms">
  <head>
    <meta charset="UTF-8" />
    <title>Geng Turun Peluh</title>
    <script>
      (function () {
        var base = ${JSON.stringify(base)}
        var path = location.pathname
        var rest = path.indexOf(base) === 0 ? path.slice(base.length) : ''
        location.replace(base + '#/' + rest + location.search)
      })()
    </script>
  </head>
  <body></body>
</html>
`

await writeFile(resolve(dist, '404.html'), redirectShim)
await writeFile(resolve(dist, '.nojekyll'), '')

console.log('postbuild: wrote 404.html (hash redirect shim) and .nojekyll')

// Per-session share previews. Reads the same public anon key the site
// ships with, so no new secret is involved.
await writeSessionPages({
  dist,
  base,
  origin,
  url: process.env.VITE_SUPABASE_URL,
  key: process.env.VITE_SUPABASE_ANON_KEY,
})
