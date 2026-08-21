#!/usr/bin/env bash
# react (and, through it, ui) consumes @venlyfinance/sdk as a published
# dependency, so a change that spans sdk and react cannot be verified against
# npm until the sdk publishes: CI installs the last published sdk and the new
# client method does not exist yet. This overlays the workspace sdk build into
# the named package directories' node_modules so CI checks them against the
# sdk they actually ship with, rather than an older one.
#
# Only dist/, specs/ and the manifest are copied, for the same reason
# use-workspace-react.sh copies only dist: installing the directory drags in
# nested node_modules and duplicate module instances.
#
# Usage: use-workspace-sdk.sh <target-package-dir> [<target-package-dir> ...]
#        e.g. use-workspace-sdk.sh react ui
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$root/dist/esm" ]; then
  (cd "$root" && npm ci && npm run build)
fi

for pkg in "$@"; do
  target="$root/$pkg/node_modules/@venlyfinance/sdk"
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$root/dist" "$target/dist"
  cp -R "$root/specs" "$target/specs"
  cp "$root/package.json" "$target/package.json"
  echo "$pkg resolves @venlyfinance/sdk $(node -p "require('$target/package.json').version") from the workspace"
done
