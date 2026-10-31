#!/usr/bin/env bash
set -euo pipefail

workspace="${1:?GitHub workspace path is required}"
app_dir="${2:?Android app directory is required}"
serial="${3:-emulator-5554}"

result_dir="$workspace/$app_dir/maestro-results/ci-public"
apk="$workspace/$app_dir/android/app/build/outputs/apk/release/app-release.apk"
flow_dir="$workspace/$app_dir/.maestro/flows/public"

mkdir -p "$result_dir"
if [[ ! -s "$apk" ]]; then
  echo "Expected the built test APK at: $apk"
  find "$workspace/$app_dir" -path '*/app/build/outputs/apk/*/*.apk' -type f -print
  exit 1
fi

echo "Workspace: $workspace"
echo "Edition app: $app_dir"
echo "Android device: $serial"
echo "APK: $apk"
echo "Maestro flows: $flow_dir"

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
  echo "Android emulator did not become ADB-ready. Device list:"
  adb devices -l || true
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
  echo "APK installation failed after five attempts."
  adb devices -l || true
  exit 1
fi

maestro --device="$serial" test "$flow_dir" \
  --format JUNIT \
  --output "$result_dir/public.junit.xml" \
  --test-output-dir "$result_dir"
