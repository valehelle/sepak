// Generates the PWA icons from code, so they can be regenerated rather than
// being mystery binaries somebody once exported from a design tool.
//
//   pnpm icons
//
// Rendered in a real browser (Playwright is already a devDependency) because
// the mark is set in Barlow Condensed, the app's own display face, loaded
// from the same Google Fonts stylesheet src/index.css uses. That means this
// script needs the network; it is a deliberate, occasional build step and is
// NOT part of `pnpm build` or CI.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')

const NIGHT = '#0a1017'
const BIBS = ['#c8372d', '#f2f0e9', '#e8b62c']

/** Every size we ship, and how much of the tile the mark may occupy.
 *
 *  A maskable icon is cropped to a circle by Android, which keeps only the
 *  centre 80% -- the safe zone. So the maskable variant draws the same mark
 *  smaller, on a full bleed of night, rather than being a separate design.
 *  The others are drawn edge to edge with a rounded tile, which is what iOS
 *  and desktop expect. */
const TARGETS = [
  { file: 'icon-192.png', size: 192, safe: 1, radius: 0.22 },
  { file: 'icon-512.png', size: 512, safe: 1, radius: 0.22 },
  { file: 'icon-maskable-512.png', size: 512, safe: 0.8, radius: 0 },
  // iOS ignores the manifest for the home-screen icon and takes this one,
  // which must be square with no transparency -- hence radius 0.
  { file: 'apple-touch-icon.png', size: 180, safe: 1, radius: 0 },
]

/** Draws one tile on a canvas in the page and returns it as a data URL. The
 *  whole mark is three letters over a three-colour rule: it has to survive
 *  being 48 CSS pixels wide on a home screen, which is where photographs and
 *  fine detail die. */
function drawIcon(args) {
  // One argument, because that is all page.evaluate passes.
  const [{ size, safe, radius }, night, bibs] = args
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no 2d context')

  // Background: a rounded tile, or full bleed when the platform crops it.
  ctx.fillStyle = night
  if (radius > 0) {
    const r = size * radius
    ctx.beginPath()
    ctx.roundRect(0, 0, size, size, r)
    ctx.fill()
  } else {
    ctx.fillRect(0, 0, size, size)
  }

  const inner = size * safe
  const pad = (size - inner) / 2

  // GTP, optically centred: the cap-height box, not the font's line box, is
  // what the eye reads as the middle.
  const fontSize = inner * 0.42
  ctx.font = `700 ${fontSize}px 'Barlow Condensed'`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.letterSpacing = `${inner * 0.02}px`
  const baseline = pad + inner * 0.585
  ctx.fillText('GTP', size / 2, baseline)

  // The three bibs as one rule under the word, sized off the word rather
  // than the tile so the pair reads as a single object.
  const ruleWidth = ctx.measureText('GTP').width * 1.06
  const ruleHeight = Math.max(2, inner * 0.055)
  const ruleY = baseline + inner * 0.085
  const band = ruleWidth / bibs.length
  bibs.forEach((colour, index) => {
    ctx.fillStyle = colour
    ctx.fillRect(size / 2 - ruleWidth / 2 + band * index, ruleY, band, ruleHeight)
  })

  return canvas.toDataURL('image/png')
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(
  `<!doctype html><html><head>
     <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&display=swap">
   </head><body></body></html>`,
  { waitUntil: 'load' },
)
// Without this the first paint can use a fallback face and the mark comes out
// in the wrong font -- silently, and only sometimes.
await page.evaluate(() => document.fonts.load("700 100px 'Barlow Condensed'").then(() => document.fonts.ready))

await mkdir(PUBLIC, { recursive: true })
for (const target of TARGETS) {
  const dataUrl = await page.evaluate(drawIcon, [target, NIGHT, BIBS])
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  await writeFile(join(PUBLIC, target.file), Buffer.from(base64, 'base64'))
  console.log(`icons: wrote public/${target.file} (${target.size}px)`)
}

await browser.close()
