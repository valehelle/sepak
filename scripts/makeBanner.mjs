// Generates the 640x360 card Telegram shows above the bot's description --
// the screen somebody sees before they press Start.
//
//   pnpm banner
//
// Same approach as makeIcons.mjs: drawn in a real browser so it can use
// Barlow Condensed, the app's own display face. Needs the network, is not
// part of `pnpm build`, and writes outside public/ because this file is for
// BotFather, not for the site bundle.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'brand')

// Telegram's stated size for a description picture. Anything else is
// re-encoded by them, so match it exactly.
const WIDTH = 640
const HEIGHT = 360

const NIGHT = '#0a1017'
const BIBS = ['#c8372d', '#f2f0e9', '#e8b62c']

/** Unlike the icon, a card this size has room for the real name, so the name
 *  leads and the monogram is left out -- repeating both would say the same
 *  thing twice. */
function drawBanner(args) {
  const [{ width, height }, night, bibs] = args
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no 2d context')

  ctx.fillStyle = night
  ctx.fillRect(0, 0, width, height)

  const word = 'GENG TURUN PELUH'
  const tracking = 0.03

  // Fitted rather than guessed: the word is long, and a hard-coded size that
  // looks right here would overflow the moment the name changes.
  const target = width * 0.78
  let fontSize = height * 0.2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  for (let pass = 0; pass < 6; pass += 1) {
    ctx.font = `700 ${fontSize}px 'Barlow Condensed'`
    ctx.letterSpacing = `${fontSize * tracking}px`
    const measured = ctx.measureText(word).width
    if (measured === 0) break
    fontSize *= target / measured
  }
  ctx.font = `700 ${fontSize}px 'Barlow Condensed'`
  ctx.letterSpacing = `${fontSize * tracking}px`

  // Optically centred on the cap-height box: the whole group sits slightly
  // above the true middle, which is where the eye expects it.
  const baseline = height * 0.52
  ctx.fillStyle = '#ffffff'
  ctx.fillText(word, width / 2, baseline)

  // The three bibs as one rule, sized off the word so the pair reads as a
  // single object -- the same relationship the app icon uses.
  const ruleWidth = ctx.measureText(word).width
  const ruleHeight = Math.max(3, height * 0.028)
  const ruleY = baseline + height * 0.055
  const band = ruleWidth / bibs.length
  bibs.forEach((colour, index) => {
    ctx.fillStyle = colour
    ctx.fillRect(width / 2 - ruleWidth / 2 + band * index, ruleY, band, ruleHeight)
  })

  // One line saying what the bot is for, since this card is the only thing
  // on screen before Start.
  const subSize = height * 0.062
  ctx.font = `500 ${subSize}px 'Barlow Condensed'`
  ctx.letterSpacing = `${subSize * 0.04}px`
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('Notifikasi senarai tunggu', width / 2, ruleY + ruleHeight + height * 0.12)

  return canvas.toDataURL('image/png')
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(
  `<!doctype html><html><head>
     <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&display=swap">
   </head><body></body></html>`,
  { waitUntil: 'load' },
)
// Without this the first paint can fall back to another face, silently and
// only sometimes.
await page.evaluate(() =>
  Promise.all([
    document.fonts.load("700 100px 'Barlow Condensed'"),
    document.fonts.load("500 100px 'Barlow Condensed'"),
  ]).then(() => document.fonts.ready),
)

const dataUrl = await page.evaluate(drawBanner, [{ width: WIDTH, height: HEIGHT }, NIGHT, BIBS])
await mkdir(OUT, { recursive: true })
const file = join(OUT, 'telegram-banner.png')
await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
console.log(`banner: wrote brand/telegram-banner.png (${WIDTH}x${HEIGHT})`)

await browser.close()
