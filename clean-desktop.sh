#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$REPO_ROOT"
rm -rf "dist/webview" "webview-ui/dist/webview" "webview-ui/src-tauri/target"
