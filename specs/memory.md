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
- The Epic Coordinator reads the configured memory policy and relevant entries before planning.
- The Stage Coordinator selects relevant entries and passes them to agents as read-only context, recording the handoff in the run record. Agents use relevant entries to guide investigation, planning, and implementation, and to avoid repeating known discoveries. Worker agents may read supplied entries but never write memory.
- The Archivist reads the completed run and existing entries. It is the only role authorized to write memory, and only after a successful run.
- Memory is advisory context: it may guide work but cannot override specifications or acceptance criteria, and it is never implementation, review, test, validation, or acceptance evidence. Missing or unavailable memory does not block a run.

## Writes and Safety
- Only the Archivist writes memory, and only after all stages and final validation succeed. Failed runs keep diagnostics in `docs/temps/` and are not archived.
- Memory writes are bounded, serialized with shared mutations, and based on observed reusable knowledge. The Archivist does not edit specifications, source, tests, or human-managed memory policy.
- Never store credentials, secrets, private user content, or raw application data.
- Archival is not a quality gate. Record archival failure without changing stage or run completion status.
