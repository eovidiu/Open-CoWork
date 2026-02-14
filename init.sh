#!/bin/bash
# init.sh - Open CoWork session initialization
# Installs deps, runs tests, verifies environment
#
# Exit codes:
#   0 = Success
#   1 = Dependency installation failed
#   2 = Build failed (not used — build skipped for speed)
#   3 = Tests failed

set -e

echo "=== Open CoWork Session Init ==="

# Check prerequisites
if ! command -v pnpm &> /dev/null; then
    echo "ERROR: pnpm not found. Install with: npm install -g pnpm"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "ERROR: node not found."
    exit 1
fi

# Source local overrides if present
if [ -f ".harness-local.sh" ]; then
    echo "Loading local overrides: .harness-local.sh"
    source .harness-local.sh
fi

# Install dependencies
echo ""
echo "--- Installing dependencies ---"
pnpm install || exit 1

# Generate Prisma client (required for tests)
echo ""
echo "--- Generating Prisma client ---"
pnpm db:generate || exit 1

# Run tests
echo ""
echo "--- Running tests ---"
pnpm test:run || exit 3

# Report status
echo ""
echo "--- Environment ---"
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Electron: $(node -e "console.log(require('./package.json').devDependencies.electron)")"

echo ""
echo "=== Session Init Complete ==="
