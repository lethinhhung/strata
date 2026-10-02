# Strata Core Specification

This document is the normative source of truth for Strata behavior. Supporting specifications must follow it.

## 1. Purpose and Scope
Strata is a thin TypeScript/Node.js CLI wrapper that coordinates AI agents implementing features in TypeScript/Node.js projects. It loads project instructions, starts the configured coordinator and agents, passes results between them, records resumable workflow state, runs project-defined checks, and commits completed stages.

Strata owns orchestration mechanics and stage gates. Coordinators plan and prepare task handoffs; worker agents implement and assess the work.

## 2. Goals
- Use a Codex run Coordinator and Stage Coordinator with OpenCode worker agents to plan and execute an epic.
- Let projects provide role instructions and provider/model settings while Strata owns the stage sequence and gates.
- Support multiple LLM providers through provider adapters. The current default is Codex for coordinators and OpenCode for agents.
- Decompose work into single-concern logic and UI stages; run a bounded implementation, review, test, and validation pipeline for each.
- Preserve workflow context, decisions, evidence, and resumable state.
- Run project-defined checks, commit each stage with a `stage-N:` subject, and push it to `origin` as a checkpoint.

## 3. Non-Goals
- Replacing the project's build, test, lint, typecheck, or other quality tools.
- Opening a pull request or deploying the result.

## 4. Roles
- **Strata CLI:** Loads configuration, invokes providers, runs configured checks, performs bounded repair cycles, records state, and commits and pushes completed stages.
- **Coordinator:** Run-level planning role. Creates the stage plan. The default provider is Codex. See [Coordinator role](agents/epic-coordinator.md).
- **Stage Coordinator:** Prepares one stage's task handoff and review criteria. The runtime owns the fixed specialist sequence and gate loop. The default provider is Codex. See [Stage Coordinator role](agents/stage-coordinator.md).
- **Agents:** Project-defined roles that perform exploration, implementation, review, testing, validation, or other project-specific work. Their definitions can add, remove, or combine roles to suit the project. The default provider is OpenCode. See [agent role specs](agents/).
- Memory is read as advisory planning context. Successful runs never archive memory inline; after reviewing a successful run, the user may explicitly invoke `strata archive RUN_ID` to ask the Archivist to propose durable updates.

## 5. Project and Role Definitions
- The target repository is authoritative for its conventions, acceptance criteria, available checks, and role customizations.
- A project may provide its own definitions for the Coordinator, Stage Coordinator, and any agents. A project definition overrides Strata's default for that role; Strata defaults fill only roles the project has not defined.
- Role definitions are independent: each states its purpose, provider/model selection, inputs, responsibilities, boundaries, handoff format, and project-specific expectations.
- The pipeline is fixed: implementation → review → test → validation. Project role instructions may specialize the work but cannot skip a pipeline step.
- Project role instructions cannot disable stage checkpoints, bounded repair cycles, configured checks, or push attempts.
- See [project profile and provider resolution](project-profile.md).

## 6. Workflow and Context
- The Coordinator inspects the epic and repository, loads applicable project instructions, and produces a stage plan with objectives, dependencies, completion criteria, checkpoint identities, and `logic` or `ui` kind.
- Every stage runs implementation → review → test → validation. The Stage Coordinator supplies implementation instructions and handoff criteria; it cannot skip a specialist step.
- Strata passes findings, decisions, changed paths, check outcomes, and prior repair attempts between roles. Agents must receive enough context to continue work without repeating failed approaches.
- Review, test, validation, and configured-check failures are sent through bounded repair cycles. Reaching a configured limit records open findings and permits the stage commit; concrete blockers halt the run.
- Work runs in the repository selected by `--repo`, on its current branch or a branch chosen by `--branch`; the default branch is refused. The worktree must be clean apart from Strata config and the epic input.
- Resumption restores the plan, stage state, role handoffs, and prior evidence. Completed stages are not repeated when their recorded commits remain present.

## 7. Checks, Completion, and Checkpointing
- Every stage runs implementation, review, test, and validation in order. UI stages use the screen implementer role; logic stages use the standard implementer role.
- The project's configured automated checks are mechanical requirements. Run every configured test, lint, typecheck, build, or other check that applies to the target project, record the command and result, and return failures to the Stage Coordinator and relevant agents for diagnosis and repair.
- Strata discovers checks from explicit project configuration or project instructions; it must not invent a requirement for a check the project does not use. A check absent from the project is not a failure.
- Review, test, validation, and configured-check findings are routed to an edit-capable agent for bounded repair cycles. If the limit is reached, the stage is committed with unresolved findings recorded. A concrete blocker or commit failure halts the run.
- Repair limits are configured per gate and default to three cycles. A limit does not erase the finding: it is recorded in the stage report and surfaced in the run outcome.
- A stage is complete only after its `stage-N:` commit exists. Push is attempted with retry and rebase; a push failure is recorded but does not prevent later stages. A stage commit failure halts the run.
- Commit only the completed stage's changes, with an identifiable stage/checkpoint message. A commit failure leaves the stage incomplete and resumable.

## 8. Run Completion and Memory
- The run completes after every planned stage has reached its commit checkpoint. No pull request is opened and no memory archive is written as part of the run.
- `strata archive RUN_ID` is a separate, explicit post-review action. It accepts only a completed run, invokes the Archivist with the worker provider, and writes only validated decision, note, and progress entries under the configured memory directory. Archival does not change run status or gate results.

## 9. Providers and Runtime
- Provider integrations are adapters. Role definitions select a provider and model independently, allowing different providers for coordinators and agents and future provider additions without changing orchestration policy.
- Current defaults: Codex invokes the run Coordinator and Stage Coordinators; OpenCode invokes agents. OpenCode uses its configured model/provider (currently NVIDIA in this setup). Provider credentials remain in provider-owned authentication or environment settings, not Strata project config or run records.
- Strata is implemented in TypeScript on Node.js and targets TypeScript/Node.js repositories. Provider-specific command construction, output parsing, and authentication remain outside the workflow contract.

## 10. Success Criteria
Strata reliably coordinates the project-defined roles, carries useful context through diagnosis and repair, executes the target project's configured checks, commits and pushes each completed stage on the selected branch, records gate caveats, and preserves enough state to resume after a halt. The agents and coordinators—not universal CLI gate policy—determine what work is needed to satisfy the project's requirements.
