# Who capn is for

capn pays off when three things are true at once:

1. **Related checkouts see repeated agent sessions.** The historical [eval](../eval/RESULTS.md) measured break-even at ~1.6 recalls of the same question — a discovery you'll never reuse doesn't pay back its charting cost.
2. **The codebase is big enough that "where does X live?" costs real exploration.** On the eval repos (Dub, Polar, PostHog, Twenty, Documenso), a cold answer costs 190k–350k tokens.
3. **Backing files keep or return to known content.** Changed files hide a discovery from that checkout's results, but the version remains available to matching worktrees and reappears if you revert.

If that's you, you're probably one of these people.

## The daily driver

You run Claude Code or Codex on the same repo every day. Sessions end, get `/clear`ed, or compact away — and every fresh session re-pays for discoveries the last one already made. capn is the map that survives the session boundary. You install it once (`capn init`) and never think about it again; the agent asks and charts on its own.

## The large-codebase resident

You work in a production monorepo where nobody holds the whole thing in their head — least of all an agent with a fresh context window. The expensive part of most agent tasks isn't the edit, it's the twenty tool calls locating where the edit goes. Historical runs measured 77% fewer tokens for repeat questions; their filename scorer didn't establish complete answer coverage ([eval](../eval/RESULTS.md)).

## The distributed-system developer

You work across services in separate repositories. Register them in one [workspace](../README.md#related-repositories-and-worktrees), even if they live in different directories, so a discovery can connect a producer's event schema to its consumers. Separate agent sessions recall the same discovery when its backing files match their selected checkouts.

## The multi-agent switcher

You bounce between Claude Code and Codex on the same checkout. Both use the same central workspace under `~/.capn/`, so one agent can recall what the other charted. The core is a plain CLI and a Markdown file format; any agent that can run a shell command can join.

## The headless operator

You run agents that start cold every time: scheduled jobs, review bots, non-interactive `codex exec` runs. Cold starts are where re-exploration costs compound — the same repo questions, paid for on every run. Where session hooks don't fire (non-interactive `codex exec` fires no SessionStart hooks), include the output of `capn context` in the prompt instead; the contract is one short block of text.

## Who it's not for

- **One-shot work.** Scaffolding a throwaway script, answering a single question about a repo you'll never open again — exploration you pay for once is exploration capn can't refund.
- **Codebases that fit in one read.** If the agent can read the whole project in a couple of tool calls, there's no search to skip.
- **Team knowledge sharing.** `~/.capn/` is personal to your machine. Workspaces connect your local checkouts; they don't synchronize discoveries with teammates.
- **Anything a file can't answer.** Live failures, external services, "why is prod down" — capn's answers are sets of files, backed by content hashes. If the answer isn't in the workspace's repositories, it doesn't belong in the chart.

## What capn is not

- **Not CLAUDE.md / AGENTS.md.** Those are instructions *you* write, hand-maintain, and load into every session. capn entries are discoveries *the agent* writes and recalls on demand. Backing-file hashes determine which versions apply; instructions and discoveries serve different purposes.
- **Not documentation.** Docs are for humans and can outlive the code they describe. A chart disappears from recall when any backing file changes, so the agent explores again instead of receiving evidence from another version.
- **Not RAG over your codebase.** capn doesn't index your source; it indexes questions already answered, each pinned to the files that answer it. Disposable QMD generations under `~/.capn/workspaces/` contain only applicable discoveries, with no daemon or server to operate.
