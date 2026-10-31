#!/usr/bin/env bash
set -euo pipefail

workspace="${1:?GitHub workspace path is required}"
app_dir="${2:?Android app directory is required}"
serial="${3:-emulator-5554}"
suite="${4:-public}"

result_dir="$workspace/$app_dir/maestro-results/ci"
apk="$workspace/$app_dir/android/app/build/outputs/apk/release/app-release.apk"
include_tag=""
case "$suite" in
  public)
    flow_dir="$workspace/$app_dir/.maestro/flows/public"
    ;;
  authenticated-ci)
    flow_dir="$workspace/$app_dir/.maestro/flows/authenticated"
    include_tag="regression,responsive,notifications,service"
    ;;
  *)
    echo "Unsupported Maestro CI suite: $suite" >&2
    exit 2
    ;;
esac
junit="$result_dir/$suite.junit.xml"

if [[ ! -d "$flow_dir" ]]; then
  echo "Maestro flow directory does not exist: $flow_dir" >&2
  exit 1
fi

mapfile -t flow_files < <(find "$flow_dir" -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) | sort)
flow_count=0
for flow_file in "${flow_files[@]}"; do
  if [[ -z "$include_tag" ]] || grep -Eq "^[[:space:]]*-[[:space:]]*(regression|responsive|notifications|service)[[:space:]]*$" "$flow_file"; then
    ((flow_count += 1))
  fi
done
if [[ "$flow_count" -lt 1 ]]; then
  echo "No Maestro flow files selected for suite '$suite' in: $flow_dir" >&2
  exit 1
fi
if [[ "$suite" == "authenticated-ci" && "$flow_count" -ne 4 ]]; then
  echo "Expected four tagged authenticated CI flows, found $flow_count." >&2
  exit 1
fi
if [[ "$suite" == "authenticated-ci" ]]; then
  for name in MAESTRO_DEALERSHIP_CODE MAESTRO_CUSTOMER_CODE MAESTRO_CUSTOMER_PASSWORD MAESTRO_CUSTOMER_VEHICLE_NAME; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required synthetic authenticated-test variable: $name" >&2
      exit 2
    fi
  done
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
echo "Maestro suite: $suite"
echo "Maestro flows: $flow_dir ($flow_count selected YAML flows)"

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

# APK installation can temporarily drop the emulator's ADB transport while
# Android refreshes package metadata. Require three consecutive healthy guest
# probes before Maestro opens a device connection.
adb reconnect offline >/dev/null 2>&1 || true
ready=false
stable_checks=0
for attempt in $(seq 1 30); do
  state="$(adb -s "$serial" get-state 2>/dev/null || true)"
  boot_completed="$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r' || true)"
  package_manager_ready=false
  if [[ "$state" == "device" && "$boot_completed" == "1" ]]; then
    if adb -s "$serial" shell cmd package list packages >/dev/null 2>&1; then
      package_manager_ready=true
    fi
  fi
  if [[ "$package_manager_ready" == "true" ]]; then
    ((stable_checks += 1))
    if [[ "$stable_checks" -ge 3 ]]; then
      ready=true
      break
    fi
  else
    stable_checks=0
    adb reconnect offline >/dev/null 2>&1 || true
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  echo "Android emulator lost ADB/package-manager readiness after APK installation." >&2
  adb devices -l >&2 || true
  exit 1
fi

maestro_args=(--device="$serial" test "$flow_dir")
if [[ -n "$include_tag" ]]; then
  maestro_args+=("--include-tags=$include_tag")
fi
for name in MAESTRO_DEALERSHIP_CODE MAESTRO_CUSTOMER_CODE MAESTRO_CUSTOMER_PASSWORD MAESTRO_CUSTOMER_VEHICLE_NAME; do
  value="${!name:-}"
  if [[ -n "$value" ]]; then
    maestro_args+=(-e "$name=$value")
  fi
done
maestro "${maestro_args[@]}" \
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
    f"{expected_flows} selected flow files expected"
)
if tests < expected_flows:
    raise SystemExit(
        f"Maestro executed {tests} tests, fewer than the {expected_flows} public flow files."
    )
if failures or errors or skipped:
    raise SystemExit("Maestro JUnit report contains failures, errors or skipped test cases.")
PY
