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
4. For each stage, a **Stage Coordinator** session turns the stage into ordered implementation tasks with clear scopes and acceptance criteria.
5. Strata runs the stage loop: explore any task-specific unknowns, implement the tasks, test the changes, and validate them against the stage criteria and target repository rules. Findings that need changes return to implementation, and the test and validation loop repeats until the stage is ready or a concrete blocker is recorded.
6. After a stage is ready, the **Archivist** writes durable notes, decisions, and progress to `memory/` so later stages can use the accumulated context.
7. Strata commits and pushes each completed stage to the current branch before proceeding to the next stage.

## Responsibilities

- Strata owns session orchestration, context handoffs, stage sequencing, workflow state, and per-stage commit and push checkpoints.
- Coordinators plan and delegate; agents perform the work described by their definitions. Role definitions may tailor how work is done without changing the epic or target repository requirements.
- The target repository remains authoritative for product behavior, conventions, and applicable checks. Strata must not invent requirements when these sources are silent; unresolved material questions are recorded as blockers for the user.
- The archivist records useful, durable knowledge under `memory/`; memory supports later work and does not override the epic or repository specifications.

## Runtime and completion

Strata is implemented in TypeScript and runs on Node.js. It targets TypeScript/Node.js repositories. Provider-specific session startup and response handling are implementation details behind the workflow interface.

A stage is complete when its implementation, tests, and validation meet the stage criteria and its commit has been pushed to the current branch. The run is complete when all stages are checkpointed and their memory updates are written. A blocker or failed checkpoint must leave enough workflow state and context to resume the run.
