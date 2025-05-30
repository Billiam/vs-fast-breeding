#!/usr/bin/env bash
set -e
NODE_VERSION=$(node -p -e "require('./src/modinfo.json').version")

rm -f ./fast-breeding*.zip
cd src
zip -r ../fast-breeding_${NODE_VERSION}.zip *
echo "Built fast-breeding_${NODE_VERSION}.zip"
