#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MONARQ ECONOMAT - Nightly PocketBase Backup Script (Linux / macOS)
# Copies pb_data to a backup directory and retains only the last 14 copies.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/../pb_data"
BACKUP_ROOT="${1:-${SCRIPT_DIR}/../pb_backups}"

if [ ! -d "${SOURCE_DIR}" ]; then
  echo "[ERROR] Source directory '${SOURCE_DIR}' does not exist." >&2
  exit 1
fi

mkdir -p "${BACKUP_ROOT}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
TARGET_DIR="${BACKUP_ROOT}/pb_data_${TIMESTAMP}"

echo "[MONARQ BACKUP] Copying '${SOURCE_DIR}' to '${TARGET_DIR}'..."
cp -R "${SOURCE_DIR}" "${TARGET_DIR}"

echo "[MONARQ BACKUP] Rotating backups (retaining last 14 copies)..."
ls -1dt "${BACKUP_ROOT}"/pb_data_* 2>/dev/null | tail -n +15 | while IFS= read -r old_dir; do
  if [ -n "${old_dir}" ] && [ -d "${old_dir}" ]; then
    echo "[MONARQ BACKUP] Removing old backup '${old_dir}'"
    rm -rf "${old_dir}"
  fi
done

echo "[MONARQ BACKUP] Backup completed successfully: '${TARGET_DIR}'"
