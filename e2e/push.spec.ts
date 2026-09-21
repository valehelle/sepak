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
// as "denied" whatever is granted to the context, so the accept path cannot
// be driven from here -- that branch is covered in
// src/components/PushPrompt.test.tsx. What this proves is the wiring: the
// offer appears at the right moment, says the right thing for a browser that
// has blocked notifications, and stays reachable afterwards. Delivery itself
// needs a real push service and a real phone.
test('queueing offers notifications, explains a blocked browser, and keeps the offer reachable', async ({
  page,
  browser,
}) => {
  await page.goto(`s/${sessionId}`)
  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText('33/33 penuh')).toBeVisible()

  // A second browser: this device holds a slot now and cannot also queue.
  const second = await browser.newContext()
  const queued = await second.newPage()

  await queued.goto(`s/${sessionId}`)
  await queued.getByRole('button', { name: 'Sertai senarai tunggu' }).click()
  await queued.getByLabel('Nama').fill('Isaac')
  await queued.getByLabel('Nombor telefon').fill('019-876 5432')
  await queued.getByRole('button', { name: 'GK', exact: true }).click()
  await queued.getByRole('button', { name: 'Sertai', exact: true }).click()

  // The offer arrives by itself, the moment they are in the queue.
  const sheet = queued.getByRole('dialog', { name: 'Beritahu saya bila naik' })
  await expect(sheet).toBeVisible()
  // ...and in a browser that has blocked notifications it says so rather
  // than offering a button that cannot work.
  await expect(queued.getByText(/disekat untuk laman ni/)).toBeVisible()
  await expect(queued.getByRole('button', { name: 'Ya, beritahu saya' })).toHaveCount(0)

  await queued.getByRole('button', { name: 'Tutup' }).click()
  await expect(sheet).toBeHidden()

  // Still reachable: on iOS the first tap only yields install instructions,
  // so this button is the way back.
  await queued.getByRole('button', { name: 'Beritahu saya bila naik' }).click()
  await expect(sheet).toBeVisible()

  await second.close()
})
