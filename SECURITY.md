# Security Policy

## Scope

moving-target is a DSH plugin: it reads the DSH session store (plain or
zstd-compressed `session.jsonl` logs), distills first prompts into one goal
paragraph, and writes exactly one file — `.moving-target/summary.md` inside
the target repo. It holds no credentials, makes no network calls, and never
writes to the session store; sessions are read-only to moving-target by
design (violations of that guarantee are security bugs).

First prompts and the distilled summary are personal context: they can quote
private directories, client names, or project intent. The plugin's own
`.gitignore` guidance keeps `.moving-target/` untracked by default — commit
it only when the team deliberately decides the summary is shareable.

## Supported versions

Only the latest tag on `main` receives security fixes.

## Reporting a vulnerability

Email the owner via the contact on the GitHub profile (andrepontesmelo)
rather than opening a public issue. Include: affected version/commit, Node
version, the harness and profile involved (redact anything private), and
expected vs actual behavior. You will get an acknowledgement within 7 days
and a fix or a documented mitigation for anything confirmed.

## What is NOT a vulnerability

- Injecting the saved summary at the start of new sessions — that is the
  product's stated purpose. Audit what a plugin injects before mounting it.
- `bootstrap` / `update` rewriting `.moving-target/summary.md` when the
  operator runs them — that is the designed update path, not an unauthorized
  edit.
- Excluding subagent sessions from extraction — by design: only
  human-started sessions count, so injection stays deterministic.
- Un-bootstrapped projects staying untouched (zero overhead) — by design.
