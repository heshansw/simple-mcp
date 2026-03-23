#!/bin/bash
# MCP server launcher — sets up Node via nvm then runs tsx
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Switch to Node 22 (project requires Node 20+)
nvm use 22 --silent 2>/dev/null || nvm use 20 --silent 2>/dev/null

# cd to project root so relative imports resolve correctly
cd "$(dirname "$0")"

# Disable colors — in stdio mode stdout is JSON-RPC only, ANSI codes corrupt the stream
export NO_COLOR=1
export FORCE_COLOR=0

# Load .env into the environment — do this in bash to avoid dotenv printing to stdout
# (dotenv v17 prints "[dotenv@17.x] injected N env vars" which corrupts the JSON-RPC stream)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec ./node_modules/.bin/tsx src/cli.ts start
