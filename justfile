set export
set ignore-comments
set script-interpreter := ['bash', '-eu']
set quiet
set unstable

[script]
_default:
    just --list

# Install dependencies
[script]
deps:
    set -euo pipefail
    mise install
    npm install

# Bundle src/main.ts → dist/main.js
build:
    npm run build

# Run test suite
test *args:
    npm test -- {{ args }}

# Run eval harness against labeled fixtures
eval:
    npm run eval

# Run tests in watch mode
test-watch:
    npm run test:watch

# Run TypeScript type checker
typecheck:
    npx tsc --noEmit

# Run linters and static checks
lint: typecheck

# Run all checks (lint + tests)
check: lint test

# Auto-format justfile
format:
    just --fmt

# Remove build artifacts and dependencies
[script]
clean:
    set -euo pipefail
    rm -rf node_modules dist
