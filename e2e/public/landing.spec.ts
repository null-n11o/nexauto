import { expect, test } from '@playwright/test'

test('public LP exposes features, real screenshots, FAQ and app entry', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('SNS運用を、')
  await expect(page).toHaveTitle(/NexAuto/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await page.getByRole('link', { name: '実際の画面を見る', exact: true }).click()
  await expect(page).toHaveURL(/#screens$/)
  for (const src of ['/landing/posts.png', '/landing/analytics.png']) {
    const image = page.locator(`#screens img[src*="${encodeURIComponent(src)}"]`)
    await image.scrollIntoViewIfNeeded()
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  }
  const faq = page.locator('details').first()
  await faq.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(faq).toHaveAttribute('open', '')
  await expect(faq).toContainText('Threads・X')
  await page.getByRole('link', { name: 'ログイン', exact: true }).first().click()
  await expect(page).toHaveURL('/app/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect(errors).toEqual([])
})

for (const width of [375, 390, 768, 1024, 1440]) {
  test(`LP fits ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

for (const path of ['/app', '/app/posts', '/app/analytics', '/app/analytics/reports/example', '/app/accounts', '/app/publishing', '/app/users', '/app/companies']) {
  test(`anonymous access to ${path} requires login`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(new URL(response.headers().location, response.url()).pathname).toBe('/app/login')
  })
}

test('legacy URLs redirect under /app and preserve queries and recovery fragments', async ({ page, request }) => {
  for (const path of ['/posts', '/login', '/accounts/example', '/analytics/reports/example', '/reset-password']) {
    const response = await request.get(`${path}?source=bookmark`, { maxRedirects: 0 })
    expect(response.status()).toBe(308)
    expect(response.headers().location).toBe(`/app${path}?source=bookmark`)
  }
  await page.goto('/reset-password#recovery')
  await expect(page).toHaveURL('/app/reset-password#recovery')
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
})
