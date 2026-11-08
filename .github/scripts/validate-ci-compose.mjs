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

if (!normal.services?.api?.networks || Object.keys(normal.services.api.networks).length < 1) {
  throw new Error("The normal compose.yaml service networking must remain configured; the CI overlay must not replace it.");
}
const externalCiNetworks = Object.entries(ci.networks ?? {})
  .filter(([, network]) => network.external === true)
  .map(([name]) => name);
if (externalCiNetworks.length > 0) {
  throw new Error(`The CI Compose model must not depend on externally managed networks: ${externalCiNetworks.join(", ")}.`);
}

for (const serviceName of ["postgres", "api", "customer-web", "staff-web"]) {
  const service = ci.services?.[serviceName];
  if (!service) throw new Error(`CI Compose model is missing required service '${serviceName}'.`);
  const networks = Object.keys(service.networks ?? {});
  if (networks.length !== 1 || networks[0] !== "default") {
    throw new Error(`CI service '${serviceName}' must use only the project default network; found: ${networks.join(", ") || "(none)"}.`);
  }
}
if (!ci.services.api.depends_on?.postgres) {
  throw new Error("CI API service must retain its PostgreSQL dependency.");
}
if (!ci.services["customer-web"].depends_on?.api || !ci.services["staff-web"].depends_on?.api) {
  throw new Error("Both web services must retain their API dependency.");
}
for (const flag of ["SOCIAL_META_ENABLED", "SOCIAL_WHATSAPP_ENABLED"]) {
  if (String(ci.services.api.environment?.[flag] ?? "").toLowerCase() !== "false") {
    throw new Error(`CI must explicitly disable external social delivery (${flag}).`);
  }
}

console.log(`CI Compose isolation verified with Docker Compose ${versionText}: all application services use only the project default bridge network.`);
