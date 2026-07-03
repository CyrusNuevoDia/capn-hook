---
shaping: true
---

# Captain Hook — Frame

## Source

> So I was thinking that we could create this clod hook that should work with any agent. Let's make it just work with Claude right now in this new folder. You can create a git repo with it and keep track of your progress however you want.
>
> The idea of this is that every so often the agent, the coding agent, can be like, "Oh looks like I discovered this thing. I went down this path, I checked this file, then that file, and this file is where the stuff is stored." It could maintain, let's say, an index of questions and where it can find answers to those questions. The idea is that this is a form of memory, a dynamic memory.
>
> It would also probably be useful for it to store the hash of the file so that if the files change you can go and cache bust the memory and then just delete them. It doesn't need to deal with updating; it is either delete or add and deleting is like cache busting and adding is like, "Oh it went down the path." It shouldn't add it because the idea is that if an agent is spending time going to discover different things along the way, it can remember that route and that path and save for itself some hints in a way automatically. It basically builds a map for itself.
>
> That's why I call it Captain Hook because it's like a captain going and exploring and charting and making maps, and it uses hooks.

## Problem

Coding agents re-explore the same codebase every session. The path from "where is X handled?" to "it's in `foo/bar.ts`" costs real time and tokens, and the discovery evaporates when the session ends. Nothing persists the *route* the agent took.

## Outcome

The agent charts a map for itself as it explores: an index of questions → where the answers live (files + hints), persisted per-project. Future sessions start with the map already in context. Entries carry content hashes of the files they reference; when a file changes, its entries are deleted (cache-bust), never updated. Add or delete — nothing else.
