# moving-target

A [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (DSH) plugin that
gives every new agent session a **one-paragraph project goal** — distilled from your own
session history, frozen until you choose to update it.

## What it does

Project context lives between two extremes:

- **No memory** — the agent re-deduces the project's purpose from the code every session.
  Cheap to maintain, slow to start.
- **Everything documented** — specs and history files in the repo. Fast to start, but they
  go stale, and every stale idea contaminates every future session's context.

moving-target is the lightweight middle ground: a single ~10,000-foot overview of what the
project is about, written once, injected into every new session, and updated **only when
you say so**.

- `moving-target-bootstrap` — run once per project. It extracts the **first prompt you
  sent to every past session** in the workspace (a deterministic scan of the DSH session
  store — no LLM in the extraction itself) and has the agent distill them into one goal
  paragraph, saved to `.moving-target/summary.md` in the repo.
- From then on, every **new** session starts with that paragraph already injected — before
  your first prompt. Resumed sessions and un-bootstrapped projects are untouched.
- `moving-target-update` — refreshes the summary from the **current session only**. The
  goal moves as a project evolves; you decide when the frozen overview follows it. The
  current summary is injected into the update prompt; the agent never edits the file
  behind your back.

Not bootstrapped? Nothing happens — zero overhead.

## Why it exists

AGENTS.md-style goal statements rot because the goal is a moving target, and nothing
marks the moment it moved. The truest record of what a project is about is the first
thing you said about it, every time you started a session. moving-target turns that
record into context that stays fresh on your terms.

## Install

Plugins install per-profile. From this repo:

```bash
npm pack
dsh plugin --profile <your-profile> add file:/path/to/moving-target-0.1.0.tgz
```

Mount it by adding an insert row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: moving-target
      name: moving-target
```

## Quick start

```text
/moving-target-bootstrap     # once per project; re-runnable, overwrites
```

Then do nothing — new sessions pick up the summary automatically. When a session changes
or expands the project's frontier:

```text
/moving-target-update        # refresh the summary from this session
```

The standalone extractor also works without the plugin:

```bash
npx moving-target-extract /path/to/workspace
# 2026-08-22 20:19 /myproject Here, in this folder, I want to implement…
```

### `.gitignore` guidance

`.moving-target/` is personal context distilled from *your* session history — ignore it
by default:

```gitignore
.moving-target/
```

Commit it deliberately only if the team agrees the summary should be shared (and
re-bootstrapped collectively).

## Requirements

- Node ≥ 22.6 (type-stripping) and the `zstd` binary on PATH.
- Sessions are read-only to moving-target; it never writes to the DSH store.

## Caveats

- The summary is a snapshot; refresh it deliberately (`bootstrap` or `update`).
- Subagent sessions are excluded; only sessions whose first message came from a human
  count.
- The injected summary is model-facing context — visible in transcripts, not a substitute
  for a real prompt.

## License

MIT — see [LICENSE](LICENSE).
