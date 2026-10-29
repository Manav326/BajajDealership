#!/usr/bin/env node
/**
 * Read-only smoke checks for the three public preview services.
 * No credentials, writes, notifications, posts, or payments are used.
 *
 * Optional overrides: PREVIEW_API_URL, PREVIEW_CUSTOMER_URL, PREVIEW_STAFF_URL,
 * PREVIEW_TIMEOUT_MS. Requires Node.js 20+ (built-in fetch).
 */
const DEFAULTS = {
  api: "https://lucky-bajaj-api.onrender.com",
  customer: "https://lucky-bajaj-customer-web.onrender.com",
  staff: "https://lucky-bajaj-staff-web.onrender.com",
};
const timeoutMs = Math.max(5_000, Math.min(120_000, Number(process.env.PREVIEW_TIMEOUT_MS) || 45_000));

function normalizeBaseUrl(value, key) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(key + " URL is invalid. Use an absolute https:// URL.");
  }
  if (url.protocol !== "https:") throw new Error(key + " URL must use HTTPS.");
  if (url.username || url.password) throw new Error(key + " URL must not embed credentials.");
  return url.origin;
}
const urls = Object.fromEntries(Object.entries({
  api: process.env.PREVIEW_API_URL || DEFAULTS.api,
  customer: process.env.PREVIEW_CUSTOMER_URL || DEFAULTS.customer,
  staff: process.env.PREVIEW_STAFF_URL || DEFAULTS.staff,
}).map(([key, value]) => [key, normalizeBaseUrl(value, key)]));

