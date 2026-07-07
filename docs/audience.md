# Who capn is for

capn pays off when three things are true at once:

1. **The same working copy sees repeated agent sessions.** Break-even is ~1.6 recalls ([eval](../eval/RESULTS.md)) — a repo you'll never revisit never breaks even.
2. **The codebase is big enough that "where does X live?" costs real exploration.** On the eval repos (Dub, Polar, PostHog, Twenty, Documenso), a cold answer costs 190k–350k tokens.
3. **The code is stable enough that answers survive between sessions.** Charts self-delete when their files change, so a file churning daily never accumulates memory — safe, but no payoff.

If that's you, you're probably one of these people.

## The daily driver

You run Claude Code or Codex on the same repo every day. Sessions end, get `/clear`ed, or compact away — and every fresh session re-pays for discoveries the last one already made. capn is the map that survives the session boundary. You install it once (`capn init`) and never think about it again; the agent asks and charts on its own.

## The large-codebase resident

You work in a production monorepo where nobody holds the whole thing in their head — least of all an agent with a fresh context window. The expensive part of most agent tasks isn't the edit, it's the twenty tool calls locating where the edit goes. That location step is exactly what capn amortizes: 77% fewer tokens on questions an earlier session already answered.

## The multi-agent switcher

You bounce between Claude Code and Codex on the same checkout. Both hooks read the same `.capn/` — the chart one agent draws in the morning, the other recalls in the afternoon. The core is a plain CLI and a markdown file format; any agent that can run a shell command can join.

## The headless operator

You run agents that start cold every time: scheduled jobs, review bots, non-interactive `codex exec` runs. Cold starts are where re-exploration costs compound — the same repo questions, paid for on every run. Where session hooks don't fire (non-interactive `codex exec` fires no SessionStart hooks), include the output of `capn context` in the prompt instead; the contract is one short block of text.

## Who it's not for

- **One-shot work.** Scaffolding a throwaway script, answering a single question about a repo you'll never open again — exploration you pay for once is exploration capn can't refund.
- **Codebases that fit in one read.** If the agent can read the whole project in a couple of tool calls, there's no search to skip.
- **Team knowledge sharing.** `.capn/` is gitignored local memory by design. It's your agent's map of the coastline, not your team's wiki — entries are disposable, personal to the working copy, and safe to lose.
- **Anything a file can't answer.** Live failures, external services, "why is prod down" — capn's answers are sets of files, backed by content hashes. If the answer isn't in the repo, it doesn't belong in the chart.

## What capn is not

- **Not CLAUDE.md / AGENTS.md.** Those are instructions *you* write, hand-maintain, and load into every session. capn entries are discoveries *the agent* writes, recalled on demand, and invalidated automatically. They're complementary: rules of conduct in AGENTS.md, map of the territory in `.capn/`.
- **Not documentation.** Docs are for humans and rot silently. Charts delete themselves the moment they'd lie — the worst case is the agent re-explores, which is exactly the status quo.
- **Not RAG over your codebase.** capn doesn't index your source; it indexes questions already answered, each pinned to the files that answer it. The index is a local sqlite under `.capn/` — no daemon, no server, nothing to keep running.
