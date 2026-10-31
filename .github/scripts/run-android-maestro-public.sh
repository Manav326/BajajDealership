#!/usr/bin/env bash
set -Eeuo pipefail

workspace="${1:?GitHub workspace path is required}"
app_dir="${2:?Android edition directory is required}"
application_id="${3:?Android application ID is required}"
serial="${ANDROID_SERIAL:?Android emulator serial was not supplied by the emulator runner}"

result_dir="$workspace/$app_dir/maestro-results/ci-public"
apk="$workspace/$app_dir/android/app/build/outputs/apk/release/app-release.apk"
flow_dir="$workspace/$app_dir/.maestro/flows/public"
junit="$result_dir/public.junit.xml"

mkdir -p "$result_dir"

if [[ ! -s "$apk" ]]; then
  echo "Expected the self-contained Maestro APK at: $apk" >&2
  find "$workspace/$app_dir" -path '*/app/build/outputs/apk/*/*.apk' -type f -print >&2 || true
  exit 1
fi

if [[ ! -d "$flow_dir" ]]; then
  echo "Maestro public flow directory does not exist: $flow_dir" >&2
  exit 1
fi

echo "Android edition: $application_id"
echo "Android serial: $serial"
echo "APK: $apk"
echo "Flows: $flow_dir"

# The emulator action may start Android before ADB's transport is fully available.
# Keep the action-managed server and wait for both Android boot and package manager.
adb start-server || true
ready=0
for attempt in $(seq 1 90); do
  state="$(adb -s "$serial" get-state 2>/dev/null || true)"
  boot_completed=""
  if [[ "$state" == "device" ]]; then
    boot_completed="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  fi

  if [[ "$state" == "device" && "$boot_completed" == "1" ]] &&
    adb -s "$serial" shell cmd package list packages >/dev/null 2>&1; then
    ready=1
    break
  fi

  adb reconnect offline >/dev/null 2>&1 || true
  sleep 2
done

if [[ "$ready" != "1" ]]; then
  echo "Android emulator did not become ADB-ready. Current devices:" >&2
  adb devices -l >&2 || true
  exit 1
fi

installed=0
for attempt in $(seq 1 5); do
  if adb -s "$serial" install -r "$apk"; then
    installed=1
    break
  fi
  echo "APK installation attempt $attempt failed; reconnecting the emulator transport." >&2
  adb reconnect offline >/dev/null 2>&1 || true
  sleep 3
done

if [[ "$installed" != "1" ]]; then
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

python3 - "$junit" <<'PY'
import sys
import xml.etree.ElementTree as ET

report_path = sys.argv[1]
root = ET.parse(report_path).getroot()
suites = [root] if root.tag == "testsuite" else root.findall(".//testsuite")
tests = sum(int(suite.attrib.get("tests", 0)) for suite in suites)
failures = sum(int(suite.attrib.get("failures", 0)) for suite in suites)
errors = sum(int(suite.attrib.get("errors", 0)) for suite in suites)
skipped = sum(int(suite.attrib.get("skipped", 0)) for suite in suites)

print(f"Maestro JUnit summary: {tests} tests, {failures} failures, {errors} errors, {skipped} skipped")
if tests < 1:
    raise SystemExit("Maestro JUnit report contains no executed test cases.")
if failures or errors:
    raise SystemExit("Maestro JUnit report contains failing or errored test cases.")
PY
