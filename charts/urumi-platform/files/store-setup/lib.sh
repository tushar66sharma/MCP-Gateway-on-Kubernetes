#!/bin/sh
# Helpers sourced by setup.sh (shipped in the same ConfigMap). Kept separate so scripts/dev/test-store-setup.ps1
# can test them in a throwaway container without a WordPress install.

# woo_version_cmp INSTALLED WANTED -> prints "older", "equal" or "newer" (INSTALLED relative to WANTED).
# An empty INSTALLED means not installed, which counts as older. Uses PHP version_compare through WP-CLI
# (--skip-wordpress: no WordPress load needed); the versions travel in the environment, never in the PHP code.
woo_version_cmp() {
  if [ -z "$1" ]; then echo older; return 0; fi
  result=$(V1="$1" V2="$2" ${WP:-wp} --skip-wordpress eval 'echo version_compare(getenv("V1"), getenv("V2"));') || return 1
  case "$result" in
    -1) echo older ;;
    0) echo equal ;;
    1) echo newer ;;
    *) echo "woo_version_cmp: unexpected result '$result'" >&2; return 1 ;;
  esac
}
