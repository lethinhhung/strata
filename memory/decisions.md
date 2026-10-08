

## 2026-10-08 — Telemetry collection and rendering separation

Date: 2026-10-07. Decision: Keep telemetry collection in runtime/provider data paths and terminal rendering in the CLI presentation layer; persisted telemetry should remain usable by JSON status output and future consumers. Rationale: To maintain separation of concerns and allow telemetry to be used by multiple consumers. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Additive backward-compatible telemetry fields

Date: 2026-10-07. Decision: Use additive, backward-compatible telemetry fields and tolerate records without them. Capture model identity, token usage where provider output supplies it, agent status and duration, and retry/attempt relationships without changing orchestration, retry policy, or stage gates. Rationale: To ensure compatibility with existing records and allow gradual adoption of telemetry. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Render retries grouped and derive summary from recorded data

Date: 2026-10-07. Decision: Render retries grouped beneath their agent/stage identity, and derive overall elapsed time, totals, validation results, and final summary from recorded run data rather than adding orchestration behavior. Rationale: To avoid complicating the orchestration logic and keep the runtime focused on execution. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435


## 2026-10-08 — Edit permission for implementation stages

Date: 2026-10-07. Decision: Edit permission is appropriate for both planned implementation stages: the first changes runtime/provider telemetry and its related tests; the second changes terminal presentation and its related tests. Review and validation remain read-only. Rationale: To allow necessary changes while keeping validation and review independent. Status: active. Affected paths: `src/ask.test.ts`, `src/providers.ts`, `src/providers/parse.ts`, `src/runtime/archiveMemory.ts`, `src/runtime/ask.ts`, `src/runtime/finalValidation.ts`, `src/runtime/gateRepair.ts`, `src/runtime/gateTests.ts`, `src/runtime/gateValidation.ts`, `src/runtime/progress.ts`, `src/runtime/runStage.ts`, `src/runtime/startRun.ts`, `debug-ask.js`, `debug-ask2.js`, `debug-json.js`, `debug-legacy.js`, `debug-simple.js`, `src/debug-json.js`, `src/debug-save-load.js`, `src/providers.test.ts`, `src/runtime.test.ts`, `src/runtime/agentStep.ts`. Run: 20261007T130703Z-33690435

