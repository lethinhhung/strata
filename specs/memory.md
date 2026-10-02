# Strata Memory Specification

## Purpose and Storage
Memory is concise, repository-scoped engineering knowledge used across runs. This specification defines its classes and lifecycle; a Strata implementation must configure its storage location and representation. No runtime memory store is prescribed here.

## Classes and Format
- **Decision:** An implementation choice and rationale. Include date, active or superseded status, context, decision, rationale, affected paths, and originating run record. A superseded decision links its replacement and remains traceable.
- **Note:** A durable constraint, gotcha, or repository landmark. Include date, observation, affected paths, and originating run record.
- **Progress:** Ongoing work that remains useful across runs. Include date, completed and remaining work, affected paths, and originating run record. Close or remove stale progress.

Keep entries concise and check for duplicates before writing. No update is required when a run yields no durable insight.

## Precedence and Access
- Specifications are authoritative. Active decisions are precedent but yield to conflicting specifications. Notes and progress are informational and cannot resolve specification conflicts.
- The Coordinator reads the configured memory policy and relevant entries before planning.
- The Stage Coordinator selects relevant entries and passes them to the implementation, review, test, validation, and repair agents as read-only context. The handoff is recorded in the run record. Agents use relevant entries to guide work and avoid repeating known discoveries. Worker agents may read supplied entries but never write memory.
- After each stage passes its checkpoint, Strata invokes the Archivist with that stage's results and existing entries. The write completes before the next stage starts, making newly recorded knowledge available to it. The Archivist is the only role authorized to propose memory writes.
- Memory is advisory context: it may guide work but cannot override specifications or acceptance criteria, and it is never implementation, review, test, validation, or acceptance evidence. Missing or unavailable memory does not block a run.

## Writes and Safety
- Memory is written automatically after each successful stage checkpoint by `strata run` and `strata resume`. Failed stages are not archived. An archival failure is recorded without failing the stage and is retried on resume. `strata archive RUN_ID` remains available for completed runs and manual retries.
- Memory writes are bounded, serialized with shared mutations, and based on observed reusable knowledge. The Archivist does not edit specifications, source, tests, or human-managed memory policy.
- Never store credentials, secrets, private user content, or raw application data.
- Archival is not a quality gate. Record archival failure without changing stage or run completion status.
