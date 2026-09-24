import { expect, test } from '@playwright/test'
import { admin, createTestSession, dropTestSession } from './fixtures'

let sessionId = ''

test.afterEach(async () => {
  await dropTestSession(sessionId)
})

test('the slots open by themselves at the time, without a reload', async ({ page }) => {
  sessionId = await createTestSession(700 + Math.floor(Math.random() * 100), new Date(Date.now() + 6000))
  await page.goto(`s/${sessionId}`)

  await expect(page.getByText('Dibuka dalam')).toBeVisible()
  await expect(page.getByRole('button', { name: /^GK/ }).first()).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Sertai senarai tunggu' })).toHaveCount(0)

  // No reload anywhere below: the page has to get there on its own.
  await expect(page.getByRole('button', { name: 'Sertai senarai tunggu' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Dibuka dalam')).toHaveCount(0)

  await page.getByRole('button', { name: /^GK/ }).first().click()
  await page.getByLabel('Nama').fill('Tepat')
  await page.getByLabel('Nombor telefon').fill('012-345 6789')
  await page.getByRole('button', { name: 'Ambil slot' }).click()
  await expect(page.getByText(/Slot anda: Team Merah — GK/)).toBeVisible()
})

test('a moved opening time reaches a page that is already open', async ({ page }) => {
  sessionId = await createTestSession(700 + Math.floor(Math.random() * 100), new Date(Date.now() + 60 * 60 * 1000))
  await page.goto(`s/${sessionId}`)
  await expect(page.getByText('Dibuka dalam')).toBeVisible()
  // Let the live connection come up before the change is made.
  await page.waitForTimeout(1500)

  const later = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const { error } = await admin().from('sessions').update({ opens_at: later.toISOString() }).eq('id', sessionId)
  expect(error).toBeNull()

  await expect(page.getByText(/Masa dibuka ditukar ke/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/^0?[23]:\d\d:\d\d$/)).toBeVisible()
})
