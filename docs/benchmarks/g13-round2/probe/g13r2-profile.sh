#!/usr/bin/env bash
# Build the working tree as a ui1 measurement build named $1 and profile its scroll and SPA blocks once.
# usage: bash .work/g13r2-profile.sh <name>
set -e
cd "$(dirname "$0")/.."
name=$1
node scripts/ui1/build.mjs . ".work/g13r2-$name" | tail -1
G13_PERF=1 G13_PAIRS=1 G13_CPUPROFILE=1 G13_OUT=".work/g13r2-prof-$name" G13_BUILDS="$name=.work/g13r2-$name" \
  npm run test:e2e -- --config=scripts/g13/config.ts --grep alternating 2>&1 | grep -E "Error|passed|failed"
for s in scrollFar scrollNear spa; do
  echo "=== $name $s"
  node docs/benchmarks/g13-plan/prof.mjs ".work/g13r2-prof-$name/$name-$s.cpuprofile" | sed -n 1,3p
  node docs/benchmarks/g13-plan/prof.mjs ".work/g13r2-prof-$name/$name-$s.cpuprofile" |
    grep -E "^ +[0-9.]+  (applyLayout|shifted|capture|verifiedOverlaySlot|fixedContainingBlock|publish|commit|handle|draw|paint|sample)$" || true
done
