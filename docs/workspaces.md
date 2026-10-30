---
shaping: true
---

# Central workspaces

Capn stores related repositories in one central workspace and selects discoveries by the files in the invoking checkout's context. A changed file hides a discovery without deleting it, so divergent worktrees can recall different versions and a revert can restore an earlier answer.

## Decision and scope

The approved design replaces project-local memory with an immutable discovery pool under `~/.capn/`. Existing local `.capn/` directories aren't read, modified, or migrated. Claude Code and Codex hooks remain in each checkout.

The requirements came from these requests:

> Related repos worked on together, such as frontend, API, and shared libraries

> Repos can live anywhere on disk. Maybe we have like a ~/.capn/ directory to manage everything instead of .capn/ directories in every project

> Replace project-local storage entirely (Recommended)

Retention is part of the contract: cleanup deletes confirmed dead checkout bindings and unused derived indexes, while discoveries remain available for future matching code. Copy-on-write snapshots were considered, but they would require ancestry, overlays, shadowing, and merge semantics. Content applicability gives worktrees independent answers without maintaining a second version-control history.

## Register related repositories

```sh
cd /Volumes/Code/shop-web
capn init --workspace shop --repo web --no-embedding
cd /Users/me/Git/shop-api
capn init --workspace shop --repo api
cd /Volumes/Code/shop-shared
capn init --workspace shop --repo shared
```

Each checkout has exactly one workspace owner. Plain `capn init` reuses an existing owner or creates an isolated workspace. Explicit workspace and repository names join related repositories; ownership or alias conflicts fail before mutation. An explicit embedding flag changes workspace policy, while omitted flags preserve an existing policy. `--git` requires a Git checkout and installs the hook at Git's configured hook path.

Capn canonicalizes checkout paths and uses the nearest Git root. Git's canonical common directory relates worktrees, so a sibling worktree inherits an unambiguous workspace owner. Branch names and remotes aren't identities. For directories outside Git, commands resolve the deepest registered ancestor.

## Resolve the checkout context

The invoking checkout supplies files for its own repository alias. The initial registered checkout supplies files for every companion alias. A web worktree therefore uses its own web files and the designated API and shared-library checkouts, without inferring branch pairings.

Chart a joint discovery with ordinary relative or absolute filesystem paths:

```sh
cd /Volumes/Code/shop-web
capn chart "Where does checkout create an order?" \
  --files src/checkout.ts,/Users/me/Git/shop-api/src/orders.ts
```

Records store logical references such as `web/src/checkout.ts` and `api/src/orders.ts`. Recall resolves them to absolute paths for the selected context, so the agent can open the actual files. A chart rejects files outside those roots, symlink escapes, unrelated nested Git repositories, and alternate worktrees that aren't part of the selected context. If a companion checkout is unavailable, records depending on it can't answer; unrelated discoveries remain eligible.

## Keep immutable discovery versions

A record's content identity includes its exact question, details, and sorted logical file paths with complete SHA-256 file hashes. The ID uses the first 16 lowercase hexadecimal characters of the content identity. The timestamp is excluded, so identical content deduplicates; changing details or evidence creates another version.

For a given context, capn checks every backing file, then selects the newest applicable version per exact question. The version ID breaks timestamp ties deterministically. A missing or changed file makes that version inapplicable; it doesn't erase the record.

1. **Main contains H1.** Charting question Q saves version V1 with the backing file's full hash H1. Main selects V1.
2. **A worktree contains H2.** V1 doesn't apply there. Charting Q saves V2 with hash H2, while main still selects V1.
3. **Git removes the worktree.** After Git confirms removal, cleanup can remove its binding and unreferenced indexes. Both discovery versions remain.
4. **Main reaches H2.** Its next command selects retained V2. Reverting to H1 restores V1 without another chart operation.

The commands expose this distinction:

| Command | Effect |
| --- | --- |
| `capn ask "<question>"` | Search the selected applicable versions and emit up to five ranked JSONL hits with absolute files and the workspace name |
| `capn list` | Show the full workspace inventory, including hidden versions and their IDs |
| `capn unchart <versionId>` | Forget that exact version workspace-wide |
| `capn bust <path>` | Forget applicable versions citing the normalized logical file |
| `capn prune` | Reconcile the view and clean confirmed dead bindings and unused derived indexes, retaining discoveries |

