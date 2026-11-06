#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'config/deployment.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.schemaVersion !== 1) throw new Error('Unsupported config/deployment.json schemaVersion.');
if (config.deploymentModel !== 'local-docker-cloudflare-tunnel') throw new Error('Production deploymentModel must remain local-docker-cloudflare-tunnel.');
const production = config.production;
if (!production || typeof production !== 'object') throw new Error('config/deployment.json must define production endpoints.');

function requireHttpsOrigin(name, value, trailingSlash) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`production.${name} must be a non-empty URL.`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`production.${name} must be an absolute HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== '443') || parsed.pathname !== '/' || parsed.search || parsed.hash ||
      (trailingSlash && !value.endsWith('/')) || (!trailingSlash && value.endsWith('/'))) {
    throw new Error(`production.${name} must be a canonical HTTPS origin${trailingSlash ? ' ending in /' : ' without a trailing slash'}.`);
  }
  return trailingSlash ? `${parsed.origin}/` : parsed.origin;
}
const endpoints = {
  api_base_url: requireHttpsOrigin('apiBaseUrl', production.apiBaseUrl, true),
  customer_web_url: requireHttpsOrigin('customerWebUrl', production.customerWebUrl, false),
  staff_web_url: requireHttpsOrigin('staffWebUrl', production.staffWebUrl, false),
};

// Prevent retired Render hostnames returning to tracked app source/examples.
// render.yaml remains a separate optional preview template outside apps/.
const tracked = execFileSync('git', ['ls-files', 'apps'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const stale = [];
for (const relative of tracked) {
  try { if (/onrender\.com/i.test(readFileSync(resolve(root, relative), 'utf8'))) stale.push(relative); }
  catch {}
}
if (stale.length) throw new Error('Retired Render hostnames remain under apps/: ' + stale.join(', '));

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(endpoints).map(([k,v]) => `${k}=${v}\n`).join(''));
if (process.env.GITHUB_ENV) {
  const env = [['BAJAJ_API_BASE_URL', endpoints.api_base_url], ['BAJAJ_CUSTOMER_WEB_URL', endpoints.customer_web_url],
    ['BAJAJ_STAFF_WEB_URL', endpoints.staff_web_url], ['VITE_API_BASE_URL', endpoints.api_base_url]];
  appendFileSync(process.env.GITHUB_ENV, env.map(([k,v]) => `${k}=${v}\n`).join(''));
}
console.log('Validated centralized production endpoints from config/deployment.json:');
console.log(JSON.stringify(endpoints, null, 2));
