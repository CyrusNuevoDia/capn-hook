#!/bin/sh
# Agent-in-the-loop E2E.
#
# A codex agent explores the treasure-cove fixture cold. Everything it knows
# about captain-hook comes from the `captain context` output embedded in its
# prompt (simulating the SessionStart hook injection) — the prompt itself must
# never teach charting. PASS means the agent both answered the question and
# charted the route: a map entry referencing src/harbor/fees.ts with a valid
# content hash and relative path.
#
# Works on a copy of the fixture in a temp dir; never mutates the repo.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)

command -v codex >/dev/null || { echo "FAIL: codex CLI not on PATH"; exit 1; }
command -v jq >/dev/null || { echo "FAIL: jq not on PATH"; exit 1; }
test -x "$REPO/src/captain.ts" || { echo "FAIL: src/captain.ts missing or not executable"; exit 1; }

BIN=$(mktemp -d)
ln -s "$REPO/src/captain.ts" "$BIN/captain"
export PATH="$BIN:$PATH"

WORK=$(mktemp -d)
cp -R "$REPO/tests/treasure-cove/." "$WORK/"
cd "$WORK"
git init -q
git config user.email e2e@captain-hook.test
git config user.name "captain-hook e2e"
git add -A && git commit -qm "fixture"

captain init

CONTEXT=$(captain context)

PROMPT="<session-context>
$CONTEXT
</session-context>

Task: figure out where mooring fees are calculated in this codebase and answer in one sentence. Follow any standing instructions in your session context above."

codex exec --cd "$WORK" --model gpt-5.5 -c model_reasoning_effort=medium \
  --sandbox workspace-write \
  --output-last-message "$WORK/.agent-answer.txt" \
  "$PROMPT" >"$WORK/.codex.log" 2>&1 || {
  echo "FAIL: codex exec errored"
  tail -20 "$WORK/.codex.log"
  exit 1
}

echo "agent answer: $(cat "$WORK/.agent-answer.txt" 2>/dev/null || echo '<none>')"

MAP="$WORK/.captain/map.jsonl"
test -s "$MAP" || { echo "FAIL: agent charted nothing ($MAP empty or missing)"; exit 1; }

jq -es 'length > 0 and any(.[]; any(.files[]; .path == "src/harbor/fees.ts"))' "$MAP" >/dev/null ||
  { echo "FAIL: no entry references src/harbor/fees.ts"; cat "$MAP"; exit 1; }

HASH=$(shasum -a 256 src/harbor/fees.ts | cut -d' ' -f1)
jq -es --arg h "$HASH" 'any(.[]; any(.files[]; .path == "src/harbor/fees.ts" and .hash == $h))' "$MAP" >/dev/null ||
  { echo "FAIL: charted hash does not match sha256 of src/harbor/fees.ts"; cat "$MAP"; exit 1; }

jq -es 'all(.[]; all(.files[]; .path | startswith("/") | not))' "$MAP" >/dev/null ||
  { echo "FAIL: map contains absolute paths"; cat "$MAP"; exit 1; }

echo "PASS: agent answered and charted src/harbor/fees.ts with a fresh hash"
