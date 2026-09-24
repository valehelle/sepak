import { expect, test } from '@playwright/test'
import { createTestSession, dropTestSession } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(900 + Math.floor(Math.random() * 90))
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('a pasted session link opens directly', async ({ page }) => {
  // This is the WhatsApp case: a cold navigation straight to a nested route.
  // In production this path is a real file carrying the session's own share
  // tags (scripts/sessionPages.mjs); here it exercises the 404.html
  // fallback, which is what a session created since the last build gets.
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
})

test('refreshing a session page keeps it working', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await page.reload()
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await expect(page.getByText('Team Merah')).toBeVisible()
})

test('a link with a trailing slash opens the same session', async ({ page }) => {
  // GitHub Pages redirects `/s/<id>` to `/s/<id>/` to serve the generated
  // directory index, so the app has to route the slashed form too.
  await page.goto(`s/${sessionId}/`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
})

test('an unknown session id says so instead of breaking', async ({ page }) => {
  await page.goto('s/11111111-1111-4111-8111-999999999999')
  await expect(page.getByText('Sesi tak dijumpai.')).toBeVisible()
})
