#!/usr/bin/env bash
set -euo pipefail

# Remove stale MCP entries from prior runs.
echo "🧹 Removing any old MCP entries..."
rm -f .mcp.json .playwright-mcp.json

# Write Playwright MCP config (headless Chromium, no sandbox).
echo "📝 Writing Playwright MCP config..."
cat > .playwright-mcp.json <<JSON
{
  "browser": {
    "browserName": "chromium",
    "isolated": true,
    "launchOptions": {
      "headless": true,
      "args": ["--no-sandbox", "--disable-dev-shm-usage"]
    }
  }
}
JSON

# Register MCP servers for Claude Code.
echo "🔌 Registering MCP servers for Claude Code..."
claude mcp add playwright --scope project -- \
  npx @playwright/mcp@latest --config ./.playwright-mcp.json
claude mcp add context7 -- npx -y @upstash/context7-mcp@latest --api-key "${CONTEXT7_API_KEY}"

# Register MCP servers for Gemini CLI.
echo "⚙️ Registering MCP servers for Gemini CLI..."
gemini mcp add playwright \
  npx @playwright/mcp@latest --config ./.playwright-mcp.json
gemini mcp add context7 npx -y @upstash/context7-mcp@latest --api-key "${CONTEXT7_API_KEY}"

echo "✅ Setup complete."
