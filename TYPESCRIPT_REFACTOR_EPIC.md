# TypeScript Refactor

Migrate Strata's Node.js CLI from JavaScript to TypeScript while preserving its documented behavior.

## Requirements

- Use TypeScript for all maintained application and test source.
- Keep every tracked file below 120 lines; split long modules and documents as needed.
- Preserve the CLI, provider, config, workflow, checkpoint, and resume behavior in `README.md` and `specs/`.
- Add regression tests and provide working `npm test`, `npm run typecheck`, and build scripts.
- Keep Node.js 20+ support and the `strata` executable.

## Acceptance

- No maintained JavaScript implementation remains in `src/` or test directories.
- An automated check confirms every tracked file has at most 119 lines.
- Build, typecheck, tests, review, and final validation pass.
- README instructions match the TypeScript build and CLI behavior.
