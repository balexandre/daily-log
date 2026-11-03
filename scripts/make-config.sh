#!/usr/bin/env bash
# Writes js/config.js, which tells the website which Supabase project to use.
#
#   Locally:         bash scripts/make-config.sh             (reads .env)
#   GitHub Actions:  bash scripts/make-config.sh <out-file>  (reads the repository secrets)
#
# Only the project URL and the publishable key go into the website. Never put the
# secret key (SUPABASE_SECRET_KEY) or the database password in it: the website is public.
set -euo pipefail
cd "$(dirname "$0")/.."

# Reads one variable from .env without running the file, so nothing else in it is touched.
from_env_file() {
  [ -f .env ] || return 0
  # Not anchored to the line start, so an invisible byte-order mark before the first line doesn't hide it.
  { LC_ALL=C grep -E "(^|[^A-Za-z0-9_])$1[[:space:]]*=" .env || true; } \
    | head -n 1 | cut -d= -f2- | tr -d '\r' \
    | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^[\"']//; s/[\"']$//"
}

url="${SUPABASE_URL:-$(from_env_file SUPABASE_URL)}"
key="${SUPABASE_PUBLISHABLE_KEY:-$(from_env_file SUPABASE_PUBLISHABLE_KEY)}"
[ -n "$url" ] || { echo "SUPABASE_URL is not set" >&2; exit 1; }
[ -n "$key" ] || { echo "SUPABASE_PUBLISHABLE_KEY is not set" >&2; exit 1; }

case "$key" in
  sb_secret_*|*service_role*) echo "SUPABASE_PUBLISHABLE_KEY looks like a secret key. Use the publishable key." >&2; exit 1 ;;
esac

url="${url%/}"

# What's running: the version from VERSION, plus the commit it was built from and that commit's date.
version="$(tr -d '[:space:]' < VERSION)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
committed_at="$(git log -1 --format=%cI 2>/dev/null || echo '')"
if ! git diff --quiet HEAD 2>/dev/null; then commit="$commit+local"; fi  # uncommitted changes
repo="${GITHUB_REPOSITORY:-$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]##; s#\.git$##')}"

out="${1:-js/config.js}"
cat > "$out" <<EOF
// Made by scripts/make-config.sh. Not committed: it differs per setup.
window.DAILY_LOG_CONFIG = {
  supabaseUrl: '$url',
  supabaseKey: '$key',
  build: {
    version: '$version',
    commit: '$commit',
    committedAt: '$committed_at',
    repo: '$repo',
  },
};
EOF
echo "Wrote $out for $url (version $version, commit $commit)"
