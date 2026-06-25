#!/usr/bin/env bash
set -euo pipefail

# Update npm to latest.
echo "🔄 Updating npm..."
npm install -g npm@11.6.0

# Install Claude Code CLI.
echo "🤖 Installing Claude Code..."
npm install -g @anthropic-ai/claude-code@latest

# Install GPT-5 Codex CLI.
echo "🧠 Installing GPT5 Codex..."
npm install -g @openai/codex@latest

# Install Gemini CLI.
echo "✨ Installing Gemini CLI..."
npm install -g @google/gemini-cli@latest

# Install Powerlevel10k theme for oh-my-zsh.
echo "🎨 Installing Powerlevel10k..."
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git \
  "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
sed -i '/^ZSH_THEME=/s/ZSH_THEME=".*"/ZSH_THEME="powerlevel10k\/powerlevel10k"/' ~/.zshrc
cp "$(dirname "$0")/p10k.zsh" ~/.p10k.zsh
echo '[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh' >> ~/.zshrc

# Remove stale Yarn APT repo (missing GPG key breaks apt-get update).
sudo rm -f /etc/apt/sources.list.d/yarn.list

# Install PlayWright + Chromium (headless shell for pnpm test:e2e).
echo "🎭 Installing Playwright core..."
npx -y playwright@latest install --with-deps chromium || {
  echo "⚠️  --with-deps failed, retrying without system deps..."
  npx -y playwright@latest install chromium
}

# Remove all MCP servers.
echo "🧹 Removing any old MCP entries..."
rm -f .mcp.json
rm -f .playwright-mcp.json

# Install Playwright MCP with config.
echo "📝 Writing Playwright MCP config (explicit executablePath, headless)..."
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

# Configure Claude Code MCP.
echo "🔌 Registering MCP server for Claude Code (CLI)..."
claude mcp add playwright --scope project -- \
  npx @playwright/mcp@latest --config ./.playwright-mcp.json
claude mcp add context7 -- npx -y @upstash/context7-mcp@latest --api-key ${CONTEXT7_API_KEY} 

# Configure Gemini CLI MCP.
echo "⚙️ Registering MCP server for Gemini CLI (CLI)..."
gemini mcp add playwright \
  npx @playwright/mcp@latest --config ./.playwright-mcp.json
gemini mcp add context7 npx -y @upstash/context7-mcp@latest --api-key ${CONTEXT7_API_KEY}

# Configure Codex CLI MCP (config file only - no CLI available).
#echo "🔧 Setting up Codex CLI MCP configuration (TOML file)..." mkdir -p ~/.codex
#cat > ~/.codex/config.toml <<TOML
#[mcp_servers.playwright]
#command = "npx"
#args = ["@playwright/mcp@latest", "--config", "./.playwright-mcp.json"]
#[mcp_servers.context7]
#command = "pnpm"
#args = ["dlx", "@upstash/context7-mcp@latest", "--api-key", "${CONTEXT7_API_KEY}"]
#TOML
#
## Done.
echo "✅ Setup complete."
