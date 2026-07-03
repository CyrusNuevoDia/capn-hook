# Treasure Cove

Toy marina-management app. Fixture codebase for captain-hook's agent-in-the-loop E2E test — a real agent explores this project cold and is expected to chart what it finds.

Do not add captain-hook hints here; the point is that the agent learns charting from `captain context` alone.

## Layout

- `src/index.ts` — entrypoint, wires the harbor registry
- `src/harbor/` — berth registry and billing
- `src/gulls.ts` — seagull flock simulation (decoy; nothing important here)
