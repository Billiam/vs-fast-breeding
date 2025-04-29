#!/usr/bin/env bash
set -e
NODE_VERSION=$(node -p -e "require('./package.json').version")

rm -f ./fast-breeding*.zip
cd src
zip -r ../fast-breeding_${NODE_VERSION}.zip *
