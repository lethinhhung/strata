# Strata Core Specification

## 1. Overview
Strata is a CLI-based hierarchical agent orchestration system for implementing large software features from specifications.
Core principle: Strong models make decisions. Cheap models perform bounded work.

## 2. Goals
- Implement large features from structured specs.
- Preserve strong-model reasoning for planning/coordination.
- Delegate repo-heavy work to cheaper/free models.
- Keep contexts small, fresh, task-specific.
- Make execution resumable/observable.
- Prevent uncontrolled loops.
- Remain provider/agent agnostic.

## 3. Non-Goals
- General-purpose autonomous coding agent.
- Replace Codex/Claude/OpenCode.
- Let workers control workflow.
- Maintain giant epic context.
- Auto-merge unvalidated output.

## 4. Hierarchical Model
**Level 1: Epic Coordinator** – strong model owns epic: reads spec, decomposes into stages, provides context, tracks progress, validates final.

**Level 2: Stage Coordinator** – fresh strong model per stage: receives stage package, decides worker tasks, constructs minimal context, validates stage, produces compressed report.

**Level 3: Workers** – cheap/free/local models (Explore, Implement, Test, Review, Debug). Bounded tasks, no workflow control.

## 5. Context Flow
Epic Coordinator → Stage Package → Stage Coordinator → Worker Task → Worker Evidence → Stage Coordinator → Stage Report → Epic Coordinator.
Each boundary compresses context to essentials.

## 6. Stage Package
Contains: objective, acceptance criteria, architectural decisions, dependencies, constraints, relevant files, validation.
Excludes unrelated epic history.

## 7. Worker Task
Contains: single objective, relevant context, questions/expected output, allowed scope, constraints, validation commands.
Workers return structured evidence, not uncontrolled history.

## 8. Worker Evidence
May include: summary, findings, changed files, git diff, test results, errors, risks, uncertainties, suggested follow-up.

## 9. Stage Report
After validation: stage status, acceptance criteria results, implemented behavior, important changed files, test results, architectural decisions, limitations, future context, git checkpoint.
Becomes Epic Coordinator's persistent state.

## 10. Execution Principles
- Coordinators own decisions; workers execute bounded tasks.
- Every stage/worker starts fresh context.
- Expensive models avoid repo-wide token-heavy work; cheap models avoid high-level decisions.
- Retries need new evidence/corrected instructions, bounded.
- Stage failure stops dependents; success creates checkpoint.
- Resume from last valid checkpoint.

## 11. Isolation
Parallel/experimental tasks use isolated Git worktrees.
Workers must not silently interfere.
Changes enter main state only after coordinator validation.

## 12. Provider Model
Not tied to one AI provider.
Example: Epic/Stage Coordinators → Codex/Claude/strong model; Workers → NVIDIA NIM/local/OpenCode/cheap APIs.
Provider selection via config, not workflow logic.

## 13. CLI Responsibility
Strata CLI is runtime, not intelligence.
Provides: creating/resuming runs, spawning coordinators/workers, passing bounded context, tracking state, managing isolation, collecting results, enforcing retry limits, persisting checkpoints/reports.
Reasoning stays in configured coordinators.

## 14. Success Criteria
Strata succeeds when large feature flows: spec → plan → staged execution → worker delegation → validation → checkpoint → final validation,
keeping strong models on reasoning and cheap models on most token-heavy execution.