`chart` creates immutable versions; `unchart` and `bust` forget them. There is no entry update command, migration layer, or per-worktree tombstone system.

## Isolate each search corpus

Capn narrows the corpus before QMD searches it. Filtering a fixed set of results after retrieval can lose valid hits: in a hermetic SDK experiment, 61 collections with identical documents produced no target hit at limit five under a collection filter, while an isolated database returned the target. Inapplicable records must never compete with applicable records for retrieval candidates.

Each selected record set and search mode identifies a disposable generation. Matching contexts can reuse the same complete generation. A changed selection builds a fresh database at its final stable directory, because QMD stores the collection path. Only selected Markdown records enter that database.

The ready marker is published atomically after update, optional embedding, and close succeed. A partial generation never serves an old selection; a later command retries the build. The whole SQLite directory, including WAL and SHM files, stays together. No private QMD SQL or maintenance operations are required.

```text
~/.capn/
  config.json
  workspaces/shop/
    entries/<versionId>.md
    views/<selectionFingerprint>/
      entries/<versionId>.md
      qmd/index.sqlite
      qmd/index.sqlite-wal
      qmd/index.sqlite-shm
      ready.json
```

Markdown records are authoritative; generation entries and QMD databases are derived. The registry has one authority, `~/.capn/config.json`, rather than a separate reverse map with competing ownership information.

Global model downloads remain shared, but separate generation databases duplicate embeddings. A synthetic local BM25 build of 500 documents took 282 ms and used 5.24 MB; this fixture result isn't a latency guarantee. Hybrid rebuild cost hasn't been measured.

## Serialize workspace operations

A process-safe workspace lock covers record mutation, applicability selection, generation construction, search, final validation, and cleanup. Commands in different workspaces can proceed independently. A shorter global config lock protects registry writes, with workspace locks acquired first when both are needed.

Atomic record and config writes prevent partial files from becoming visible. The directory-lock owner includes its process ID; a lock is reclaimed only when the owner is definitively dead, never because the lock is old. A busy lock times out with a diagnostic. Recall rechecks dependencies after retrieval and retries once if external file edits raced the search; repeated changes fail explicitly instead of returning an unverified answer.

## Clean only confirmed disposable state

Cleanup inspects Git metadata opportunistically; it doesn't run a daemon, scan the filesystem, or use a TTL. An absent checkout root isn't enough to remove a binding. Capn requires an accessible, complete `git worktree list --porcelain -z` result that no longer lists that checkout, plus its absent root. Unavailable common directories and locked worktrees retain their bindings.

Git's administration path survives branch switches and supported `git worktree move`, but Git can reuse it after removal and re-creation. A binding is revalidated rather than treating that path as a permanent Git UUID. Arbitrary broken metadata needs repair; a raw directory rename and an unmounted volume can't be distinguished safely from absence alone.

An unused derived generation can be removed only when no surviving binding references it. Discoveries remain in the immutable pool even after every matching checkout disappears, because matching code can return later.

## Verification contract

Tests exercise the real CLI in subprocesses, with a temporary HOME and separate repositories for each case. BM25 tests require no model download. Available-model tests cover hybrid behavior without downloading models implicitly.

The contract covers scattered repository membership and isolation, subdirectory and nested Git boundaries, joint discoveries, H1/H2/revert retention, deduplication, applicable winner selection before top-K retrieval, and absolute recall paths. Safety checks cover malicious version IDs, escaped file references, process contention, interrupted generation recovery, custom Git hooks, host QMD isolation, and the absence of project-local storage writes.

Lifecycle checks cover worktree moves, confirmed removal, remove/re-add, locked or unavailable checkouts, retained discoveries, and generations shared by surviving bindings. The agent E2E uses a rebuilt launcher and actual command-event evidence to prove that a later agent successfully recalled an applicable discovery. Test results and paid-run evidence belong to their run reports; this guide defines the behavior they must prove.
