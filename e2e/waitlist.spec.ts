import { expect, test } from '@playwright/test'
import { createTestSession, dropTestSession, fillAllSlotsExcept } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(700 + Math.floor(Math.random() * 90))
  // Every GK slot but Team A's is taken, so GK is scarce the moment Team
  // A's is claimed too -- exactly the setup the auto-fill scenario needs.
  await fillAllSlotsExcept(sessionId, 'A', 'GK')
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('auto-fill reaches a second browser over realtime, without a reload', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageOne.getByRole('button', { name: /^GK/ }).first().click()
  await pageOne.getByLabel('Nama').fill('Hazmi')
  await pageOne.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(pageOne.getByText('33/33 penuh')).toBeVisible()

  // The session is now completely full -- the second browser has to queue.
  await pageTwo.goto(`s/${sessionId}`)
  await expect(pageTwo.getByText('33/33 penuh')).toBeVisible()
  await pageTwo.getByRole('button', { name: 'Sertai senarai tunggu' }).click()
  await pageTwo.getByLabel('Nama').fill('Isaac')
  await pageTwo.getByRole('button', { name: 'GK', exact: true }).click()
  await pageTwo.getByRole('button', { name: 'Sertai', exact: true }).click()

  // Confirms the queue really did form before the release below -- without
  // this, a bug that always claims immediately would make the test pass
  // for the wrong reason.
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).toBeVisible()
  await expect(pageTwo.getByText(/1\. Isaac/)).toBeVisible()

  await pageOne.getByRole('button', { name: /^GK.*Hazmi/ }).click()
  await pageOne.getByRole('button', { name: 'Lepaskan slot' }).click()

  // No reload on pageTwo: realtime must deliver both the slot filling and
  // the queue shrinking.
  await expect(pageTwo.getByText('Isaac')).toBeVisible({ timeout: 10_000 })
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).not.toBeVisible()
  await expect(pageTwo.getByText(/Slot anda: Team A Merah — GK/)).toBeVisible()

  await one.close()
  await two.close()
})
