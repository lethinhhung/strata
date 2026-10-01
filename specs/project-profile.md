# Project Profile and Provider Resolution

This specification defines how Strata adapts its default workflow to a target TypeScript/Node.js repository.

## Project-owned workflow
- The target repository may define workflow instructions and independent role definitions for the Coordinator, Stage Coordinator, and each agent.
- Project definitions are loaded from the target repository selected by `--repo`, not from Strata's installation directory or the caller's current directory.
- Each role definition may select its own provider and model and define its purpose, responsibilities, boundaries, input needs, output format, and project-specific completion expectations.
- Project role definitions take precedence over Strata defaults for the matching role. Project configuration may define additional roles and tell the coordinators when to use them.
- When a role has no project definition, Strata uses its default role spec. A project may adapt the workflow order and combine or omit default worker roles.
- Role definitions are discovered from `.strata/roles/<role_slug>.md`, where role names use lowercase words separated by underscores (for example, `stage_coordinator.md`). A matching `[roles.<role_slug>]` table in `.strata.toml` may select `provider`, `model`, `command`, `timeout_seconds`, `extra_args`, and `instructions_path`; absent an explicit path, Strata reads the matching role file. Instructions override Strata defaults for that role.
- `strata run --prompt "..."` accepts an epic prompt directly on the command line. The existing `strata run EPIC_FILE` form remains available. A run record stores the prompt so it can be resumed without the original file.

## Providers
- Provider and model are selected per role, not globally. Coordinators and agents may use different providers.
- The current default mapping is Codex for the run Coordinator and Stage Coordinators, and OpenCode for worker agents. The current OpenCode setup uses the project's configured NVIDIA model.
- Provider adapters own invocation, output parsing, retryable transport errors, and provider-specific options. Coordinators and agents receive the same role contract regardless of provider.
- Strata configuration stores provider/model identifiers and non-secret invocation options only. Credentials are handled by the provider's own authentication or environment configuration.
- Adding a provider must not require changing project role instructions or workflow semantics.

## Target project checks
- Check commands come from the target project's explicit Strata configuration or project instructions, and are evaluated relative to the target repository. For Node.js repositories, Strata also discovers standard scripts in the target `package.json` (`test:ci` or `test`, plus `lint`, `typecheck`, and `build`) when no explicit check list replaces discovery. The package manager is selected from the repository lockfile.
- Run applicable checks the project defines or exposes as standard scripts. Do not invent missing scripts or impose checks absent from the project.
- Return check command, exit status, and relevant output to the Stage Coordinator and the assigned agent. A failed check enters the project's agent-directed repair loop.
- Record which checks were configured, which ran, and why any configured check did not run. Never report a skipped configured check as passed.

## Stage commits and workspace
- Run against the repository and branch selected by the user. Preserve pre-existing unrelated workspace changes.
- Treat coordinator-planned stage paths as the primary focus, not a hard allowlist. Agents may modify directly related source, tests, project configuration, manifests, lockfiles, and integration files needed for the stage. Record their changed paths, let the Stage Coordinator assess relevance, and include accepted stage changes in the stage checkpoint. Keep Strata metadata, run records, specifications, memory, and unrelated user changes protected.
- After the Stage Coordinator determines a stage is complete and its configured checks pass, commit that stage's changes in the target repository.
- If checks or commit fail, retain the run as incomplete and resumable, with the failure evidence and current stage context.
