# Contributing

Thanks for looking at moving-target. PRs welcome.

## Workflow

1. Fork / branch from `main`.
2. Make the change with a test that pins it (`src/*.test.ts`, `node --test`).
3. Run the local gate:

   ```bash
   npm install        # dev deps only — zero runtime dependencies
   npm run build      # required: tests import from lib/
   npm test           # full suite (21 tests at time of writing; needs zstd on PATH)
   ```

   `npm test` alone is not the gate — the suite imports the compiled `lib/`
   output, so a clean checkout fails until `npm run build` has run. Node
   >= 22.6 (type-stripping) and the `zstd` binary are required.

4. Open a PR describing what changed and why.

CI runs the same gate on Node 22; a PR is mergeable when it is green.

## Ground rules

- ESM only, Node >= 22.6, `zstd` must be on PATH for the extractor.
- No new runtime dependencies without discussion — the package ships zero
  (peer dependencies cover the DSH plugin API only).
- The DSH session store is read-only to moving-target. A change that writes
  anything into the store needs a discussion first.
- Extraction is deterministic: the session scan (`src/extract.ts`) never
  calls an LLM. Distillation happens only inside the bootstrap/update
  commands, driven by the agent.
- The summary is frozen by design: nothing may edit
  `.moving-target/summary.md` behind the operator's back — it changes only
  when `/moving-target-bootstrap` or `/moving-target-update` runs.
- Subagent sessions stay excluded from extraction; only sessions whose first
  message came from a human count.
- Update [README.md](README.md) when the command surface or the mount
  wiring changes — the README is the single manual.

## Reporting bugs

Open a GitHub issue with: the moving-target version or commit, Node version,
whether `zstd` is on PATH, and the command output. Redact session content —
first prompts and summaries are personal context distilled from your own
session history, and the session store may name private directories.

## Security

See [SECURITY.md](SECURITY.md) — please do not open public issues for security reports.
