# Strata Core Specification

This document is the normative source of truth for Strata behavior. Supporting specifications must follow it.

## 1. Purpose and Scope
Strata is a thin TypeScript/Node.js CLI wrapper that coordinates AI agents implementing features in TypeScript/Node.js projects. It loads project instructions, starts the configured coordinator and agents, passes results between them, records resumable workflow state, runs project-defined checks, and commits completed stages.

Strata owns orchestration mechanics. The coordinators and agents own the problem-solving workflow and quality decisions.

## 2. Goals
- Coordinate a hierarchy of one run-level Coordinator, one Stage Coordinator per stage, and project-defined agents.
- Let each project define or override coordinator and agent responsibilities, instructions, and routing.
- Support multiple LLM providers through provider adapters. The current default is Codex for coordinators and OpenCode for agents.
- Help agents investigate failures, implement fixes, run relevant checks, and continue until the project-defined completion criteria are met or the coordinator identifies a concrete blocker.
- Preserve workflow context, decisions, evidence, and resumable state.
- Run project-defined automated checks that exist in the target repository and commit each completed stage.

## 3. Non-Goals
- Imposing a universal review rubric, test policy, repair count, or definition of completion on every project.
- Replacing the project's build, test, lint, typecheck, or other quality tools.
- Making the CLI decide whether an agent's implementation is good enough.

## 4. Roles
- **Strata CLI:** Thin orchestration wrapper. Loads Strata and project configuration, resolves role definitions, invokes providers, routes structured context and results, records state, runs configured project checks, and commits completed stages. It does not make implementation or quality decisions.
- **Coordinator:** Run-level planning and coordination role. Creates the stage plan, delegates each stage to a Stage Coordinator, routes run-level questions, and integrates completed work. The default provider is Codex. See [Coordinator role](agents/epic-coordinator.md).
- **Stage Coordinator:** Owns one stage. It delegates bounded work to project-defined agents, passes findings and repair history between them, evaluates their reports and project checks, and decides when the stage is ready to commit or is blocked. The default provider is Codex. See [Stage Coordinator role](agents/stage-coordinator.md).
- **Agents:** Project-defined roles that perform exploration, implementation, review, testing, validation, or other project-specific work. Their definitions can add, remove, or combine roles to suit the project. The default provider is OpenCode. See [agent role specs](agents/).
- **Archivist:** Optional post-run role for reusable memory. It runs only when enabled by the project's workflow definition.

## 5. Project and Role Definitions
- The target repository is authoritative for its conventions, acceptance criteria, available checks, and role customizations.
- A project may provide its own definitions for the Coordinator, Stage Coordinator, and any agents. A project definition overrides Strata's default for that role; Strata defaults fill only roles the project has not defined.
- Role definitions are independent: each states its purpose, provider/model selection, inputs, responsibilities, boundaries, handoff format, and project-specific expectations.
- The Coordinator and Stage Coordinator may adapt the sequence and selection of agents to the project and stage. Strata must not require one universal set of worker roles or a fixed review/test/validation sequence.
- Project role instructions cannot disable the two Strata mechanics: completed stages are committed, and checks configured by the target project's Strata profile are executed and their results recorded.
- See [project profile and provider resolution](project-profile.md).

## 6. Workflow and Context
- The Coordinator inspects the epic and repository, loads applicable project instructions, and produces a stage plan with objectives, dependencies, completion criteria, and checkpoint identities.
- Strata starts a Stage Coordinator with the stage contract and relevant repository context. The Stage Coordinator directs agents and owns the stage loop.
- Strata passes findings, decisions, changed paths, check outcomes, and prior repair attempts between roles. Agents must receive enough context to continue work without repeating failed approaches.
- Agents investigate reported failures, make the appropriate changes, run relevant checks, and report exact outcomes. The Stage Coordinator decides follow-up tasks and whether completion criteria are met.
- Work runs in the repository selected by `--repo`, using the user's current branch and workspace unless project configuration explicitly selects an isolated workspace.
- Resumption restores the plan, stage state, role handoffs, and prior evidence. Completed stages are not repeated when their recorded commits remain present.

## 7. Checks, Completion, and Checkpointing
- Strata has no universal hard gate for agent opinions, review severity labels, test-agent status, validation status, repair counts, or worker sequence. These decisions belong to the Coordinator and Stage Coordinator under the target project's role definitions and acceptance criteria.
- The project's configured automated checks are mechanical requirements. Run every configured test, lint, typecheck, build, or other check that applies to the target project, record the command and result, and return failures to the Stage Coordinator and relevant agents for diagnosis and repair.
- Strata discovers checks from explicit project configuration or project instructions; it must not invent a requirement for a check the project does not use. A check absent from the project is not a failure.
- A failing check is evidence for the agent workflow, not an instruction to terminate immediately. The Stage Coordinator assigns the failure to an agent, provides the output and previous repair history, and continues the diagnose/fix/rerun loop until checks pass or the Coordinator reports a concrete blocker or asks the user for a decision.
- Strata does not impose a fixed repair-attempt limit. It preserves state and exposes interruption/resume controls; it does not silently declare a stage complete while a configured check is failing.
- The only Strata-enforced stage hard gates are: (1) create a Git commit for each completed stage, and (2) run and pass each applicable automated check configured by the target project. Agent judgments inform the Coordinator's stage completion decision but are not independently hard-gated by Strata.
- Commit only the completed stage's changes, with an identifiable stage/checkpoint message. A commit failure leaves the stage incomplete and resumable.

## 8. Run Completion and Memory
- After all stages are complete, the Coordinator performs project-defined integration and acceptance work and delegates fixes when needed.
- The run completes when the Coordinator reports the epic's project-defined completion criteria satisfied, all configured applicable checks pass, and all stages have commits.
- Memory is advisory. An optional Archivist may record observed, reusable knowledge after success; archival does not affect completion.

## 9. Providers and Runtime
- Provider integrations are adapters. Role definitions select a provider and model independently, allowing different providers for coordinators and agents and future provider additions without changing orchestration policy.
- Current defaults: Codex invokes the run Coordinator and Stage Coordinators; OpenCode invokes agents. OpenCode uses its configured model/provider (currently NVIDIA in this setup). Provider credentials remain in provider-owned authentication or environment settings, not Strata project config or run records.
- Strata is implemented in TypeScript on Node.js and targets TypeScript/Node.js repositories. Provider-specific command construction, output parsing, and authentication remain outside the workflow contract.

## 10. Success Criteria
Strata reliably coordinates the project-defined roles, carries useful context through diagnosis and repair, executes the target project's configured checks, commits each completed stage on the selected repository branch, and records enough state to inspect or resume the workflow. The agents and coordinators—not universal CLI gate policy—determine what work is needed to satisfy the project's requirements.
