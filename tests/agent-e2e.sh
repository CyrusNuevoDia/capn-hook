#!/bin/sh
# Agent-in-the-loop E2E.
#
# Two fresh codex agents use the treasure-cove fixture. Everything they know
# about capn-hook comes from the `capn context` output embedded in their
# prompts (simulating the SessionStart hook injection) — the prompts themselves
# must never teach charting or recall. PASS means phase A explored and charted
# src/harbor/fees.ts, then phase B recalled it without rewriting the chart.
#
# Works on a copy of the fixture in a temp dir; never mutates the repo.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)

# CAPN_E2E_MODEL overrides the test model when another model is needed.
run_codex() {
  codex exec --json --model "${CAPN_E2E_MODEL:-gpt-6.1-terra}" "$@"
}

command -v codex >/dev/null || { echo "FAIL: codex CLI not on PATH"; exit 1; }
command -v jq >/dev/null || { echo "FAIL: jq not on PATH"; exit 1; }
command -v rg >/dev/null || { echo "FAIL: rg not on PATH"; exit 1; }
test -x "$REPO/bin/capn" || { echo "FAIL: bin/capn missing or not executable"; exit 1; }

(cd "$REPO" && bun run build) || { echo "FAIL: bun run build"; exit 1; }

BIN=$(mktemp -d)
ln -s "$REPO/bin/capn" "$BIN/capn"
export PATH="$BIN:$PATH"

WORK=$(mktemp -d)
WORK=$(cd "$WORK" && pwd -P)
# Keep auth in its existing location while all capn state and shell startup
# files belong to the fixture's HOME, including when Codex uses a login shell.
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export HOME="$WORK/.home"
mkdir -p "$HOME"
unset XDG_CACHE_HOME XDG_CONFIG_HOME
cp -R "$REPO/tests/treasure-cove/." "$WORK/"
cd "$WORK"

if rg -n 'capn|capn-hook' . >/dev/null; then
  echo "FAIL: fixture mentions capn-hook usage"
  rg -n 'capn|capn-hook' .
  exit 1
fi

git init -q
git config user.email e2e@capn-hook.test
git config user.name "capn-hook e2e"
git add -A && git commit -qm "fixture"

capn init --no-embedding

CONTEXT=$(capn context)

TASK_A="Task: figure out where mooring fees are calculated and answer in one sentence. Follow any standing instructions in your session context."
PROMPT_A="<session-context>
$CONTEXT
</session-context>

$TASK_A"

run_codex --cd "$WORK" -c model_reasoning_effort=medium \
  --sandbox workspace-write \
  --output-last-message "$WORK/.agent-answer-a.txt" \
  "$PROMPT_A" >"$WORK/.codex-a.jsonl" 2>"$WORK/.codex-a.log" || {
  echo "FAIL: phase A codex exec errored"
  tail -20 "$WORK/.codex-a.log"
  exit 1
}

echo "phase A agent answer: $(cat "$WORK/.agent-answer-a.txt" 2>/dev/null || echo '<none>')"

FEES_FILE="$WORK/src/harbor/fees.ts"
capn ask "mooring fees" > "$WORK/.fees-before.jsonl" ||
  { echo "FAIL: phase A did not chart a recallable mooring-fees answer"; exit 1; }
ENTRY_ID=$(jq -ser --arg file "$FEES_FILE" \
  '[.[] | select(.files | index($file))][0].id // empty' "$WORK/.fees-before.jsonl") ||
  { echo "FAIL: phase A chart does not back the fees file"; exit 1; }
CHARTS_BEFORE=$(capn list)

TASK_B="Task: figure out where mooring fees are calculated and answer in one sentence. Follow any standing instructions in your session context."
PROMPT_B="<session-context>
$CONTEXT
</session-context>

$TASK_B"

run_codex --cd "$WORK" -c model_reasoning_effort=medium \
  --sandbox workspace-write \
  --output-last-message "$WORK/.agent-answer-b.txt" \
  "$PROMPT_B" >"$WORK/.codex-b.jsonl" 2>"$WORK/.codex-b.log" || {
  echo "FAIL: phase B codex exec errored"
  tail -20 "$WORK/.codex-b.log"
  exit 1
}

echo "phase B agent answer: $(cat "$WORK/.agent-answer-b.txt" 2>/dev/null || echo '<none>')"

bun "$REPO/tests/agent-e2e-capn.ts" "$WORK/.codex-b.jsonl" \
  "$ENTRY_ID" "$FEES_FILE" ||
  { echo "FAIL: phase B did not recall the existing fees chart through capn ask"; exit 1; }

rg -qi 'fees\.ts|harbor/fees' "$WORK/.agent-answer-b.txt" ||
  { echo "FAIL: phase B answer did not mention fees.ts or harbor/fees"; cat "$WORK/.agent-answer-b.txt"; exit 1; }

CHARTS_AFTER=$(capn list)
test "$CHARTS_BEFORE" = "$CHARTS_AFTER" ||
  { echo "FAIL: phase B changed the chart listing"; echo "before: $CHARTS_BEFORE"; echo "after: $CHARTS_AFTER"; exit 1; }
capn ask "mooring fees" > "$WORK/.fees-after.jsonl" ||
  { echo "FAIL: fees entry no longer recallable after phase B"; exit 1; }
jq -se --arg id "$ENTRY_ID" --arg file "$FEES_FILE" \
  'any(.[]; .id == $id and (.files | index($file)))' "$WORK/.fees-after.jsonl" >/dev/null ||
  { echo "FAIL: fees chart no longer backs the fees file after phase B"; exit 1; }

if test -n "$(git -C "$REPO" status --porcelain tests/)"; then
  echo "FAIL: repo tests/ changed during E2E"
  git -C "$REPO" status --porcelain tests/
  exit 1
fi

echo "PASS: phase A charted src/harbor/fees.ts; phase B recalled it without rewriting the chart"
