# Strata

Strata is a TypeScript/Node.js CLI that coordinates a run-level Coordinator, a Stage Coordinator for each stage, and project-defined agents. Coordinators use Codex by default; workers use OpenCode by default. Projects can override role instructions and provider/model settings in `.strata/roles/` and `.strata.toml`.

## Requirements

- Node.js 20 or newer
- Git
- Codex CLI and OpenCode installed and authenticated

## Install

```sh
npm install
npm run build
npm link
strata init
```

Strata runs in the repository selected by `--repo`, on the current branch or a branch selected with `--branch`. It refuses the default branch and requires a clean worktree apart from Strata config and the selected epic input. Each completed stage is committed as `stage-N: ...` and pushed to `origin`; push failures are recorded while later stages continue. Once all stages finish, Strata commits remaining changes, pushes the complete branch, verifies the worktree is clean, and opens or reuses a GitHub pull request with `gh`. It then records the pull-request URL and completed status, commits and pushes that update, and confirms the worktree is clean before returning success.

## Configure

Provider credentials stay in provider-owned authentication or environment configuration. The default `.strata.toml` uses Codex for coordinators and OpenCode for agents. To customize a role, add `.strata/roles/stage_coordinator.md` and optionally a `[roles.stage_coordinator]` table:

```toml
[roles.stage_coordinator]
provider = "codex"
model = ""
command = "codex"
timeout_seconds = 3600
```

Role tables also support `extra_args` and `instructions_path`. Role names use lowercase words separated by underscores. A matching markdown file is loaded automatically.

Configure project checks with `workflow.checks` when needed. Otherwise, Strata discovers `test:ci` (or `test`), `lint`, `typecheck`, and `build` scripts in the target `package.json`; the package manager comes from the lockfile. Missing scripts are not invented. Commands run from the target repository and their output is included in the agent handoff.

Checks run sequentially by default, preserving command order. Set `workflow.check_concurrency` to an integer from 2 to 8 to run independent checks concurrently; only do this when the configured commands do not depend on one another or compete over generated files. Each check records its duration in run evidence.

Each stage follows implementation → review → test → validation. The Stage Coordinator may split implementation into ordered tasks, such as backend work followed by dependent UI work; Strata invokes each assigned specialist sequentially before the stage gates. A bounded repair loop routes findings back to an agent; if the configured repair limit is reached, Strata commits the stage with unresolved findings recorded. A concrete blocker or commit failure halts the run and leaves its record resumable. UI tasks use the `Screen Implementer` role; logic tasks use `Implement Agent`.

## Run an epic

Use a prompt file:

```sh
strata run path/to/epic.md --repo .
strata run path/to/epic.md --repo . --branch feature/epic
strata run path/to/epic.md --repo . --review-plan
```

Or pass the prompt directly:

```sh
strata run --prompt "Add a settings screen with persistent theme selection." --repo .
```

Inspect or resume a run:

```sh
strata status
strata status RUN_ID
strata resume RUN_ID --repo .
```

After reviewing a successful run, archive durable engineering memory separately:

```sh
strata archive RUN_ID --repo .
```

Run and resume never write memory automatically. The Archivist writes concise entries to `decisions.md`, `notes.md`, and `progress.md` under `workflow.memory_path`, following the repository's memory README when present.

`--review-plan` saves the decomposed plan in the run record and stops before implementation. Inspect or edit that record with `strata status RUN_ID`, then continue with `strata resume RUN_ID --repo .`.

Run records are saved under `docs/temps/` with the stage plan, role handoffs, check evidence, repair history, push results, unresolved findings, and checkpoints. Completed stages are skipped on resume when their checkpoint commits remain available.

## Development

The TypeScript sources live in `src/` and compile to `dist/`. `npm run build` creates the executable at `dist/src/cli.js`; `npm start` and the linked `strata` command use that build. `npm test` runs the Node test suite, and `npm run typecheck` checks types without emitting files.

Provider adapters invoke `codex exec` and `opencode run` as local processes. Add another provider in `src/providers.ts` without changing workflow coordination or state.
