# Strata Core Specification

## Purpose

Strata is a thin TypeScript CLI wrapper around an agent workflow. It coordinates sessions, passes context and task contracts, and checkpoints completed stages. The workflow, role definitions, and target repository determine the work; Strata supplies the orchestration mechanism.

## Inputs

- **Workflow:** Strata's workflow definition, which describes orchestration behavior and mechanism.
- **Agent definitions:** Role instructions and handoff contracts for coordinators, explorers, implementers, testers, validators, and the archivist.
- **Runtime target:** TypeScript on Node.js.
- **Epic:** The user's requested behavior, written to `prompt/epic.md`.
- **Target repository:** The repository selected for the work, including its `specs/` and applicable project rules.

The user switches to the target repository's intended branch before running Strata. The run works in that current branch and does not choose a different branch implicitly.

## Workflow

1. The first Codex session acts as the **Epic Coordinator**. It reads the epic, Strata workflow and agent definitions, and the target repository's specifications and rules. It divides the epic into focused exploration tasks.
2. Strata starts multiple **Explore Agent** sessions to investigate those tasks. Explorers return findings and relevant repository context; they do not implement the epic.
3. The Epic Coordinator reviews the exploration results and divides the epic into ordered stages, with objectives, dependencies, and completion criteria.
4. Every stage has its own exploration step. The Stage Coordinator uses the stage context to define focused investigation questions. Explore Agent sessions investigate the stage in the target repository and return findings.
5. The Stage Coordinator combines the Epic Coordinator's stage context, stage exploration findings, memory, and repository specifications and rules. It turns the stage into ordered implementation tasks, each with context, content, scope, and acceptance criteria.
6. Strata runs the stage loop: implement the tasks, run applicable tests, lint, and type checks, then validate the implementation against the specifications and stage criteria. The Tester fixes test or quality-check failures. The Validator sends specification mismatches to the Stage Coordinator, who may clarify task context or return work to an Implementer. Re-run affected checks and validation after fixes. Each implement/fix cycle has a default limit of three attempts, configurable by the project. Repeat until the stage passes or a concrete blocker is recorded; when the limit is reached, preserve findings and resumable workflow state instead of silently treating the stage as passed.
7. After a stage passes, the **Archivist** writes durable notes, decisions, and progress to `memory/` so later stages can use the accumulated context.
8. Strata commits and pushes each completed stage to the current branch before proceeding to the next stage.

## Responsibilities

- Strata owns session orchestration, context handoffs, stage sequencing, workflow state, and per-stage commit and push checkpoints.
- Coordinators plan and delegate; agents perform the work described by their definitions. Role definitions may tailor how work is done without changing the epic or target repository requirements.
- Explore Agents investigate the epic or stage and report evidence and relevant context without implementing changes.
- Implementers change the target repository according to their task context and content.
- Testers run the checks the target repository needs, verify regression behavior, and fix failures within the assigned scope.
- Validators assess completed implementation against the applicable specifications and stage criteria, and route mismatches back through the Stage Coordinator.
- Only the Epic Coordinator may edit files under `specs/`, and only when the epic explicitly requires a specification change. Other agents treat specifications as read-only.
- Coordinators may write necessary Strata run files or pass context through workflow handoffs; this does not grant permission to edit implementation code.
- Explore Agents and Validators are read-only: they may inspect code and report findings, but cannot edit code or specifications.
- The target repository remains authoritative for product behavior, conventions, and applicable checks. Strata must not invent requirements when these sources are silent; unresolved material questions are recorded as blockers for the user.
- The archivist records useful, durable knowledge under `memory/`; memory supports later work and does not override the epic or repository specifications.

## Runtime and completion

Strata is implemented in TypeScript and runs on Node.js. It targets TypeScript/Node.js repositories. Provider-specific session startup and response handling are implementation details behind the workflow interface.

The current provider assignment uses Codex sessions for the Epic Coordinator and Stage Coordinator. Explore Agents, Implementers, Testers, Validators, and the Archivist are weak agents that run through the OpenCode provider. Agent role files define responsibilities; provider adapters control session startup and response handling.

A stage is complete when its implementation, tests, and validation meet the stage criteria and its commit has been pushed to the current branch. The run is complete when all stages are checkpointed and their memory updates are written. A blocker or failed checkpoint must leave enough workflow state and context to resume the run.
