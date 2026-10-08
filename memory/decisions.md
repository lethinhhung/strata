

## 2026-10-08 — Telemetry collection and rendering separation

Date: 2026-10-07. Decision: Keep telemetry collection in runtime/provider data paths and terminal rendering in the CLI presentation layer; persisted telemetry should remain usable by JSON status output and future consumers. Rationale: To maintain separation of concerns and allow telemetry to be used by multiple consumers. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Additive backward-compatible telemetry fields

Date: 2026-10-07. Decision: Use additive, backward-compatible telemetry fields and tolerate records without them. Capture model identity, token usage where provider output supplies it, agent status and duration, and retry/attempt relationships without changing orchestration, retry policy, or stage gates. Rationale: To ensure compatibility with existing records and allow gradual adoption of telemetry. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Render retries grouped and derive summary from recorded data

Date: 2026-10-07. Decision: Render retries grouped beneath their agent/stage identity, and derive overall elapsed time, totals, validation results, and final summary from recorded run data rather than adding orchestration behavior. Rationale: To avoid complicating the orchestration logic and keep the runtime focused on execution. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Edit permission for implementation stages

Date: 2026-10-07. Decision: Edit permission is appropriate for both planned implementation stages: the first changes runtime/provider telemetry and its related tests; the second changes terminal presentation and its related tests. Review and validation remain read-only. Rationale: To allow necessary changes while keeping validation and review independent. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435



## 2026-10-08 — Telemetry collection and presentation separation

Keep telemetry collection in runtime/provider data paths and terminal rendering in the CLI presentation layer; persisted telemetry should remain usable by JSON status output and future consumers.

Affected paths:
- src/progress.ts
- src/cli.ts
- src/cli.test.ts

Originating run: 20261007T130703Z-33690435


## 2026-10-08 — Additive telemetry fields with backward compatibility

Use additive, backward-compatible telemetry fields and tolerate records without them. Capture model identity, token usage where provider output supplies it, agent status and duration, and retry/attempt relationships without changing orchestration, retry policy, or stage gates.

Affected paths:
- src/progress.ts

Originating run: 20261007T130703Z-33690435


## 2026-10-08 — Grouped retries and derived summary rendering

Render retries grouped beneath their agent/stage identity, and derive overall elapsed time, totals, validation results, and final summary from recorded run data rather than adding orchestration behavior.

Affected paths:
- src/progress.ts
- src/cli.ts

Originating run: 20261007T130703Z-33690435

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

