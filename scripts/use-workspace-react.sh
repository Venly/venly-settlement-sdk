#!/usr/bin/env bash
# `ui` consumes @venlyfinance/react as a published dependency, so a change that
# spans react and ui cannot be verified against npm until react publishes: CI
# installs the last published react and the new export does not exist yet. This
# overlays the workspace build into ui/node_modules so CI checks ui against the
# react it actually ships with, rather than against an older one.
#
# Only dist/ and the manifest are copied, deliberately. Installing the directory
# (`npm install ../react`) drags in react's own nested node_modules, which puts
# two copies of the React renderer in the tree and makes every hook throw
# "Cannot read properties of null (reading 'useState')" - 12 spurious failures
# across unrelated blocks, none of them real.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$root/react"
npm ci
# react itself consumes @venlyfinance/sdk as a published dependency, so a
# change that spans sdk and react needs the same overlay one level down or
# react's build here compiles against an older sdk and fails on new methods.
bash "$root/scripts/use-workspace-sdk.sh" react
npm run build

target="$root/ui/node_modules/@venlyfinance/react"
rm -rf "$target"
mkdir -p "$target"
cp -R "$root/react/dist" "$target/dist"
cp "$root/react/package.json" "$target/package.json"

# ui resolves @venlyfinance/sdk directly too (block sources import its types),
# so it gets the workspace sdk for the same reason it gets the workspace react.
bash "$root/scripts/use-workspace-sdk.sh" ui

echo "ui resolves @venlyfinance/react $(node -p "require('$target/package.json').version") from the workspace"
