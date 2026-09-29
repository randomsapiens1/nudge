import { normalizeUrl } from "./images.js";

/**
 * Headless screenshot of a URL. Prefers the locally installed Google Chrome so no
 * browser download is needed; falls back to Playwright's bundled Chromium.
 */
export async function captureUrl(url: string, fullPage = false): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      throw new Error(
        "No browser found for screenshots. Install Google Chrome or run: npx playwright install chromium",
      );
    }
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: fullPage ? 1 : 2,
    });
    await page.goto(normalizeUrl(url), { waitUntil: "load", timeout: 20_000 });
    await page.waitForTimeout(800); // let client-side rendering settle
    return await page.screenshot({ fullPage, type: "png" });
  } finally {
    await browser.close();
  }
}
