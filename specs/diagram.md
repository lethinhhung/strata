# Strata Run Flow

This diagram summarizes the workflow in [core.md](core.md). Coordinators and agent instructions are resolved from the target repository as described in [project-profile.md](project-profile.md).

```mermaid
flowchart TD
    U[User starts Strata with epic and target repo] --> CLI[Thin CLI loads project role definitions, provider mapping, checks, and run state]
    CLI --> COORD[Coordinator<br/>Default provider: Codex]
    COORD --> PLAN[Inspect project and epic<br/>Plan stages and acceptance criteria]
    PLAN --> STAGE[Stage Coordinator<br/>Default provider: Codex]
    STAGE --> DELEGATE[Choose project-defined roles and sequence]
    DELEGATE --> AGENTS[Agents<br/>Default provider: OpenCode]
    AGENTS --> REPORT[Pass findings, changes, check results,<br/>and prior repairs back to Stage Coordinator]
    REPORT --> DECIDE{Stage Coordinator decides next action}
    DECIDE -->|Needs work| DELEGATE
    DECIDE -->|Ready for project checks| CHECKS[Run target project's configured<br/>tests, lint, typecheck, build, etc.]
    CHECKS --> PASS{Configured checks pass?}
    PASS -->|No| REPAIR[Route failure evidence and repair history<br/>to the relevant project agent]
    REPAIR --> AGENTS
    PASS -->|Yes| COMPLETE{Stage Coordinator marks stage complete?}
    COMPLETE -->|No; more work| DELEGATE
    COMPLETE -->|Yes| COMMIT[Commit completed stage in target repo]
    COMMIT --> COMMITOK{Commit succeeds?}
    COMMITOK -->|No| RESUME[Keep stage incomplete and resumable]
    COMMITOK -->|Yes| NEXT{Stages remain?}
    NEXT -->|Yes| STAGE
    NEXT -->|No| FINAL[Coordinator integrates stages and checks epic criteria]
    FINAL -->|Needs fixes| STAGE
    FINAL -->|Complete| DONE[Record successful run]
```

## Workflow invariants
- Strata coordinates providers, context, state, configured project checks, and stage commits. It does not impose universal agent-quality gates or worker ordering.
- The Coordinator plans and integrates; a Stage Coordinator owns each stage; agents perform project-defined tasks.
- Project-defined role instructions and applicable automated checks are loaded from the target repository.
- Failed checks return to the Stage Coordinator with their output and prior repair history; the workflow continues through agent-directed repair until resolved or a concrete blocker is reported.
- Each completed stage is committed in the selected target repository. Failed checks or commits keep the stage incomplete and resumable.
- Provider choice is per role. Current defaults are Codex for coordinators and OpenCode for agents.
