// Run after ADMIN_DESIGN_REVIEW=1 npx vitest run tests/admin/presentation.test.tsx.
// Uses local, labelled test renderings only. No production requests or auth bypass.
import { chromium } from "playwright";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = resolve("out/admin-design-review");
const files = readdirSync(directory).filter((file) => file.endsWith(".html") && file !== "index.html");
if (files.length === 0) throw new Error("Generate the presentation fixtures first.");
const browser = await chromium.launch({ headless: true });
const problems = [];
const results = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => problems.push({ browserError: error.message }));
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 680 ? 1000 : 844 });
    for (const file of files) {
      await page.goto(pathToFileURL(resolve(directory, file)).href);
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector("h1")?.textContent,
        fontsLoaded: document.fonts.check("400 15px Inter"),
        mainCount: document.querySelectorAll("main").length,
      }));
      results.push({ file, width, ...state });
      if (state.scrollWidth > width + 1 || !state.fontsLoaded || state.mainCount !== 1) problems.push({ file, width, ...state });
      if ([1440, 390].includes(width)) await page.screenshot({ path: resolve(directory, file.replace(".html", "") + "-" + width + ".png"), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pathToFileURL(resolve(directory, "search-settled.html")).href);
  const summary = page.locator(".mobile-navigation summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  if (!await page.locator('.mobile-navigation a[href="/system-map"]').isVisible()) problems.push({ keyboard: "Mobile menu failed to open" });
  await page.screenshot({ path: resolve(directory, "mobile-navigation-open.png"), fullPage: false });
  await page.keyboard.press("Enter");
  if (await page.locator('.mobile-navigation a[href="/system-map"]').isVisible()) problems.push({ keyboard: "Mobile menu failed to close" });

  const table = page.locator('[aria-label="Scrollable Search Console query results"]');
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.querySelector('[aria-label="Scrollable Search Console query results"]').scrollLeft > 0);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(pathToFileURL(resolve(directory, "search-settled.html")).href);
  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement?.textContent) !== "Skip to content") problems.push({ keyboard: "Skip link is not first" });
  await page.keyboard.press("Enter");
  if (await page.evaluate(() => document.activeElement?.id) !== "admin-content") problems.push({ keyboard: "Skip link target is not focused" });

  await page.getByRole("link", { name: "Opportunities", exact: true }).click();
  if (!page.url().endsWith("#opportunities")) problems.push({ navigation: "Section link failed" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.locator(".nav-item").first().evaluate((node) => getComputedStyle(node).transitionDuration);
  if (motion !== "0s") problems.push({ accessibility: "Reduced motion preference not respected" });
} finally {
  await browser.close();
}
writeFileSync(resolve(directory, "browser-results.json"), JSON.stringify({ results, problems }, null, 2));
console.log(JSON.stringify({ renders: results.length, problems }, null, 2));
if (problems.length) process.exitCode = 1;
