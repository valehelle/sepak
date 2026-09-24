import { expect, test } from '@playwright/test'
import { createTestSession, dropTestSession, fillAllSlotsExcept } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(600 + Math.floor(Math.random() * 90))
  await fillAllSlotsExcept(sessionId, 'A', 'GK')
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

// Scope, honestly stated: headless Chromium reports Notification.permission
// as "denied" whatever is granted to the context, so the browser-notification
// path cannot be driven from here -- that branch is covered in
// src/components/NotifySheet.test.tsx. What this proves is the wiring that
// only a real database can: queueing offers the sheet, and "Guna Telegram"
// mints a real one-time code and opens a t.me link built from it. Delivery
// itself needs a real phone.
test('queueing offers notifications, and Telegram opens a link carrying a fresh code', async ({
  page,
  browser,
}) => {
  await page.goto(`s/${sessionId}`)
  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText('44/44 penuh')).toBeVisible()

  // A second browser: this device holds a slot now and cannot also queue.
  const second = await browser.newContext()
  const queued = await second.newPage()

  await queued.goto(`s/${sessionId}`)
  await queued.getByRole('button', { name: 'Sertai senarai tunggu' }).click()
  await queued.getByLabel('Nama').fill('Isaac')
  await queued.getByLabel('Nombor telefon').fill('019-876 5432')
  await queued.getByRole('button', { name: 'GK', exact: true }).click()
  await queued.getByRole('button', { name: 'Sertai', exact: true }).click()

  // The sheet arrives by itself, the moment they are in the queue, and
  // Telegram leads because it is the option that works on every phone.
  const sheet = queued.getByRole('dialog', { name: 'Beritahu saya bila naik' })
  await expect(sheet).toBeVisible()
  await expect(queued.getByRole('button', { name: 'Guna Telegram' })).toBeVisible()

  const opened = second.waitForEvent('page')
  await queued.getByRole('button', { name: 'Guna Telegram' }).click()
  const telegram = await opened
  // A real code from the database, and not the claim token.
  expect(telegram.url()).toMatch(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[0-9a-f-]{36}$/)
  await telegram.close()

  // Back on the page, it now waits to be told Start was pressed -- Telegram
  // cannot tell us.
  await expect(queued.getByRole('button', { name: 'Dah tekan Start' })).toBeVisible()
  await queued.getByRole('button', { name: 'Dah tekan Start' }).click()
  await expect(queued.getByText(/Belum sambung/)).toBeVisible()

  await second.close()
})
