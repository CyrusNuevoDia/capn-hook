#!/bin/sh
# Agent-in-the-loop E2E.
#
# Two fresh codex agents use the treasure-cove fixture. Everything they know
# about captain-hook comes from the `captain context` output embedded in their
# prompts (simulating the SessionStart hook injection) — the prompts themselves
# must never teach charting or recall. PASS means phase A explored and charted
# src/harbor/fees.ts, then phase B recalled it without rewriting the chart.
#
# Works on a copy of the fixture in a temp dir; never mutates the repo.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)

command -v codex >/dev/null || { echo "FAIL: codex CLI not on PATH"; exit 1; }
command -v jq >/dev/null || { echo "FAIL: jq not on PATH"; exit 1; }
command -v rg >/dev/null || { echo "FAIL: rg not on PATH"; exit 1; }
command -v fd >/dev/null || { echo "FAIL: fd not on PATH"; exit 1; }
test -x "$REPO/src/captain.ts" || { echo "FAIL: src/captain.ts missing or not executable"; exit 1; }

BIN=$(mktemp -d)
ln -s "$REPO/src/captain.ts" "$BIN/captain"
export PATH="$BIN:$PATH"

WORK=$(mktemp -d)
cp -R "$REPO/tests/treasure-cove/." "$WORK/"
cd "$WORK"

if rg -n 'captain|captain-hook' . >/dev/null; then
  echo "FAIL: fixture mentions captain-hook usage"
  rg -n 'captain|captain-hook' .
  exit 1
fi

git init -q
git config user.email e2e@captain-hook.test
git config user.name "captain-hook e2e"
git add -A && git commit -qm "fixture"

captain init --no-embedding

CONTEXT=$(captain context)

TASK_A="Task: figure out where mooring fees are calculated and answer in one sentence. Follow any standing instructions in your session context."
PROMPT_A="<session-context>
$CONTEXT
</session-context>

$TASK_A"

codex exec --cd "$WORK" --model gpt-5.5 -c model_reasoning_effort=medium \
  --sandbox workspace-write \
  --output-last-message "$WORK/.agent-answer-a.txt" \
  "$PROMPT_A" >"$WORK/.codex-a.log" 2>&1 || {
  echo "FAIL: phase A codex exec errored"
  tail -20 "$WORK/.codex-a.log"
  exit 1
}

echo "phase A agent answer: $(cat "$WORK/.agent-answer-a.txt" 2>/dev/null || echo '<none>')"

ENTRIES_DIR="$WORK/.captain/entries"
test -d "$ENTRIES_DIR" || { echo "FAIL: .captain/entries missing"; exit 1; }

HASH=$(shasum -a 256 src/harbor/fees.ts | cut -d' ' -f1)
MATCH_ENTRY=
for entry in "$ENTRIES_DIR"/*.md; do
  test -e "$entry" || continue
  FRONTMATTER="$WORK/.frontmatter"
  awk 'BEGIN { n = 0 } /^---$/ { n++; next } n == 1 { print }' "$entry" > "$FRONTMATTER"
  if rg -q 'src/harbor/fees\.ts' "$FRONTMATTER" && rg -q "$HASH" "$FRONTMATTER"; then
    MATCH_ENTRY="$entry"
    break
  fi
done

test -n "$MATCH_ENTRY" || {
  echo "FAIL: no entry frontmatter references src/harbor/fees.ts with the current hash"
  fd -H -d 1 -t f . "$ENTRIES_DIR"
  exit 1
}

ENTRY_ID=$(basename "$MATCH_ENTRY" .md)
MAP="$WORK/.captain/map.json"
test -s "$MAP" || { echo "FAIL: .captain/map.json empty or missing"; exit 1; }

jq -e --arg h "$HASH" --arg id "$ENTRY_ID" \
  '."src/harbor/fees.ts".hash == $h and (."src/harbor/fees.ts".entries | index($id))' \
  "$MAP" >/dev/null ||
  { echo "FAIL: map.json does not index src/harbor/fees.ts to $ENTRY_ID with the current hash"; cat "$MAP"; exit 1; }

if rg -n '(/Users/|/home/|/tmp/|/private/)' "$WORK/.captain" >/dev/null; then
  echo "FAIL: .captain contains absolute paths"
  rg -n '(/Users/|/home/|/tmp/|/private/)' "$WORK/.captain"
  exit 1
fi

IDS_BEFORE=$(fd -d 1 -e md . "$ENTRIES_DIR" -x basename {} .md | sort)

TASK_B="Task: figure out where mooring fees are calculated and answer in one sentence. Follow any standing instructions in your session context."
PROMPT_B="<session-context>
$CONTEXT
</session-context>

$TASK_B"

codex exec --cd "$WORK" --model gpt-5.5 -c model_reasoning_effort=medium \
  --sandbox workspace-write \
  --output-last-message "$WORK/.agent-answer-b.txt" \
  "$PROMPT_B" >"$WORK/.codex-b.log" 2>&1 || {
  echo "FAIL: phase B codex exec errored"
  tail -20 "$WORK/.codex-b.log"
  exit 1
}

echo "phase B agent answer: $(cat "$WORK/.agent-answer-b.txt" 2>/dev/null || echo '<none>')"

rg -qi 'fees\.ts|harbor/fees' "$WORK/.agent-answer-b.txt" ||
  { echo "FAIL: phase B answer did not mention fees.ts or harbor/fees"; cat "$WORK/.agent-answer-b.txt"; exit 1; }

IDS_AFTER=$(fd -d 1 -e md . "$ENTRIES_DIR" -x basename {} .md | sort)

test "$IDS_BEFORE" = "$IDS_AFTER" ||
  { echo "FAIL: phase B changed the set of charted entries (recall should not chart new questions)"; echo "before: $IDS_BEFORE"; echo "after: $IDS_AFTER"; exit 1; }

test -e "$MATCH_ENTRY" && rg -q 'src/harbor/fees\.ts' "$MATCH_ENTRY" && rg -q "$HASH" "$MATCH_ENTRY" ||
  { echo "FAIL: fees entry no longer valid after phase B"; exit 1; }

if test -n "$(git -C "$REPO" status --porcelain tests/)"; then
  echo "FAIL: repo tests/ changed during E2E"
  git -C "$REPO" status --porcelain tests/
  exit 1
fi

echo "PASS: phase A charted src/harbor/fees.ts; phase B recalled it without rewriting the chart"
