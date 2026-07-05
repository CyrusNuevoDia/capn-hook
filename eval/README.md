# capn-hook eval corpus

This directory is for repeatable capn-hook evaluation work against real open
source applications.

## Layout

- `repos.lock.json` records the intended external repositories and pinned HEAD
  commits for this checkout.
- `repos/` contains local clones of those repositories. It is gitignored because
  the clones are large, disposable inputs.
- `cases/` is where tracked eval cases can live once the corpus shape settles.
- `runs/` is for local eval output and scratch artifacts. It is gitignored.

## First corpus

The initial corpus favors production applications over frameworks:

- Polar: `git@github.com:polarsource/polar.git`
- PostHog: `git@github.com:PostHog/posthog.git`
- Twenty: `git@github.com:twentyhq/twenty.git`
- Dub: `git@github.com:dubinc/dub.git`
- Documenso: `git@github.com:documenso/documenso.git`

Use full clones rather than shallow clones so future eval cases can inspect
history, moved files, and older context when useful. The repos are still local
inputs, not vendored project code.

## Refreshing

To refresh a repo later, update the checkout under `repos/<slug>`, then update
the matching `commit` in `repos.lock.json` with:

```sh
git -C eval/repos/<slug> rev-parse HEAD
```

Do not commit anything under `eval/repos/` or `eval/runs/`.
