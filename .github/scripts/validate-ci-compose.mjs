#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const cwd = process.cwd();

function composeConfig(files) {
  const args = ["compose"];
  for (const file of files) args.push("-f", file);
  args.push("config", "--format", "json");
  return JSON.parse(execFileSync("docker", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
}

function versionTuple(value) {
  const match = value.match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Could not parse Docker Compose version: ${value}`);
  return match.slice(1).map(Number);
}

const versionText = execFileSync("docker", ["compose", "version", "--short"], { cwd, encoding: "utf8" }).trim();
const [major, minor] = versionTuple(versionText);
if (major < 2 || (major === 2 && minor < 24)) {
  throw new Error(`CI Compose override requires Docker Compose v2.24 or newer; found ${versionText}.`);
}

const normal = composeConfig(["compose.yaml"]);
const ci = composeConfig(["compose.yaml", ".github/compose.ci.yaml"]);

if (normal.networks?.["cloudflare-edge"]?.external !== true) {
  throw new Error("The normal compose.yaml deployment topology changed unexpectedly; the CI override must not replace it.");
}
if (ci.networks?.["cloudflare-edge"]) {
  throw new Error("The CI Compose model must not declare the optional external ingress network.");
}

for (const serviceName of ["postgres", "api", "customer-web", "staff-web"]) {
  const service = ci.services?.[serviceName];
  if (!service) throw new Error(`CI Compose model is missing required service '${serviceName}'.`);
  const networks = Object.keys(service.networks ?? {});
  if (!networks.includes("default") || networks.includes("cloudflare-edge")) {
    throw new Error(`CI service '${serviceName}' must use only the project default network; found: ${networks.join(", ") || "(none)"}.`);
  }
}
if (!ci.services.api.depends_on?.postgres) {
  throw new Error("CI API service must retain its PostgreSQL dependency.");
}
if (!ci.services["customer-web"].depends_on?.api || !ci.services["staff-web"].depends_on?.api) {
  throw new Error("Both web services must retain their API dependency.");
}

console.log(`CI Compose isolation verified with Docker Compose ${versionText}: all application services use only the project default bridge network.`);
