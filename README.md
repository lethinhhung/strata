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
npm link
strata init
```

Commit the config and epic inputs before starting a run if either is new or changed; Strata requires a clean worktree to attribute implementation diffs safely.

Connect the NVIDIA key in OpenCode by running `opencode`, entering `/connect`, selecting NVIDIA, and pasting the key. Then run `opencode models` and copy an available model ID into `models.worker.model`. Set `models.strong.model` to the Codex model you want. Model values can be overridden for a shell session with `STRATA_STRONG_MODEL` or `STRATA_WORKER_MODEL`. Never put API keys in `.strata.toml`.

Configure checks for the repository where Strata will run. Commands are argument arrays, executed without a shell. For example:

```toml
[workflow]
test_commands = [["npm", "test", "--", "--runInBand"]]
quality_checks = [["npm", "run", "lint"], ["npm", "run", "typecheck"]]
```

The test command is required for a stage to pass. Configure only checks that exist in the target repository. `max_repairs` bounds repair attempts after the initial gate attempt. Stage commits and the final annotated epic tag are required checkpoints.

## Run an epic

```sh
strata run path/to/epic.md
strata status
strata status 20260928T120000Z-a1b2c3d4
strata resume 20260928T120000Z-a1b2c3d4
```

Planning finishes before implementation. Each stage runs exploration, stage coordination, implementation, independent review, tests, validation, and checkpointing. Gate decisions require executed test and configured quality-check evidence. Stages run in dependency order with stable identities. Successful stage commits include their stage and checkpoint IDs.

Run records are saved after each state change at `docs/temps/<UTC timestamp>-<run id>.md` with structured JSON in a fenced block. They contain the plan, handoffs, phase results, repair attempts, gate evidence, and checkpoints. Resume uses the saved plan and skips completed stages. An interrupted stage without a checkpoint restarts from its saved contract. Failed runs preserve their records. After final integration validation, the Archivist runs once; archival failures are recorded without changing the successful run status.

Memory is advisory, repository-scoped context. Configure its location with `workflow.memory_path` and an optional policy with `workflow.memory_policy`. Workers receive read-only memory context; only the Archivist writes it after successful completion.

## Provider adapters

The built-in adapters invoke `codex exec` and `opencode run` as local processes. Codex CLI runs with workspace-write sandboxing and non-interactive approvals; OpenCode runs from the repository and uses its configured provider/model. Add another provider in `src/providers.js` without changing workflow coordination, state, or gate rules.
