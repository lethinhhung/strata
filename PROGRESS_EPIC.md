# CLI progress

Add readable live progress to `strata run` and `strata resume`. Persist structured run, stage, agent, and gate transitions in `RunRecord`; render transitions and the final outcome in the CLI. Preserve failure diagnostics across resume.

Acceptance: deterministic tests cover rendered transitions and persisted failure state. Stage 1 must scope `src/runtime/types.ts`, `src/runtime/**`, and `src/runtime.test.ts`; include each stage's related tests and production files. Do not create test-only stages.
