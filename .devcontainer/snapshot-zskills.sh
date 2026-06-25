#!/usr/bin/env bash
# Run this once after /update-zskills to commit the generated bundle.
set -euo pipefail

BUNDLE=".devcontainer/zskills"
mkdir -p "$BUNDLE/skills" "$BUNDLE/hooks" "$BUNDLE/scripts"

echo "Snapshotting .claude/skills/ -> $BUNDLE/skills/ ..."
cp -r .claude/skills/. "$BUNDLE/skills/"

echo "Snapshotting .claude/hooks/ -> $BUNDLE/hooks/ ..."
cp -r .claude/hooks/. "$BUNDLE/hooks/"

echo "Snapshotting scripts/ -> $BUNDLE/scripts/ ..."
cp -r scripts/. "$BUNDLE/scripts/"

if [ -f ".claude/zskills-config.json" ]; then
  echo "Snapshotting zskills-config.json ..."
  cp .claude/zskills-config.json "$BUNDLE/zskills-config.json"
fi

if [ -f ".claude/zskills-config.schema.json" ]; then
  echo "Snapshotting zskills-config.schema.json ..."
  cp .claude/zskills-config.schema.json "$BUNDLE/zskills-config.schema.json"
fi

echo "Done. Commit $BUNDLE/ to lock the bundle:"
echo "  git add .devcontainer/zskills && git commit -m 'chore: snapshot zskills bundle'"
