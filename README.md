# moving-target

Cold-start context for [DeepSeek Harness](https://github.com/deepseek-ai/dsh). Every new session, you re-explain your project's goal to the agent. Context files (AGENTS.md and friends) fix that — until they rot: every stale idea and abandoned decision in them contaminates every future session.

**moving-target takes a different input**: not a hand-maintained file, but the *first prompt you sent to every past session* in this workspace. Those prompts are the truest record of what the project is about. A bootstrap run distills them into **one goal paragraph**, saved in the workspace; from then on, every new session starts with that paragraph already injected.

## How it works

1. `moving-target-bootstrap` extracts the first user prompt of every top-level session recorded for this workspace (`~/.dsh/sessions/…`, deterministic scan — no LLM involved).
2. The full DATE-TIME-PROMPT list is handed to the agent with one instruction: *summarize the end goal of this project in one paragraph*.
3. The agent returns the paragraph via the built-in `moving_target_save_summary` tool, which validates it and writes `.moving-target/summary.md` (metadata header + paragraph).
4. On every subsequent session start (`startup` only — resumed sessions are left alone), if `.moving-target/summary.md` exists in the workspace, the summary is injected as visible plugin context before your first prompt:

   > Project goal (moving-target, bootstrapped 2026-08-23T03:41:07.000Z): \<paragraph\>

Not bootstrapped? Nothing happens — zero overhead.

## Install

Plugins install per-profile. From this repo, pack a tarball and add it to your profile:

```bash
dsh plugin --profile <your-profile> add github:andrepontesmelo/moving-target
```

Or from a local checkout:

```bash
npm pack
cd ~/.dsh/profiles/<your-profile>
dsh plugin --profile <your-profile> add file:/path/to/moving-target-0.1.5.tgz
```

Mount it by adding an insert row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: moving-target
      name: moving-target
```

Requirements: Node ≥ 22.6 (type-stripping) and the `zstd` binary on PATH. Sessions are read-only to moving-target; it never writes to the DSH store.

## Usage

```text
/moving-target-bootstrap
```

Run it once per workspace. It is **re-runnable and overwrites** — that is the escape hatch when the frozen summary drifts from reality (see caveats). After bootstrapping, do nothing; new sessions pick up the summary automatically.

To update the summary based on the current session outcome:

```text
/moving-target-update
```

The current summary is read deterministically by the command and injected into the prompt — the agent never reads the file itself.

The standalone extractor CLI is available too:

```bash
npx moving-target-extract /path/to/workspace
# 2026-08-22 20:19 /wayfinder Here, in this folder, I want to implement…
```

## .gitignore guidance

`.moving-target/` is personal context distilled from *your* session history. Ignore it by default:

```gitignore
.moving-target/
```

Commit it deliberately only if the team agrees the summary should be shared (and re-bootstrapped collectively).

## Caveats

- **Summaries go stale; refresh deliberately.** The summary is a snapshot of the project at bootstrap time; re-run `/moving-target-bootstrap` or run `/moving-target-update` to refresh it.
- Subagent sessions are excluded from extraction; only sessions where the first message came from a human count.
- The injected summary is model-facing context tagged `plugin/instructions` — visible in transcripts, but it is not a substitute for a real prompt.
