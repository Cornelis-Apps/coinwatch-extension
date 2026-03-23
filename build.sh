#!/bin/bash
# Build CoinWatch extension zip for Chrome Web Store upload
# Usage: ./build.sh

set -e

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
OUT="coinwatch-v${VERSION}.zip"

rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  popup.html popup.css popup.js \
  background.js \
  content.js \
  options.html options.js \
  ExtPay.js \
  icons/ \
  -x "*.DS_Store"

echo ""
echo "Built: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Version: $VERSION"
echo ""
echo "Next steps:"
echo "  1. Go to https://chrome.google.com/webstore/devconsole"
echo "  2. Upload $OUT"
echo "  3. Submit for review"
