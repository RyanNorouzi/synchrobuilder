#!/usr/bin/env bash
# Planted: package.json "build" requires this script and there is no portable equivalent (unix-scripts / shell-scripts).
# Also planted: the file is committed without the executable bit, so ./build.sh fails with "permission denied" (exec-bits-symlinks).
set -euo pipefail
rm -rf dist
mkdir -p dist
cp -r src dist/src
echo "built into dist/"
