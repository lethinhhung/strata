# Strata

Strata is a CLI for specification-led implementation in a target Git repository. It plans an epic into stages, coordinates AI agents to implement and validate each stage, and saves runs so interrupted work can resume.

## Requirements

- Node.js 20 or newer and Git
- Codex CLI and OpenCode CLI installed and authenticated (or configured provider alternatives)
- A clean target repository checked out on a named branch; completed stages are committed and pushed to that branch

## Install

```sh
npm ci
npm run build
npm link
```

Strata reads `.strata.toml` from the target repository. Create a default config with `strata init --repo DIR`.

## Use

```sh
strata run "Implement feature A" --repo ../my-project
strata run --epic ./epic.md --repo ../my-project
strata status --repo ../my-project
strata resume RUN_ID --repo ../my-project
```

Runs save the epic at `prompt/epic.md` and state under `docs/temps/` in the target repository. Completed stages are preserved when resuming.

## Codex skill

This repository includes an installable Codex skill at [`.agents/skills/strata-run/SKILL.md`](.agents/skills/strata-run/SKILL.md). It guides Codex to build the latest Strata CLI in a dedicated cache, then run, monitor, or resume workflows in a target repository.

## Development

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```
