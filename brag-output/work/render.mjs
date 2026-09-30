import { createRequire } from "module";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const [,, mode, ...times] = process.argv; // mode: stills | frames
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("file://" + process.cwd() + "/index.html");
await page.evaluate(() => window.ready);
await page.waitForTimeout(300);
const fs = await import("fs");
if (mode === "stills") {
  fs.mkdirSync("stills", { recursive: true });
  for (const t of times) {
    await page.evaluate((t) => render(t), +t);
    await page.screenshot({ path: `stills/t${(+t).toFixed(2)}.jpg`, type: "jpeg", quality: 80 });
  }
} else {
  fs.mkdirSync("frames", { recursive: true });
  const N = 600, [a, b] = [+(times[0] ?? 0), +(times[1] ?? N)];
  for (let i = a; i < b; i++) {
    await page.evaluate((t) => render(t), i / 30);
    await page.screenshot({ path: `frames/f${String(i).padStart(4, "0")}.jpg`, type: "jpeg", quality: 94 });
  }
}
await browser.close();
