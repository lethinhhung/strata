

## 2026-10-06 — Telemetry module separation

Date: 2026-10-06. Decision: Keep telemetry collection, run-state aggregation, and rendering as separate modules; preserve compatibility with existing run records that contain only transition entries. Rationale: Separation of concerns maintains modularity while backward compatibility ensures legacy records remain usable. Affected paths: src/runtime/records.ts, src/runtime/save.ts, src/runtime/loadRun.ts, src/providers.ts, src/providers/parse.ts, src/cli.ts, src/progress.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Span and event-based telemetry model

Date: 2026-10-06. Decision: Represent timed work as spans and retries, fallbacks, failures, and state changes as timestamped events. Group retries under one logical agent task while retaining attempt details; capture provider usage only when metadata is available. Rationale: Clear telemetry model preserves diagnostic detail while enabling meaningful aggregation. Affected paths: src/runtime/records.ts, src/providers.ts, src/providers/parse.ts, src/runtime/executeRun.ts, src/runtime/runStage.ts, src/runtime/runStageGates.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Orchestration preservation

Date: 2026-10-06. Decision: Keep orchestration choices, prompts, retry policy, and agent semantics unchanged. Instrument existing execution paths and expose their observed state without altering decisions. Rationale: Adding observability should not modify core behavior or decision points. Affected paths: src/runtime/executeRun.ts, src/runtime/startRun.ts, src/runtime/resumeRun.ts, src/runtime/runStage.ts, src/runtime/finalValidation.ts, src/runtime/archiveMemory.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Aggregation as shared source

Date: 2026-10-06. Decision: Make aggregation the shared source for stage and run summaries, validation status, outlier highlighting, and JSON output. Report observations without introducing quality scores. Rationale: Single source of truth ensures consistent reporting across all outputs. Affected paths: src/runtime/records.ts, src/runtime/executeRun.ts, src/runtime/aggregate.ts, src/cli.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Non-interactive render modes

Date: 2026-10-06. Decision: Implement non-interactive render modes before the interactive TUI. Select static output automatically when stdout is not a TTY; keep quiet mode free of progress rendering. Rationale: Proper context-aware output prevents progress interference in non-TTY environments. Affected paths: src/cli.ts, src/progress.ts, src/runtime/progress.ts. Run: 20261006T045047Z-070bf3f9.

