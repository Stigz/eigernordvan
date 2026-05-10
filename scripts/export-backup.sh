#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <api_base_url> <output_dir>"
  echo "Example: $0 https://abc123.execute-api.eu-central-1.amazonaws.com backups"
  exit 1
fi

api_base_url="${1%/}"
output_dir="$2"

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
mkdir -p "$output_dir"

json_file="${output_dir}/van-backup-${timestamp}.json"
gz_file="${json_file}.gz"
sha_file="${gz_file}.sha256"

echo "Downloading backup snapshot from ${api_base_url}/backup/export ..."
curl --fail --silent --show-error "${api_base_url}/backup/export" -o "$json_file"

gzip -9 "$json_file"
sha256sum "$gz_file" > "$sha_file"

echo "Backup written:"
echo "  - $gz_file"
echo "  - $sha_file"
echo
echo "Optional upload command:"
echo "aws s3 cp \"$gz_file\" s3://<backup-bucket>/$(basename "$gz_file")"
echo "aws s3 cp \"$sha_file\" s3://<backup-bucket>/$(basename "$sha_file")"
