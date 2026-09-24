import { expect, test } from '@playwright/test'
import { admin, createTestSession, dropTestSession } from './fixtures'

let sessionId = ''

test.beforeEach(async () => {
  sessionId = await createTestSession(800 + Math.floor(Math.random() * 100))
})

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('a player claims, sees, and releases a slot', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('E2E Geng')).toBeVisible()
  await expect(page.getByText('0/44 penuh')).toBeVisible()

  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()

  await expect(page.getByText('Hazmi')).toBeVisible()
  await expect(page.getByText('1/44 penuh')).toBeVisible()
  await expect(page.getByText(/Slot anda: Team Merah — GK/)).toBeVisible()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  // Emptying a slot arms first: one tap is a mis-tap away from losing it.
  await page.getByRole('button', { name: 'Lepaskan slot' }).click()
  await page.getByRole('button', { name: 'Ya, lepaskan slot' }).click()
  await expect(page.getByText('0/44 penuh')).toBeVisible()
})

test('a player ticks their own slot as paid, and the tick shows on the pitch', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText(/Belum bayar/)).toBeVisible()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  await page.getByRole('button', { name: 'Dah bayar', exact: true }).click()

  // The badge is on the chip, so the accessible name is what proves it.
  await expect(page.getByRole('button', { name: /GK.*Hazmi.*dah bayar/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dah bayar', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Untickable, and the summary panel follows.
  await page.getByRole('button', { name: 'Dah bayar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dah bayar', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByText(/Belum bayar/)).toBeVisible()
})

test('a claim appears live in another browser', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageTwo.goto(`s/${sessionId}`)

  await pageOne.getByRole('button', { name: /^ST/ }).first().click()
  await pageOne.getByLabel('Nama').fill('Zulazhar')
  await pageOne.getByLabel('Nombor telefon').fill('012-345 6789')
  await pageOne.getByRole('button', { name: 'Ambil slot' }).click()

  // No reload: realtime must deliver it.
  await expect(pageTwo.getByText('Zulazhar')).toBeVisible({ timeout: 10_000 })

  await one.close()
  await two.close()
})

test('two players racing one slot: one wins, the other is told', async ({ browser }) => {
  const one = await browser.newContext()
  const two = await browser.newContext()
  const pageOne = await one.newPage()
  const pageTwo = await two.newPage()

  await pageOne.goto(`s/${sessionId}`)
  await pageTwo.goto(`s/${sessionId}`)

  // Distinct numbers, because these are two different people: one booking
  // per phone per session (0010_one_booking_per_person.sql). Sharing one
  // would make the loser fail on the phone rule instead of losing the race.
  for (const [page, name, phone] of [
    [pageOne, 'Isaac', '012-345 6789'],
    [pageTwo, 'Kimie', '019-876 5432'],
  ] as const) {
    await page.getByRole('button', { name: /^MC/ }).first().click()
    await page.getByLabel('Nama').fill(name)
    await page.getByLabel('Nombor telefon').fill(phone)
  }

  await Promise.all([
    pageOne.getByRole('button', { name: 'Ambil slot' }).click(),
    pageTwo.getByRole('button', { name: 'Ambil slot' }).click(),
  ])

  // `.or()` only combines locators within one frame, so the two pages'
  // toasts are awaited independently and the result combined by hand:
  // exactly one of the two browsers must see the loser toast.
  const sawLoserToast = (page: typeof pageOne) =>
    page
      .getByRole('status')
      .filter({ hasText: 'Slot dah diambil.' })
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)

  const [oneLost, twoLost] = await Promise.all([sawLoserToast(pageOne), sawLoserToast(pageTwo)])
  expect(oneLost).not.toBe(twoLost)

  // Exactly one name landed.
  await expect(pageOne.getByText('1/44 penuh')).toBeVisible({ timeout: 10_000 })

  await one.close()
  await two.close()
})

test('a closed session is read-only', async ({ page }) => {
  const { error } = await admin().from('sessions').update({ status: 'closed' }).eq('id', sessionId)
  if (error !== null) throw new Error(`failed to close session: ${error.message}`)

  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('Sesi ditutup')).toBeVisible()
  await expect(page.getByRole('button', { name: /^GK/ }).first()).toBeDisabled()
})

test('a player switches position, keeping the paid tick', async ({ page }) => {
  await page.goto(`s/${sessionId}`)

  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText(/Slot anda: Team Merah — GK/)).toBeVisible()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  await page.getByRole('button', { name: 'Dah bayar', exact: true }).click()
  await page.keyboard.press('Escape')
  // Closing the claim sheet surfaces the queued group prompt for that tick.
  await page.getByRole('button', { name: 'Tutup' }).click()

  // An empty slot is the picker: the page says so rather than locking it.
  await expect(page.getByText(/Nak tukar posisi/)).toBeVisible()
  await page.getByRole('button', { name: /^ST — kosong/ }).first().click()
  // Scoped to the sheet: the summary panel behind it says the same words.
  await expect(
    page.getByRole('dialog').getByText('Team Merah — GK', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Pindah ke sini' }).click()

  await expect(page.getByText(/Slot anda: Team Merah — ST/)).toBeVisible()
  // The tick travelled, and the slot left behind is empty again.
  await expect(page.getByRole('button', { name: /ST.*Hazmi.*dah bayar/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^GK — kosong/ }).first()).toBeVisible()
  await expect(page.getByText('1/44 penuh')).toBeVisible()
})

test('releasing offers the group message, with the freed position named', async ({ page }) => {
  await page.goto(`s/${sessionId}`)

  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText(/Slot anda: Team Merah — GK/)).toBeVisible()
  // A claim must not prompt: during the opening rush it would fire per player.
  await expect(page.getByText('Senarai dah berubah')).not.toBeVisible()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  await page.getByRole('button', { name: 'Lepaskan slot' }).click()
  await page.getByRole('button', { name: 'Ya, lepaskan slot' }).click()

  await expect(page.getByText('Senarai dah berubah')).toBeVisible()
  await expect(page.getByText('🔴 Team Merah — GK: Hazmi → kosong')).toBeVisible()
  // The sheet shows the one line, never the forty-line paste behind it.
  await expect(page.getByRole('dialog')).not.toContainText('Team Putih')
  await page.getByRole('button', { name: 'Tutup' }).click()
  await expect(page.getByText('Senarai dah berubah')).not.toBeVisible()
})

test('the paid tick can still be undone before the group prompt appears', async ({ page }) => {
  await page.goto(`s/${sessionId}`)
  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Hazmi')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()

  await page.getByRole('button', { name: /GK.*Hazmi/ }).click()
  await page.getByRole('button', { name: 'Dah bayar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dah bayar', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The prompt must not cover the toggle that undoes a mis-tap.
  await expect(page.getByText('Senarai dah berubah')).not.toBeVisible()

  await page.getByRole('button', { name: 'Dah bayar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dah bayar', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('sheet-backdrop').click()

  // Ticked then un-ticked is a no-op, so the group is told nothing at all.
  await expect(page.getByText('Senarai dah berubah')).not.toBeVisible()
})
