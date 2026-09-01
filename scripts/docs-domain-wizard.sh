#!/usr/bin/env bash
# Guides the Big Plan captain through the one-time GitHub Pages custom-domain
# setup and performs read-only DNS, redirect, certificate, and HTTPS checks.

set -euo pipefail

readonly DOMAIN="bigplan.dev"
readonly WWW_DOMAIN="www.bigplan.dev"
readonly GITHUB_OWNER="josh-padnick"
readonly PAGES_HOST="josh-padnick.github.io"
readonly REPOSITORY_URL="https://github.com/josh-padnick/big-plan"
readonly EXPECTED_A=$'185.199.108.153\n185.199.109.153\n185.199.110.153\n185.199.111.153'
readonly EXPECTED_AAAA=$'2606:50c0:8000::153\n2606:50c0:8001::153\n2606:50c0:8002::153\n2606:50c0:8003::153'

usage() {
  cat <<'EOF'
Usage: scripts/docs-domain-wizard.sh [--check|--help]

With no option, print the captain's one-time setup instructions, pause at each
manual checkpoint, and finish with read-only verification. Use --check at any
time to rerun only the DNS and TLS checks. This script never changes GitHub or
DNS-provider settings.
EOF
}

pause_for_captain() {
  if [[ -t 0 ]]; then
    read -r -p "Press Return when this step is complete (or Ctrl-C to stop): "
    printf '\n'
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 2
  fi
}

normalize_lines() {
  sed '/^[[:space:]]*$/d; s/[.]$//' | sort -u
}

check_exact_records() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS  %s\n' "$label"
    return 0
  fi

  printf 'WAIT  %s\n' "$label"
  printf '      expected:\n'
  printf '%s\n' "$expected" | sed 's/^/        /'
  printf '      received:\n'
  printf '%s\n' "${actual:-<no records>}" | sed 's/^/        /'
  return 1
}

run_checks() {
  require_command dig
  require_command curl
  require_command openssl

  local failures=0
  local actual_a
  local actual_aaaa
  local actual_www
  local final_url

  actual_a="$(dig +short A "$DOMAIN" | normalize_lines)"
  actual_aaaa="$(dig +short AAAA "$DOMAIN" | normalize_lines)"
  actual_www="$(dig +short CNAME "$WWW_DOMAIN" | normalize_lines)"

  printf 'Checking public DNS and TLS for %s...\n\n' "$DOMAIN"
  check_exact_records "A records for ${DOMAIN}" "$EXPECTED_A" "$actual_a" || failures=$((failures + 1))
  check_exact_records "AAAA records for ${DOMAIN}" "$EXPECTED_AAAA" "$actual_aaaa" || failures=$((failures + 1))
  check_exact_records "CNAME for ${WWW_DOMAIN}" "$PAGES_HOST" "$actual_www" || failures=$((failures + 1))

  printf '\nOwnership-verification TXT record (keep this after verification):\n'
  dig +short TXT "_github-pages-challenge-${GITHUB_OWNER}.${DOMAIN}" || true

  if curl --fail --silent --head "https://${DOMAIN}/" >/dev/null 2>&1; then
    printf 'PASS  HTTPS responds at https://%s/\n' "$DOMAIN"
  else
    printf 'WAIT  HTTPS is not ready at https://%s/\n' "$DOMAIN"
    failures=$((failures + 1))
  fi

  final_url="$(curl --fail --silent --location --head --output /dev/null --write-out '%{url_effective}' "https://${WWW_DOMAIN}/" 2>/dev/null || true)"
  if [[ "$final_url" == "https://${DOMAIN}/" ]]; then
    printf 'PASS  https://%s/ redirects to https://%s/\n' "$WWW_DOMAIN" "$DOMAIN"
  else
    printf 'WAIT  https://%s/ ended at %s\n' "$WWW_DOMAIN" "${final_url:-<unavailable>}"
    failures=$((failures + 1))
  fi

  if [[ "$failures" -eq 0 ]]; then
    printf '\nAll DNS, redirect, and TLS checks passed. bigplan.dev is canonical.\n'
    openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" </dev/null 2>/dev/null |
      openssl x509 -noout -subject -issuer -dates
    return 0
  fi

  printf '\n%d check(s) are not ready. DNS and certificate issuance can take time; rerun with --check.\n' "$failures"
  return 1
}

run_wizard() {
  cat <<EOF
Big Plan docs domain wizard
===========================

This is a read-only guide. It cannot change the captain's GitHub or DNS-provider
accounts. Complete the steps in order; do not delete the old parking records
until the GitHub Pages deployment workflow has succeeded on main.

1. Merge the docs deployment workflow, then open:
   ${REPOSITORY_URL}/settings/pages

   Set Source to "GitHub Actions". This one-time setting lets the workflow create
   deployments; the workflow's ordinary token cannot enable Pages by itself.
   If the automatic run from the merge arrived before this setting and failed,
   rerun it from ${REPOSITORY_URL}/actions. Confirm "Deploy docs" succeeds before
   changing any traffic-bearing DNS records.
EOF
  pause_for_captain

  cat <<EOF
2. Prove domain ownership before routing traffic:
   - Open GitHub profile Settings -> Pages -> Add a domain.
   - Enter ${DOMAIN}.
   - At the DNS provider, add the TXT record GitHub displays:
       Type: TXT
       Name: _github-pages-challenge-${GITHUB_OWNER}
       Value: <the verification token GitHub displays>
   - Wait for GitHub to verify it. Keep this TXT record permanently; it prevents
     another GitHub account from claiming the domain if repository settings drift.

   DNS-provider note: some forms append .${DOMAIN} automatically. Enter only
   _github-pages-challenge-${GITHUB_OWNER} there, not the duplicated full name.
EOF
  pause_for_captain

  cat <<EOF
3. Return to ${REPOSITORY_URL}/settings/pages:
   - Set Custom domain to ${DOMAIN} and save it.
   - Leave "Enforce HTTPS" alone until GitHub finishes issuing the certificate.
EOF
  pause_for_captain

  cat <<EOF
4. Replace the provider's parking records with these exact records.
   Delete conflicting A, AAAA, ALIAS, ANAME, or CNAME records for @ and www.
   In particular, ${DOMAIN} currently used Porkbun parking addresses and www
   used pixie.porkbun.com; neither may remain.

   Type   Name   Value
   ----   ----   --------------------------------
   A      @      185.199.108.153
   A      @      185.199.109.153
   A      @      185.199.110.153
   A      @      185.199.111.153
   AAAA   @      2606:50c0:8000::153
   AAAA   @      2606:50c0:8001::153
   AAAA   @      2606:50c0:8002::153
   AAAA   @      2606:50c0:8003::153
   CNAME  www    ${PAGES_HOST}

   Use the provider's default TTL. Do not add wildcard DNS records for this site.
EOF
  pause_for_captain

  cat <<EOF
5. Return to repository Settings -> Pages after GitHub's DNS check succeeds.
   Wait for the TLS certificate, then enable "Enforce HTTPS". GitHub Pages will
   serve ${DOMAIN} as canonical and redirect ${WWW_DOMAIN} to it.

The verification below is expected to say WAIT while DNS propagates or GitHub
issues the certificate. Rerun this script with --check until every line passes.

EOF
  run_checks
}

case "${1:-}" in
  "") run_wizard ;;
  --check) run_checks ;;
  --help | -h) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
