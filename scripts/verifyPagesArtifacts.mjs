// Verifies the two things GitHub Pages needs that `vite preview` never
// exercises: `dist/404.html` (Pages has no SPA rewrite rule, so this is what
// makes a pasted session link survive a cold load or a refresh) and
// `dist/.nojekyll` (without it, Pages' Jekyll processing can mangle or drop
// files under `_`-prefixed paths). Run after `pnpm build`.
//
// Invoked both from CI (.github/workflows/deploy.yml, right after the build
// step) and locally via `pnpm verify:pages`, so a broken or dropped
// `scripts/postbuild.mjs` step is caught in both places rather than only
// surfacing as a live 404 on a pasted WhatsApp link.
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '..', 'dist')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const failures = []

const nojekyll = resolve(dist, '.nojekyll')
if (!(await exists(nojekyll))) {
  failures.push(`missing ${nojekyll}`)
}

const indexPath = resolve(dist, 'index.html')
const notFoundPath = resolve(dist, '404.html')
if (!(await exists(indexPath))) {
  failures.push(`missing ${indexPath}`)
} else if (!(await exists(notFoundPath))) {
  failures.push(`missing ${notFoundPath}`)
} else {
  const [index, notFound] = await Promise.all([readFile(indexPath, 'utf8'), readFile(notFoundPath, 'utf8')])
  if (index !== notFound) {
    failures.push(`${notFoundPath} does not match ${indexPath} -- postbuild's 404.html copy is stale or was skipped`)
  }
}

if (failures.length > 0) {
  console.error('verify:pages failed -- did scripts/postbuild.mjs run as part of `pnpm build`?')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('verify:pages: dist/.nojekyll present, dist/404.html matches dist/index.html')
