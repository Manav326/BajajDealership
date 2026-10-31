#!/usr/bin/env bash
set -euo pipefail

workspace="${1:?GitHub workspace path is required}"
app_dir="${2:?Android app directory is required}"
serial="${3:-emulator-5554}"

result_dir="$workspace/$app_dir/maestro-results/ci-public"
apk="$workspace/$app_dir/android/app/build/outputs/apk/release/app-release.apk"
flow_dir="$workspace/$app_dir/.maestro/flows/public"
junit="$result_dir/public.junit.xml"

if [[ ! -d "$flow_dir" ]]; then
  echo "Maestro public flow directory does not exist: $flow_dir" >&2
  exit 1
fi

flow_count="$(find "$flow_dir" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) | wc -l | tr -d '[:space:]')"
if [[ "$flow_count" -lt 1 ]]; then
  echo "No public Maestro YAML flows were found in: $flow_dir" >&2
  exit 1
fi

mkdir -p "$result_dir"
if [[ ! -s "$apk" ]]; then
  echo "Expected the built test APK at: $apk" >&2
  find "$workspace/$app_dir" -path '*/app/build/outputs/apk/*/*.apk' -type f -print >&2 || true
  exit 1
fi

echo "Workspace: $workspace"
echo "Edition app: $app_dir"
echo "Android device: $serial"
echo "APK: $apk"
echo "Maestro flows: $flow_dir ($flow_count YAML flows)"

# The emulator action owns its ADB transport. Do not kill/restart that daemon
# during startup; wait for the guest and package manager to become responsive.
adb start-server
ready=false
for attempt in $(seq 1 90); do
  state="$(adb -s "$serial" get-state 2>/dev/null || true)"
  boot_completed="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  package_manager_ready=false
  if [[ "$state" == "device" && "$boot_completed" == "1" ]]; then
    if adb -s "$serial" shell cmd package list packages >/dev/null 2>&1; then
      package_manager_ready=true
    fi
  fi
  if [[ "$package_manager_ready" == "true" ]]; then
    ready=true
    break
  fi
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Android emulator did not become ADB-ready. Device list:" >&2
  adb devices -l >&2 || true
  exit 1
fi

installed=false
for attempt in $(seq 1 5); do
  if adb -s "$serial" install -r "$apk"; then
    installed=true
    break
  fi
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 3
done

if [[ "$installed" != "true" ]]; then
  echo "APK installation failed after five attempts." >&2
  adb devices -l >&2 || true
  exit 1
fi

maestro --device="$serial" test "$flow_dir" \
  --format JUNIT \
  --output "$junit" \
  --test-output-dir "$result_dir"

if [[ ! -s "$junit" ]]; then
  echo "Maestro completed without producing the required JUnit report: $junit" >&2
  exit 1
fi

python3 - "$junit" "$flow_count" <<'PY'
import sys
import xml.etree.ElementTree as ET

report_path = sys.argv[1]
expected_flows = int(sys.argv[2])
root = ET.parse(report_path).getroot()
suites = [root] if root.tag == "testsuite" else root.findall(".//testsuite")
tests = sum(int(suite.attrib.get("tests", 0)) for suite in suites)
failures = sum(int(suite.attrib.get("failures", 0)) for suite in suites)
errors = sum(int(suite.attrib.get("errors", 0)) for suite in suites)
skipped = sum(int(suite.attrib.get("skipped", 0)) for suite in suites)

print(
    "Maestro JUnit summary: "
    f"{tests} tests, {failures} failures, {errors} errors, {skipped} skipped; "
    f"{expected_flows} public flow files expected"
)
if tests < expected_flows:
    raise SystemExit(
        f"Maestro executed {tests} tests, fewer than the {expected_flows} public flow files."
    )
if failures or errors or skipped:
    raise SystemExit("Maestro JUnit report contains failures, errors or skipped test cases.")
PY
