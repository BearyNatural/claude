#!/usr/bin/env bash
# Installs dependencies with versions Expo itself picks for the installed SDK.
# Used by CI, and handy locally for a clean first install:
#   bash scripts/ci-install.sh
# Why: package.json versions were written from the Expo SDK 57 docs without
# registry access. `expo install` resolves the exact compatible versions and
# writes them back to package.json.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Install Expo and the dev tools first (always-safe versions).
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p._fullDependencies = p.dependencies;
p.dependencies = { expo: p.dependencies.expo };
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
npm install --no-audit --no-fund

# 2) Let Expo choose SDK-compatible versions for everything else.
DEPS=$(node -e '
const p = require("./package.json");
console.log(Object.keys(p._fullDependencies).filter((d) => d !== "expo").join(" "));
')
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
delete p._fullDependencies;
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'
# shellcheck disable=SC2086
npx expo install $DEPS -- --no-audit --no-fund
npx expo install --fix -- --no-audit --no-fund || true
echo "Dependencies installed:"
node -e 'console.log(require("./package.json").dependencies)'
