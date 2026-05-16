#!/bin/bash
set -e

echo "🔍 Scanning for leaked secrets..."

# Patterns to detect (IBM Cloud keys, common API keys, tokens)
PATTERNS=(
  "sk-[A-Za-z0-9]{32,}"           # OpenAI-style keys
  "AKIA[0-9A-Z]{16}"              # AWS access keys
  "Bearer [A-Za-z0-9\-._~+/]+"    # Bearer tokens
  "eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*"  # JWTs
  "xoxp-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}"    # Slack tokens
  "ghp_[A-Za-z0-9]{36}"           # GitHub personal access tokens
  "ghs_[A-Za-z0-9]{36}"           # GitHub secret tokens
  "apikey-[A-Za-z0-9-]{36,}"      # IBM Cloud API keys
  "ibm-api-key-[A-Za-z0-9-]{36,}" # IBM Cloud API keys (alternate)
)

# Files to scan
SCAN_PATHS=(
  "bob_sessions/"
  "apps/"
  "packages/"
  ".env.local"
  ".env.development"
  ".env.production"
)

FOUND=0

for pattern in "${PATTERNS[@]}"; do
  for path in "${SCAN_PATHS[@]}"; do
    if [ -e "$path" ]; then
      if grep -r -E "$pattern" "$path" 2>/dev/null; then
        echo "❌ FOUND SECRET PATTERN: $pattern in $path"
        FOUND=1
      fi
    fi
  done
done

if [ $FOUND -eq 1 ]; then
  echo ""
  echo "❌ SECRET LEAK DETECTED!"
  echo "Remove secrets before pushing. See .bobignore for excluded patterns."
  exit 1
fi

echo "✅ No secrets detected"
exit 0

# Made with Bob
