import { readdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'apps/web/test-results');
const minimumPercent = Number(process.argv[3] ?? 50);

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name === 'v8-function-coverage.json') files.push(fullPath);
  }
  return files;
}

function applicationFor(url) {
  try {
    const port = new URL(url).port;
    if (port === '3101') return 'Staff portal';
    if (port === '4173') return 'Customer website';
  } catch { /* Report unclassified application sources separately. */ }
  return 'Other / unclassified';
}

const files = await walk(root);
const apps = new Map();
let testReports = 0;
for (const file of files) {
  let report;
  try { report = JSON.parse(await readFile(file, 'utf8')); }
  catch { continue; }
  testReports += 1;
  for (const module of report.modules ?? []) {
    const app = applicationFor(module.url);
    const current = apps.get(app) ?? { modules: new Set(), functions: new Map() };
    current.modules.add(module.url);
    for (const fn of module.functions ?? []) {
      const key = `${module.url}:${fn.startOffset}:${fn.endOffset}`;
      current.functions.set(key, (current.functions.get(key) ?? false) || Boolean(fn.executed));
    }
    apps.set(app, current);
  }
}

const rows = [];
let combinedCovered = 0;
let combinedTotal = 0;
let combinedModules = 0;
const requiredApps = ['Staff portal', 'Customer website'];
let gatePassed = testReports > 0 && Number.isFinite(minimumPercent) && minimumPercent >= 0;
for (const name of requiredApps) {
  const app = apps.get(name);
  const total = app?.functions.size ?? 0;
  const covered = app ? [...app.functions.values()].filter(Boolean).length : 0;
  const ratio = total ? covered / total : 0;
  const passed = total > 0 && ratio * 100 >= minimumPercent;
  gatePassed = gatePassed && passed;
  combinedCovered += covered;
  combinedTotal += total;
  combinedModules += app?.modules.size ?? 0;
  rows.push(`| ${name} | ${app?.modules.size ?? 0} | ${covered.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} | ${total ? (ratio * 100).toFixed(2) + '%' : 'not available'} | ${passed ? 'passed' : 'failed'} |`);
}
for (const [name, app] of apps) {
  if (requiredApps.includes(name)) continue;
  const total = app.functions.size;
  const covered = [...app.functions.values()].filter(Boolean).length;
  rows.push(`| ${name} | ${app.modules.size} | ${covered} / ${total} | ${total ? (covered / total * 100).toFixed(2) + '%' : 'not available'} | informational |`);
  combinedCovered += covered;
  combinedTotal += total;
  combinedModules += app.modules.size;
}
const combinedPercent = combinedTotal ? (combinedCovered / combinedTotal * 100).toFixed(2) + '%' : 'not available';
const lines = [
  '### Browser JavaScript function-execution coverage',
  '',
  '| Application | Source modules loaded | Functions executed / loaded | Function coverage | Regression floor |',
  '|---|---:|---:|---:|---:|',
  ...rows,
  `| Combined | ${combinedModules} | ${combinedCovered.toLocaleString('en-US')} / ${combinedTotal.toLocaleString('en-US')} | ${combinedPercent} | ${gatePassed ? 'passed' : 'failed'} |`,
  '',
  `| Test reports with coverage | ${testReports} |`,
  `| Per-application regression floor | ${minimumPercent}% |`,
  '',
  '> Scope: Chromium V8 function-level execution for staff/customer source modules loaded during this test run. It is not line or branch coverage and does not include source modules that no scenario loaded. Do not interpret it as whole-application coverage.',
  '',
];
const markdown = lines.join('\n');
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
if (!gatePassed) {
  process.stderr.write(`\nBrowser function-coverage floor failed: one or more applications are below ${minimumPercent}%.\n`);
  process.exitCode = 1;
}