const results = [];
function endpoint(base, path) {
  return base + (path.startsWith("/") ? path : "/" + path);
}
async function request(base, path, options = {}) {
  const headers = { accept: "*/*", ...(options.headers || {}) };
  const response = await fetch(endpoint(base, path), {
    ...options,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  return { response, body };
}
async function jsonRequest(base, path, options = {}) {
  const headers = { accept: "application/json", ...(options.headers || {}) };
  const { response, body } = await request(base, path, { ...options, headers });
  if (!response.ok) {
    const detail = body.trim().replace(/\s+/g, " ").slice(0, 240);
    throw new Error("HTTP " + response.status + " " + response.statusText
      + (detail ? " — " + detail : ""));
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("HTTP " + response.status + " returned a non-JSON body.");
  }
  return { response, data };
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "OK" });
  } catch (cause) {
    results.push({
      name,
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
async function verifyStaticAssets(base, html) {
  const baseUrl = new URL(base);
  const scriptRefs = [...html.matchAll(/<script\\b[^>]*\\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  const localScripts = scriptRefs.map(reference => new URL(reference, baseUrl))
    .filter(asset => asset.origin === baseUrl.origin);
  requireCondition(localScripts.length > 0, "No same-origin JavaScript bundle is referenced by index.html.");

  const stylesheetRefs = [...html.matchAll(/<link\\b(?=[^>]*\\brel=["']stylesheet["'])[^>]*\\bhref=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  const localStylesheets = stylesheetRefs.map(reference => new URL(reference, baseUrl))
    .filter(asset => asset.origin === baseUrl.origin);

  const assets = [
    ...localScripts.map(url => ({ url, kind: "JavaScript" })),
    ...localStylesheets.map(url => ({ url, kind: "CSS" })),
  ];
  for (const asset of assets) {
    const result = await request(base, asset.url.pathname + asset.url.search);
    requireCondition(result.response.ok,
      asset.kind + " asset " + asset.url.pathname + " returned HTTP " + result.response.status + ".");
    requireCondition(result.body.length > 0, asset.kind + " asset " + asset.url.pathname + " is empty.");
    requireCondition(!(result.response.headers.get("content-type") || "").includes("text/html"),
      asset.kind + " asset " + asset.url.pathname + " returned HTML instead of an asset.");
  }
  return localScripts.length + " JavaScript and " + localStylesheets.length + " CSS asset(s) fetched successfully";
}

console.log("Lucky Bajaj preview smoke check (read-only; no login, writes, messages or payments)");
console.log("API:      " + urls.api);
console.log("Customer: " + urls.customer);
console.log("Staff:    " + urls.staff);
console.log("Timeout per request: " + timeoutMs + " ms");
console.log("");

await check("API health endpoint", async () => {
  const result = await jsonRequest(urls.api, "/actuator/health");
  requireCondition(result.data.status === "UP", "Expected health status UP; received " + String(result.data.status) + ".");
  return "HTTP 200; status UP";
});

await check("Customer website HTML", async () => {
  const result = await request(urls.customer, "/");
  requireCondition(result.response.ok, "HTTP " + result.response.status + " " + result.response.statusText);
  requireCondition((result.response.headers.get("content-type") || "").includes("text/html"), "Expected text/html response.");
  requireCondition(/<div id="root"><\/div>/i.test(result.body), "Customer site HTML does not contain the React root.");
  requireCondition(/<title>[^<]*Lucky Bajaj/i.test(result.body), "Expected the Lucky Bajaj customer-site title.");
  const assets = await verifyStaticAssets(urls.customer, result.body);
  return "HTTP " + result.response.status + "; title and React root present; " + assets;
});

await check("Staff website HTML", async () => {
  const result = await request(urls.staff, "/");
  requireCondition(result.response.ok, "HTTP " + result.response.status + " " + result.response.statusText);
  requireCondition((result.response.headers.get("content-type") || "").includes("text/html"), "Expected text/html response.");
  requireCondition(/<div id="root"><\/div>/i.test(result.body), "Staff site HTML does not contain the React root.");
  requireCondition(/<title>[^<]*(QuantaEdge|Bajaj Dealership)/i.test(result.body), "Expected the QuantaEdge/Bajaj staff-site title.");
  const assets = await verifyStaticAssets(urls.staff, result.body);
  return "HTTP " + result.response.status + "; title and React root present; " + assets;
});

await check("Public Bajaj catalogue shape and model isolation", async () => {
  const result = await jsonRequest(urls.api, "/api/v1/public/catalogue/bikes");
  const data = result.data;
  requireCondition(data.manufacturer === "BAJAJ", "Top-level manufacturer must be BAJAJ.");
  requireCondition(Array.isArray(data.bikes), "Expected a bikes array in the public catalogue.");
  requireCondition(data.bikes.length >= 10, "Expected at least 10 published models; found " + data.bikes.length + ".");
  const codes = new Set();
  for (const bike of data.bikes) {
    requireCondition(safeText(bike.manufacturer).toUpperCase() === "BAJAJ",
      "Non-Bajaj or missing manufacturer on model " + (safeText(bike.modelCode) || "(unknown)") + ".");
    requireCondition(safeText(bike.modelCode) && safeText(bike.modelName), "Every public model needs a model code and name.");
    requireCondition(!codes.has(bike.modelCode), "Duplicate model code " + bike.modelCode + ".");
    codes.add(bike.modelCode);
    if (bike.exShowroomPrice != null) {
      requireCondition(Number.isFinite(Number(bike.exShowroomPrice)) && Number(bike.exShowroomPrice) > 0,
        "Model " + bike.modelCode + " has an invalid ex-showroom price.");
      requireCondition(/^https:\/\//i.test(safeText(bike.priceSourceUrl)),
        "Model " + bike.modelCode + " has a price without an HTTPS source URL.");
      requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(safeText(bike.priceVerifiedAt)),
        "Model " + bike.modelCode + " has a price without a verification date.");
    }
  }
  return data.bikes.length + " published Bajaj models; no duplicates; priced models have HTTPS source/date";
});

await check("Current promotions are source-backed", async () => {
  const result = await jsonRequest(urls.api, "/api/v1/public/catalogue/promotions");
  const promotions = result.data.promotions;
  requireCondition(Array.isArray(promotions), "Expected a promotions array.");
  for (const promotion of promotions) {
    requireCondition(safeText(promotion.title), "A published promotion is missing its title.");
    requireCondition(/^https:\/\//i.test(safeText(promotion.sourceUrl)),
      "Promotion \"" + (safeText(promotion.title) || "(untitled)") + "\" has no HTTPS source URL.");
    requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(safeText(promotion.startsOn)),
      "Promotion \"" + promotion.title + "\" has an invalid start date.");
    if (promotion.endsOn != null) {
      requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(safeText(promotion.endsOn)),
        "Promotion \"" + promotion.title + "\" has an invalid end date.");
      requireCondition(promotion.endsOn >= promotion.startsOn,
        "Promotion \"" + promotion.title + "\" ends before it starts.");
    }
  }
  return promotions.length + " current published promotions; each has a source and valid dates";
});

await check("Google sign-in configuration is explicit", async () => {
  const result = await jsonRequest(urls.api, "/api/v1/customer/auth/google/config");
  const data = result.data;
  requireCondition(typeof data.configured === "boolean", "Google config must expose a configured boolean.");
  if (!data.configured) {
    throw new Error("Google sign-in is not configured on the preview API; set GOOGLE_WEB_CLIENT_ID / APP_AUTH_GOOGLE_CLIENT_ID.");
  }
  requireCondition(/^.+\.apps\.googleusercontent\.com$/.test(safeText(data.clientId)),
    "Google sign-in reports configured=true but the public client ID looks invalid.");
  return "Google sign-in is configured; client ID is present (value not printed)";
});

for (const [label, origin] of [["Customer CORS", urls.customer], ["Staff CORS", urls.staff]]) {
  await check(label, async () => {
    const result = await jsonRequest(urls.api, "/api/v1/public/catalogue/bikes", {
      headers: { origin },
    });
    const allowOrigin = result.response.headers.get("access-control-allow-origin");
    requireCondition(allowOrigin === origin,
      "Expected Access-Control-Allow-Origin \"" + origin + "\"; received " + (allowOrigin || "(missing)") + ".");
    return "HTTP " + result.response.status + "; exact origin allowed";
  });
}

await check("Unauthenticated customer data remains protected", async () => {
  const result = await request(urls.api, "/api/v1/customer/vehicles");
  requireCondition([401, 403].includes(result.response.status),
    "Expected HTTP 401/403 without credentials; received " + result.response.status
      + (result.body ? " (" + result.body.slice(0, 140) + ")" : "") + ".");
  return "HTTP " + result.response.status + "; no customer session accepted";
});

await check("Unauthenticated staff website-request listing remains protected", async () => {
  const result = await request(urls.api, "/api/v1/admin/sales/customer-requests");
  requireCondition([401, 403].includes(result.response.status),
    "Expected HTTP 401/403 without credentials; received " + result.response.status
      + (result.body ? " (" + result.body.slice(0, 140) + ")" : "") + ".");
  return "HTTP " + result.response.status + "; staff authority required";
});

console.log("Results");
console.log("-------");
for (const result of results) {
  console.log((result.ok ? "PASS" : "FAIL") + "  " + result.name);
  console.log("      " + result.detail);
}
const passed = results.filter(result => result.ok).length;
const failed = results.length - passed;
console.log("");
console.log(passed + "/" + results.length + " checks passed; " + failed + " failed.");
if (failed > 0) {
  console.error("Preview smoke failed. Fix the reported deployment/configuration issue, then rerun this command.");
  process.exitCode = 1;
} else {
  console.log("Read-only preview smoke passed. This does not replace manual checkout, sales handover, persistent-DB or visual/accessibility acceptance.");
}
