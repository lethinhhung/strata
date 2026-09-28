# Strata Core Specification

This document is the normative source of truth for Strata behavior. Supporting specs and diagrams must follow it; they may clarify or present it, but cannot override it.

## 1. Purpose
Strata is a provider-agnostic CLI runtime for implementing large software features from specifications through hierarchical agent coordination.

**Principle:** Strong models plan and coordinate; cheaper models perform bounded repository work.

## 2. Goals
- Turn an epic into dependency-ordered stages with explicit completion criteria.
- Keep coordinator and worker context small, relevant, and resumable.
- Delegate repository exploration and stage work to configured agents.
- Require engine-derived quality gates, bounded repair, and checkpoints.
- Preserve run state and evidence for inspection and resumption.

## 3. Non-Goals
- General-purpose autonomous coding or replacing coding agents.
- Giving workers control of plans, gates, or workflow.
- Automatically accepting unvalidated work.

## 4. Roles
- **CLI:** Loads config and the epic, detects repository state, initializes persistent run state, invokes agents, and records results.
- **Epic Coordinator (Level 1):** A strong model that loads relevant memory, makes architectural decisions, creates the stable stage plan, and performs final integration review. See [role spec](agents/epic-coordinator.md).
- **Stage Coordinator (Level 2):** A fresh strong-model context for a stage. It directs stage work, enforces gates and repair limits, checkpoints completed stages, and reports outcomes. See [role spec](agents/stage-coordinator.md).
- **Workers (Level 3):** Configured agents for exploration, implementation, review, testing, and validation. Each receives a bounded role and returns structured results; workers do not control workflow. See [worker role specs](agents/).
- **Archivist:** Captures reusable memory after a successful run; it is not part of a stage loop. See [role spec](agents/archivist.md).

## 5. Planning and Context
- Finish planning before implementation. Each stage has a stable identity, title, single concern, scope, dependencies, completion criteria, and checkpoint identity.
- Execute stages in dependency order. A dependent stage cannot start before its dependencies pass.
- Load relevant active memory before planning and delegation. Give each agent only the memory and repository context relevant to its role and stage.
- Memory is advisory and never replaces specifications, requirements, or gate evidence. Missing memory does not block a run; see [memory policy](memory.md).
- Put temporary investigation or run documents in `docs/temps/` as `docs/temps/<UTC timestamp>-<run-id>.md`.
- Stage context includes its contract, applicable specifications, relevant epic decisions, prior phase results, constraints, and allowed scope. Do not pass the entire run history by default.

## 6. Stage Lifecycle
Each stage follows this ordered lifecycle:

1. **Implement:** An implementer changes source within the stage scope and reports changed paths and checks. It does not write tests, alter specifications, reorder stages, or checkpoint.
2. **Review:** An independent, read-only reviewer checks the diff against the stage contract, specifications, and repository rules. A pass requires no critical or major issue.
3. **Test:** A tester creates or runs tests for required behavior, modifying test files only, and reports commands, outcomes, and coverage.
4. **Validate:** A read-only validator checks specification coverage, review findings, test evidence, configured quality checks, repository rules, and contract integrity.
5. **Checkpoint:** Only after implementation, review, test, and validation pass, save a stage-identifying Git checkpoint and structured stage result.

Each phase returns a structured result. Gate outcomes come from executed engine evidence, not agent claims. A skipped or unavailable required check does not pass. A failed review, test, or validation may trigger a bounded, scoped repair followed by the required checks again. The Stage Coordinator assigns repair to the role allowed to change the affected files: implementers repair source; testers repair tests. Record every attempt and outcome. If repair is exhausted, a required gate cannot pass, or checkpointing fails, halt the run and preserve failure details and resumable state. Do not attempt later stages after an unrecoverable halt.

## 7. Run Completion and Memory
- Resume from the original plan and checkpoint identities. Skip a completed stage only when its checkpoint exists; do not silently reorder or renumber stages.
- After all stages complete, the Epic Coordinator checks epic criteria, cross-stage consistency, regression evidence, and architecture, then runs final validation. A failure requires targeted stage repair and revalidation.
- Archive memory once after a successful run, not within each stage. The Archivist follows [memory policy](memory.md) and records only observed, reusable knowledge in configured memory locations.
- Archival is not a quality gate. Record archival failure without changing completed stage or run status. Failed runs retain reports and resumable state but do not archive memory.

## 8. Isolation and Providers
- Serialize shared mutations. Parallelize planning or read-only checks when safe; isolate parallel mutating work in Git worktrees.
- Keep the workflow provider- and agent-agnostic. Select providers through configuration; provider-specific behavior stays in adapters.
- The CLI manages invocation, bounded context, state, isolation, structured results, retry limits, gates, and checkpoints. Workflow decisions remain with coordinators.

## 9. Success Criteria
A successful run plans and executes all dependency-ordered stages through implementation, review, testing, validation, and checkpointing; passes final integration validation; and records its run result and archival outcome. Strong models focus on reasoning and coordination while cheaper models handle most repository-heavy work.
