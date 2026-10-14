#!/bin/sh
# Quiet verification for agents: unit tests + lint, printing only what an agent needs to act on.
# Usage: sh .claude/tools/check.sh [test paths...]   (no paths = whole suite)
# Prints one result line per step; on failure, the first 60 lines of the failing output.
# Never writes into the repo (scratch output goes to the OS temp dir).
cd "$(dirname "$0")/../.." || exit 2
BIN=node_modules/.bin
T=$(mktemp) L=$(mktemp)
trap 'rm -f "$T" "$L"' EXIT

"$BIN/bun" test "$@" >"$T" 2>&1
tc=$?
summary=$(grep -E '^ *[0-9]+ (pass|fail)|^Ran ' "$T" | tr -s ' \n' ' ')
if [ $tc -eq 0 ]; then echo "TESTS OK: $summary"; else
  echo "TESTS FAIL: $summary"
  grep -E '\(fail\)|error:|Expected|Received|^ *at .*:[0-9]+' "$T" | head -60
fi

PATH="$BIN:$PATH" "$BIN/bun" run lint >"$L" 2>&1
lc=$?
if [ $lc -eq 0 ]; then echo "LINT OK"; else
  echo "LINT FAIL:"
  grep -vE '^\$ |^Checked |^ *$' "$L" | head -60
fi
[ $tc -eq 0 ] && [ $lc -eq 0 ]
