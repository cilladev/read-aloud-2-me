#!/usr/bin/env bash
# Builds Read Aloud 2 Me from source and installs it into VS Code (macOS and Linux).
# Usage: ./install.sh            installs into VS Code
#        ./install.sh cursor     installs into another editor's CLI, e.g. cursor, windsurf, codium
set -euo pipefail

EDITOR_CLI="${1:-code}"
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or later is needed: https://nodejs.org" >&2
  exit 1
fi
if ! command -v "$EDITOR_CLI" >/dev/null 2>&1; then
  echo "The '$EDITOR_CLI' command isn't on your PATH." >&2
  echo "In VS Code: Command Palette > Shell Command: Install 'code' command in PATH." >&2
  exit 1
fi

echo "Installing dependencies..."
npm ci

echo "Building..."
npm run vsix

echo "Installing into $EDITOR_CLI..."
"$EDITOR_CLI" --install-extension read-aloud-2-me.vsix --force

echo "Done. Reload the editor window to start using Read Aloud 2 Me."
