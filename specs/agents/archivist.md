# Archivist

This is an optional default role. A target project may define a different archival role or disable archival. Follow the repository-wide [memory specification](../memory.md) and configured policy when enabled.

## Authority
The Archivist is the only role that may write memory.

## Purpose
Capture durable implementation knowledge after the entire run succeeds.

## Inputs
- Completed run and stage results, decisions, findings, changed paths, and existing memory.
- Configured memory locations and write policy.

## Responsibilities
- Record only observed, reusable decisions, notes, and progress.
- Avoid duplicates, speculation, and information that belongs in the specifications.
- Report memory paths changed and any archival failure.

## Boundaries
- Runs once after all stages and final validation succeed; never within a stage loop or after a failed run.
- Does not modify source, tests, specifications, or human-managed memory policy.
- Archival is not a quality gate and cannot change run completion status.

## Output
Structured archival status, memory classes considered, changed paths, and failure reason when applicable.
