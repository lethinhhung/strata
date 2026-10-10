# Strata

Strata coordinates specification-led implementation in a target Git repository. The Epic Coordinator plans stages, Stage Coordinators prepare tasks, and specialist agents implement, check, and validate each stage. Completed stages are committed and pushed to the current branch.

## Requirements

- Node.js 20 or newer and Git
- Codex CLI and OpenCode CLI installed and authenticated (or configured alternatives)
- A target repository checked out on a named working branch with a clean worktree

## Install

```sh
npm install
npm run build
npm link
```

Strata reads `.strata.toml` from the target repository when present. If it is absent, built-in defaults use Codex for coordinators and OpenCode with GPT OSS 20B for workers. Create or replace the file with `strata init --repo DIR` or `strata init --repo DIR --force`.

## Run

Pass epic text directly:

```sh
strata run "Implement feature A" --repo ../snapnote
```

Or load the epic from a file:

```sh
strata run --epic ../snapnote/docs/temps/epic.md --repo ../snapnote
```

Both forms save the epic at `prompt/epic.md` in the target repository and store workflow state under `docs/temps/`. Run `strata status --repo DIR` to list saved runs.

If a run stops on a provider, checkpoint, or stage failure, continue its saved workflow with `strata resume RUN_ID --repo DIR`.

## Implement/fix attempts

The default workflow allows three implement/fix attempts per stage. Set `workflow.implement_fix_attempts` in `.strata.toml` to change the limit. Checks can be configured as command arrays with `workflow.checks`; otherwise Strata discovers `test:ci` (or `test`), `lint`, `typecheck`, and `build` scripts from `package.json`.
