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

Provider progress and the time since the last output appear while agents run. OpenCode defaults to a 360-second inactivity limit, alongside its 1800-second overall deadline. Set `idle_timeout_seconds` under `[models.worker]` or `[models.strong]` in `.strata.toml` to tune this limit; `0` disables it. Codex has no inactivity limit by default. Only stdout activity resets the inactivity timer, so diagnostic retries on stderr cannot extend it. A failed exploration is retried once with the configured strong agent, in read-only mode, before the run stops. Completed stages are preserved on resume.

OpenCode workers also stop after three distinct unavailable-tool calls in one invocation, allowing the workflow's recovery to take over. Provider errors are summarized without dumping tool transcripts. Verify timeout and recovery behavior with `npm run build && node --test tests/provider-recovery.test.mjs`.

To run a particular checkout without relying on the globally linked `strata` command, build it and use `node /path/to/checkout/dist/src/cli.js resume RUN_ID --repo DIR`.

## Implement/fix attempts

The default workflow allows three implement/fix attempts per stage. Set `workflow.implement_fix_attempts` in `.strata.toml` to change the limit. Checks can be configured as command arrays with `workflow.checks`; otherwise Strata discovers `test:ci` (or `test`), `lint`, `typecheck`, and `build` scripts from `package.json`.
