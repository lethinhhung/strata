# Strata

Strata is a CLI for specification-led implementation in a target Git repository. It uses a powerful model as the coordinator for planning, task breakdown, and review, then delegates implementation and validation work to configurable free or low-cost models to keep costs down. Runs are saved so interrupted work can resume.

## Cost-efficient model orchestration

Strata separates the coordinator (`models.strong`) from the worker agents (`models.worker`). The strong model handles high-leverage reasoning: exploring the repository, planning stages and tasks, and reviewing results. Worker agents handle focused exploration, implementation, and validation tasks, which lets you use free or lower-priced models for most of the parallel work. If a worker fails or returns an unusable result, Strata can recover with the strong model.

The default configuration uses Codex for the coordinator and OpenCode with `nvidia/openai/gpt-oss-20b` for workers. Choose models that fit your providers and budget in the target repository's `.strata.toml`:

```toml
[models.strong]
provider = "codex"
model = "" # use the provider's default, or set a capable model explicitly

[models.worker]
provider = "opencode"
model = "nvidia/openai/gpt-oss-20b" # replace with a free or low-cost model you can access
```

Both roles support the `codex` and `opencode` providers. Use the stronger model where planning and judgment matter, and tune the worker model to balance task quality, speed, and price.

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
