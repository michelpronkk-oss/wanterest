// Static UI review only. This is not an application route or authenticated session.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve("out/admin-design-review");
const routes = {
  overview: "Overview · unavailable sources", "early-access": "Early Access · unavailable source",
  operations: "Operations · unavailable sources", "system-map": "System Map · unknown observations",
  "search-not-configured": "Search Console · not configured", "search-empty": "Search Console · no settled rows",
  "search-settled": "Search Console · populated test fixture", "search-provisional": "Search Console · provisional test fixture",
  "search-error": "Search Console · provider error", "search-zero": "Search Console · returned zero values",
  login: "Login", "login-error": "Login · error", recovery: "Password recovery", "recovery-sent": "Password recovery · confirmation",
  "mfa-new": "MFA · new enrollment", "mfa-resume": "MFA · resume enrollment", "mfa-challenge": "MFA · challenge",
};
if (!existsSync(resolve(directory, "overview.html"))) throw new Error("Generate presentation fixtures first; see docs/admin-ui-refinement.md.");
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Wanterest Admin · local design review</title><style>body{max-width:1000px;margin:60px auto;padding:0 24px;background:#f7f6f1;color:#111110;font:16px/1.7 Arial}h1{font-size:42px;line-height:1.1;letter-spacing:-.05em}p{max-width:720px}ul{padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}li{padding:20px;border:1px solid #deded5;background:#fffefa}a{color:inherit;text-underline-offset:4px}small{display:block;margin-top:12px;color:#55584c}strong{background:#d7ff3d;padding:4px 8px}</style></head><body><strong>LOCAL PRESENTATION REVIEW</strong><h1>Wanterest Admin</h1><p>Real components rendered with isolated test inputs. Populated Search Console examples are visibly labelled synthetic fixtures, not production measurements. No production connection or authenticated session is used. Forms are static and do not submit.</p><p><a href="http://127.0.0.1:3102/login">Open the actual local Admin login</a> (requires the separately running app).</p><ul>${Object.entries(routes).map(([file, label]) => `<li><a href="/${file}.html">${label}</a><small><a href="/${file}-1440.png">Desktop screenshot</a> · <a href="/${file}-390.png">Mobile screenshot</a></small></li>`).join("")}</ul></body></html>`;
createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(gallery); return; }
  const name = pathname.slice(1);
  const extension = name.split(".").pop();
  const types = { html: "text/html; charset=utf-8", css: "text/css", ttf: "font/ttf", png: "image/png" };
  if (!/^[a-zA-Z0-9-]+\.(html|css|ttf|png)$/.test(name) || !existsSync(resolve(directory, name))) { response.writeHead(404); response.end(); return; }
  response.setHeader("Content-Type", types[extension]);
  response.end(readFileSync(resolve(directory, name)));
}).listen(3101, "127.0.0.1", () => console.log("Local presentation gallery: http://127.0.0.1:3101 (test fixtures only)"));
