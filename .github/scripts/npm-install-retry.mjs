#!/usr/bin/env node
import { spawn } from "node:child_process";

const maxAttempts = Math.max(1, Number.parseInt(process.env.CI_NPM_MAX_ATTEMPTS ?? "3", 10) || 3);
const requestedArgs = process.argv.slice(2);
const command = requestedArgs[0] === "ci" ? requestedArgs.shift() : "install";
const npmArgs = [
  command,
  "--no-audit",
  "--no-fund",
  "--fetch-retries=5",
  "--fetch-retry-mintimeout=10000",
  "--fetch-retry-maxtimeout=120000",
  "--fetch-timeout=300000",
  ...requestedArgs,
];

const retryableFailure = /\b(E404|EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ERR_SOCKET_TIMEOUT|EINTEGRITY)\b|HTTP[ /]?(429|502|503|504)|\b(429|502|503|504)\s+(Too Many Requests|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i;

function runNpm() {
  return new Promise((resolve) => {
    const child = spawn("npm", npmArgs, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["inherit", "pipe", "pipe"],
    });
    let outputTail = "";
    const remember = (chunk) => {
      outputTail += chunk.toString();
      if (outputTail.length > 1_000_000) outputTail = outputTail.slice(-1_000_000);
    };
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      remember(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      remember(chunk);
    });
    child.on("error", (error) => resolve({ code: 1, output: `${outputTail}\n${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output: outputTail }));
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`\n[npm retry] Attempt ${attempt}/${maxAttempts}: npm ${npmArgs.join(" ")}`);
  const result = await runNpm();
  if (result.code === 0) process.exit(0);

  if (!retryableFailure.test(result.output) || attempt === maxAttempts) {
    console.error(`[npm retry] Install failed with exit code ${result.code}; no safe retry remains.`);
    process.exit(result.code || 1);
  }

  const delayMs = attempt * 5000;
  console.warn(`[npm retry] Detected a transient registry/network/integrity failure. Retrying in ${delayMs / 1000}s.`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

process.exit(1);
