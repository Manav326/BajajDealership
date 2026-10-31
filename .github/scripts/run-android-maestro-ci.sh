#!/usr/bin/env bash
set -euo pipefail

workspace="${1:?GitHub workspace path is required}"
app_dir="${2:?Android app directory is required}"
serial="${3:-emulator-5554}"
suite_runner="$workspace/.github/scripts/run-android-maestro-public.sh"

if [[ ! -f "$suite_runner" ]]; then
  echo "Maestro suite runner does not exist: $suite_runner" >&2
  exit 1
fi

# Keep both invocations and their environment in one Bash process. The Android
# emulator action evaluates script lines through /bin/sh separately, so multiline
# inline exports do not survive from one command line to the next.
bash "$suite_runner" "$workspace" "$app_dir" "$serial" public

export MAESTRO_DEALERSHIP_CODE="CI-LUCKY-BAJAJ"
export MAESTRO_CUSTOMER_CODE="CI-MAESTRO-CUSTOMER"
export MAESTRO_CUSTOMER_PASSWORD="CI-Maestro-Only-Password-123"
export MAESTRO_CUSTOMER_VEHICLE_NAME="CI Maestro Motorcycle"

bash "$suite_runner" "$workspace" "$app_dir" "$serial" authenticated-ci
