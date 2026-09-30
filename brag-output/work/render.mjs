import { createRequire } from "module";
const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const [,, mode, ...args] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("file://" + process.cwd() + "/index.html");
await page.evaluate(() => window.ready);
await page.waitForTimeout(300);
const fs = await import("fs");
if (mode === "stills") {
  fs.mkdirSync("stills", { recursive: true });
  for (const t of args) { await page.evaluate((t) => render(t), +t); await page.screenshot({ path: `stills/t${(+t).toFixed(2)}.jpg`, type: "jpeg", quality: 80 }); }
} else {
  // motion blur: S sub-frames across a 180° shutter
  const S = 6; fs.mkdirSync("sub", { recursive: true });
  for (let i = +args[0]; i < +args[1]; i++) for (let k = 0; k < S; k++) {
    await page.evaluate((t) => render(t), (i + (k / S - 0.25) * 0.5) / 30);
    await page.screenshot({ path: `sub/f${String(i).padStart(4, "0")}_${k}.jpg`, type: "jpeg", quality: 95 });
  }
}
await browser.close();
