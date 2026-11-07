#!/bin/sh
# Runs the packaged app checks in the CI container image. Validation calls it after
# the build, and scripts/test-packaged runs it locally. Arguments go to main.ts.
set -eu

here=$(cd -- "$(dirname -- "$0")" && pwd)
export T3_TEST_CHECKOUT="$here/../.."

# Install dependencies in a copy so a read-only checkout stays untouched.
work=$(mktemp -d)
cp -r "$here/." "$work"
# npm ships with Node, so this needs nothing beyond the image's Node.
(cd "$work" && npm ci --silent --no-audit --no-fund && npm run --silent typecheck)
exec node "$work/main.ts" "$@"
