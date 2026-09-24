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
  await pageOne.getByLabel('Nombor telefon').fill('012-345 6789')
  await pageOne.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(pageOne.getByText('44/44 penuh')).toBeVisible()

  // The session is now completely full -- the second browser has to queue.
  await pageTwo.goto(`s/${sessionId}`)
  await expect(pageTwo.getByText('44/44 penuh')).toBeVisible()
  await pageTwo.getByRole('button', { name: 'Sertai senarai tunggu' }).click()
  await pageTwo.getByLabel('Nama').fill('Isaac')
  // Isaac's own number: one booking per phone per session.
  await pageTwo.getByLabel('Nombor telefon').fill('019-876 5432')
  await pageTwo.getByRole('button', { name: 'GK', exact: true }).click()
  await pageTwo.getByRole('button', { name: 'Sertai', exact: true }).click()

  // Joining the queue now offers notifications straight away. Dismissed with
  // Escape rather than a named button: which button the sheet shows depends
  // on what the browser supports, and this test is about auto-fill.
  await pageTwo.keyboard.press('Escape')

  // Confirms the queue really did form before the release below -- without
  // this, a bug that always claims immediately would make the test pass
  // for the wrong reason.
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).toBeVisible()
  await expect(pageTwo.getByText(/1\. Isaac/)).toBeVisible()

  await pageOne.getByRole('button', { name: /^GK.*Hazmi/ }).click()
  await pageOne.getByRole('button', { name: 'Lepaskan slot' }).click()
  await pageOne.getByRole('button', { name: 'Ya, lepaskan slot' }).click()

  // No reload on pageTwo: realtime must deliver both the slot filling and
  // the queue shrinking.
  await expect(pageTwo.getByText('Isaac')).toBeVisible({ timeout: 10_000 })
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).not.toBeVisible()
  await expect(pageTwo.getByText(/Slot anda: Team A Merah — GK/)).toBeVisible()

  await one.close()
  await two.close()
})

test('a queued player takes an open slot by hand, even one they never asked for', async ({
  browser,
}) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageOne.getByRole('button', { name: /^GK/ }).first().click()
  await pageOne.getByLabel('Nama').fill('Hazmi')
  await pageOne.getByLabel('Nombor telefon').fill('012-345 6789')
  await pageOne.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(pageOne.getByText('44/44 penuh')).toBeVisible()

  // Isaac queues for ST, which is nowhere near the slot that is about to
  // open -- so auto-fill will not hand it to him.
  await pageTwo.goto(`s/${sessionId}`)
  await pageTwo.getByRole('button', { name: 'Sertai senarai tunggu' }).click()
  await pageTwo.getByLabel('Nama').fill('Isaac')
  await pageTwo.getByLabel('Nombor telefon').fill('019-876 5432')
  await pageTwo.getByRole('button', { name: 'ST', exact: true }).click()
  await pageTwo.getByRole('button', { name: 'Sertai', exact: true }).click()
  // Dismissed by its own button, not Escape: the notification sheet lays a
  // backdrop over the pitch, and text behind a backdrop still reads as
  // visible while being unclickable.
  await pageTwo.getByRole('button', { name: 'Tak perlu' }).click()
  await expect(pageTwo.getByRole('button', { name: 'Tak perlu' })).not.toBeVisible()
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).toBeVisible()

  await pageOne.getByRole('button', { name: /^GK.*Hazmi/ }).click()
  await pageOne.getByRole('button', { name: 'Lepaskan slot' }).click()
  await pageOne.getByRole('button', { name: 'Ya, lepaskan slot' }).click()

  // GK opens and stays open: Isaac asked for ST, so nobody is promoted.
  await expect(pageTwo.getByText('43/44 penuh')).toBeVisible({ timeout: 10_000 })
  await expect(pageTwo.getByText(/anda boleh terus ambil mana-mana slot kosong/)).toBeVisible()

  // Being queued does not stop him claiming it himself -- claim_slot
  // consumes his own queue entry as part of the claim.
  await pageTwo.getByRole('button', { name: /^GK — kosong/ }).first().click()
  await pageTwo.getByLabel('Nama').fill('Isaac')
  await pageTwo.getByLabel('Nombor telefon').fill('019-876 5432')
  await pageTwo.getByRole('button', { name: 'Ambil slot' }).click()

  await expect(pageTwo.getByText(/Slot anda: Team A Merah — GK/)).toBeVisible()
  await expect(pageTwo.getByText('Anda dalam senarai tunggu')).not.toBeVisible()

  await one.close()
  await two.close()
})
