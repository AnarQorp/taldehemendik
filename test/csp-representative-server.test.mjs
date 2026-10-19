import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

test("CSP Representative Server & Effective Policy Verification", async () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

  // Representative server mimicking production reverse proxy (e.g., Caddy/Nginx)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let filePath;
    let contentType = "text/plain";

    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = path.join(projectRoot, "index.html");
      contentType = "text/html; charset=utf-8";
    } else {
      filePath = path.join(projectRoot, url.pathname.replace(/^\//, ""));
      if (url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")) {
        contentType = "application/javascript; charset=utf-8";
      } else if (url.pathname.endsWith(".css")) {
        contentType = "text/css; charset=utf-8";
      } else if (url.pathname.endsWith(".json")) {
        contentType = "application/json; charset=utf-8";
      }
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const content = fs.readFileSync(filePath);

    // Production security headers
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' http://127.0.0.1:8000 http://localhost:8000 http://127.0.0.1:3101 http://localhost:3101 https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(content);
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/`;

  try {
    // 1. Fetch via HTTP and verify Headers
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200, "Server must respond with HTTP 200");

    const cspHeader = response.headers.get("content-security-policy");
    assert.ok(cspHeader, "HTTP Content-Security-Policy header must be present");
    assert.ok(cspHeader.includes("frame-ancestors 'none'"), "HTTP header must enforce frame-ancestors 'none'");
    assert.ok(cspHeader.includes("object-src 'none'"), "HTTP header must enforce object-src 'none'");

    const xfo = response.headers.get("x-frame-options");
    assert.equal(xfo, "DENY", "X-Frame-Options must be DENY");

    const xcto = response.headers.get("x-content-type-options");
    assert.equal(xcto, "nosniff", "X-Content-Type-Options must be nosniff");

    // 2. Verify HTML Meta-Directives in served body
    const body = await response.text();
    const metaMatch = body.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    assert.ok(metaMatch, "Served HTML must contain Content-Security-Policy meta tag");

    const metaCsp = metaMatch[1];
    assert.ok(metaCsp.includes("default-src 'self'"), "Meta CSP must include default-src 'self'");
    assert.ok(metaCsp.includes("object-src 'none'"), "Meta CSP must include object-src 'none'");
    assert.ok(metaCsp.includes("base-uri 'self'"), "Meta CSP must include base-uri 'self'");
    assert.ok(!metaCsp.includes("frame-ancestors"), "Meta CSP must NOT contain frame-ancestors (header-only)");

    // 3. Physical Headless Chrome execution to verify no CSP errors
    const chromePath = "/usr/bin/google-chrome";
    if (fs.existsSync(chromePath)) {
      const { stdout, stderr } = await execFileAsync(chromePath, [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--dump-dom",
        "--virtual-time-budget=3000",
        baseUrl
      ], { timeout: 15000 });

      assert.ok(stdout.includes("Talde Hemendik!"), "Headless Chrome must render page content under active CSP");
      assert.ok(!stderr.includes("Refused to load"), "Headless Chrome must not report CSP refused to load errors");
      assert.ok(!stderr.includes("violates the following Content Security Policy directive"), "No CSP directive violation in Chrome");
    }
  } finally {
    server.close();
  }
});
