# Strata

Strata is a provider-agnostic CLI runtime for implementing features from specifications through hierarchical agent coordination.

The default model split follows this project’s setup: Codex CLI handles strong-model coordination (epic planning, stage coordination, final review, and archival); OpenCode handles repository workers. Configure OpenCode with the NVIDIA model and free API key available to you. Provider credentials stay in OpenCode’s authentication or environment configuration, never in Strata’s config or run records.

## Requirements

- Node.js 20 or newer
- Git
- Codex CLI and OpenCode installed and authenticated
- A clean Git worktree apart from the Strata config and selected epic
- At least one configured test command

## Install

```sh
npm install
npm run build
npm link
strata init
```

Commit the config and epic inputs before starting a run if either is new or changed; Strata requires a clean worktree to attribute implementation diffs safely.

Connect the NVIDIA key in OpenCode by running `opencode`, entering `/connect`, selecting NVIDIA, and pasting the key. Then run `opencode models` and copy an available model ID into `models.worker.model`. Set `models.strong.model` to the Codex model you want. Model values can be overridden for a shell session with `STRATA_STRONG_MODEL` or `STRATA_WORKER_MODEL`. Never put API keys in `.strata.toml`.

Configure checks for the repository where Strata will run. Commands are argument arrays, executed without a shell. The legacy `test_commands` and `quality_checks` arrays remain supported and are treated as required checks. For per-check IDs and explicit handling when a tool is not installed, use `workflow.checks`:

```toml
[workflow]
setup_commands = [["pnpm", "install", "--frozen-lockfile"]]

[[workflow.checks]]
id = "unit-tests"
kind = "test"
command = ["pnpm", "test", "--", "--runInBand"]

[[workflow.checks]]
id = "typecheck"
kind = "quality"
command = ["pnpm", "run", "typecheck"]

[[workflow.checks]]
id = "ios-release-build"
kind = "quality"
command = ["xcodebuild", "-scheme", "Snapnote", "-configuration", "Release", "archive"]
allow_unavailable = true
unavailable_reason = "The iOS release build requires macOS and is covered by the macOS CI job."
```

`setup_commands` run before the Test Agent and configured checks, so agents see dependency/setup failures as evidence and can repair their cause. At least one test check must be required. A check is required by default. `allow_unavailable = true` with a specific reason permits only a missing executable (`ENOENT`); if the command runs and exits nonzero, the check fails and enters the repair loop. The decision and evidence are recorded per check. `max_repairs` bounds repair attempts after the initial gate attempt. Each repair receives the recorded findings; agents can fix the cause, while only Strata applies the configured command gate before checkpointing. Stage commits and the final annotated epic tag are required checkpoints.

Review, Test, and Validate agent pass/fail judgments are required by default. Set `require_agent_gates = false` when a repository wants those judgments recorded as feedback while configured command checks and scope protections remain hard gates.

## Run an epic

```sh
strata run path/to/epic.md
strata status
strata status 20260928T120000Z-a1b2c3d4
strata resume 20260928T120000Z-a1b2c3d4
```

Planning finishes before implementation. Agents and configured checks run in the Git worktree selected by `--repo`; agent edits are checked against their stage scope there. Each stage runs exploration, stage coordination, implementation, independent review, tests, validation, and checkpointing. Gate decisions require executed test and configured quality-check evidence. Stages run in dependency order with stable identities. Successful stage commits include their stage and checkpoint IDs.

Run records are saved after each state change at `docs/temps/<UTC timestamp>-<run id>.md` with structured JSON in a fenced block. They contain the plan, handoffs, phase results, repair attempts, gate evidence, and checkpoints. Resume uses the saved plan and skips completed stages. An interrupted stage without a checkpoint restarts from its saved contract. Failed runs preserve their records. After final integration validation, the Archivist runs once; archival failures are recorded without changing the successful run status.

Memory is advisory, repository-scoped context. Configure its location with `workflow.memory_path` and an optional policy with `workflow.memory_policy`. Workers receive read-only memory context; only the Archivist writes it after successful completion.

## Provider adapters

The TypeScript sources live in `src/` and compile to `dist/`. `npm run build` creates the executable at `dist/src/cli.js`; `npm start` and the linked `strata` command use that build. Run `npm test` to compile the TypeScript tests and execute them with Node’s test runner. `npm run typecheck` checks types without emitting files.

The built-in adapters invoke `codex exec` and `opencode run` as local processes. Codex CLI runs with workspace-write sandboxing and non-interactive approvals; OpenCode runs from the repository and uses its configured provider/model. Add another provider in `src/providers.ts` without changing workflow coordination, state, or gate rules.
