import { readdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'apps/web/test-results');
const minimumPercent = Number(process.argv[3] ?? 50);

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name === 'v8-function-coverage.json') files.push(fullPath);
  }
  return files;
}

const files = await walk(root);
const functions = new Map();
const modules = new Set();
let testReports = 0;

for (const file of files) {
  let report;
  try {
    report = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    continue;
  }
  testReports += 1;
  for (const module of report.modules ?? []) {
    modules.add(module.url);
    for (const fn of module.functions ?? []) {
      const key = `${module.url}:${fn.startOffset}:${fn.endOffset}`;
      const current = functions.get(key) ?? false;
      functions.set(key, current || Boolean(fn.executed));
    }
  }
}

const total = functions.size;
const covered = [...functions.values()].filter(Boolean).length;
const ratio = total === 0 ? 0 : covered / total;
const percent = total === 0 ? 'not available' : `${(ratio * 100).toFixed(1)}%`;
const gatePassed = total > 0 && Number.isFinite(minimumPercent) && minimumPercent >= 0 && ratio * 100 >= minimumPercent;
const lines = [
  '### Browser JavaScript function-execution coverage',
  '',
  '| Metric | Result |',
  '|---|---:|',
  `| Test reports with coverage | ${testReports} |`,
  `| Application source modules loaded | ${modules.size} |`,
  `| Loaded-source functions executed | ${covered} / ${total} |`,
  `| Loaded-source function coverage | ${percent} |`,
  `| Regression floor | ${minimumPercent}% (${gatePassed ? 'passed' : 'failed'}) |`,
  '',
  '> Scope: Chromium V8 function-level execution for staff/customer source modules loaded during this test run. It is not line or branch coverage and does not include source modules that no scenario loaded. Do not interpret it as whole-application coverage.',
  '',
];
const markdown = lines.join('\n');
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
}
if (!gatePassed) {
  process.stderr.write(`\nBrowser function-coverage floor failed: ${percent} measured, ${minimumPercent}% required.\n`);
  process.exitCode = 1;
}
