

## 2026-10-06 — Separate event recording from CLI rendering

Date: 2026-10-06. Observation: Keep runtime event recording separate from CLI rendering to maintain separation of concerns and allow independent evolution of telemetry collection and presentation. Affected paths: src/runtime/progress.ts, src/runtime/records.ts, src/cli.ts, src/progress.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Backward compatibility with legacy records

Date: 2026-10-06. Observation: Preserve compatibility with older records that lack duration information by making telemetry fields optional and handling missing data gracefully in formatters and parsers. Affected paths: src/runtime/records.ts, src/runtime/save.ts, src/runtime/loadRun.ts, src/runtime/progress.ts, src/cli.ts. Run: 20261006T045047Z-070bf3f9.


## 2026-10-06 — Avoid duplicate timing entries

Date: 2026-10-06. Observation: Avoid duplicate timing entries by ensuring timing is recorded at appropriate layers (e.g., agent invocation boundary) and not repeated in multiple components. Affected paths: src/runtime/agentStep.ts, src/runtime/progress.ts, src/runtime/archiveMemory.ts, src/runtime/executeRun.ts. Run: 20261006T045047Z-070bf3f9.

