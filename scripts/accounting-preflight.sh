#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  API_BASE_URL=https://... scripts/accounting-preflight.sh

Optional environment:
  BACKUP_DIR=backups/predeploy
  JOURNAL_CSV=private/journal.local.csv
  SKIP_TESTS=1

What it does:
  1. runs backend tests
  2. runs frontend tests and build
  3. exports /backup/export into BACKUP_DIR
  4. dry-runs the historical Journal import when JOURNAL_CSV is set

The historical import remains dry-run only here. Use --write manually after
reviewing a matching dry-run result.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

api_base_url="${API_BASE_URL:-}"
backup_dir="${BACKUP_DIR:-backups/predeploy}"
journal_csv="${JOURNAL_CSV:-}"
skip_tests="${SKIP_TESTS:-0}"

if [[ -z "$api_base_url" ]]; then
  echo "API_BASE_URL is required." >&2
  echo >&2
  usage >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_base_url="${api_base_url%/}"

resolve_path() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    echo "$path"
  else
    echo "$repo_root/$path"
  fi
}

backup_path="$(resolve_path "$backup_dir")"

echo "Accounting preflight"
echo "API: ${api_base_url}"
echo "Backup dir: ${backup_path}"
echo

if [[ "$skip_tests" == "1" ]]; then
  echo "Skipping local tests because SKIP_TESTS=1."
else
  echo "Running backend tests..."
  (
    cd "$repo_root/backend"
    GOCACHE="${GOCACHE:-/tmp/eigernordvan-go-cache}" go test ./...
  )

  echo "Running frontend tests..."
  (
    cd "$repo_root/frontend"
    npm test -- --run
  )

  echo "Building frontend..."
  (
    cd "$repo_root/frontend"
    npm run build
  )
fi

echo "Exporting live backup..."
"$repo_root/scripts/export-backup.sh" "$api_base_url" "$backup_path"

if [[ -n "$journal_csv" ]]; then
  journal_path="$(resolve_path "$journal_csv")"
  echo "Dry-running historical Journal import..."
  node "$repo_root/scripts/historical-import-from-journal.mjs" \
    --input "$journal_path" \
    --api "$api_base_url"
else
  echo "No JOURNAL_CSV set; skipping historical import dry-run."
fi

echo
echo "Preflight complete."
echo "Next steps:"
echo "  - keep the generated backup artifact out of Git"
echo "  - deploy only after the backup above exists"
echo "  - run historical import with --write only after a matching dry-run review"
