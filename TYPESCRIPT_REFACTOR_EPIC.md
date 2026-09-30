# TypeScript Refactor

Migrate Strata's Node.js CLI from JavaScript to TypeScript while preserving its documented behavior.

## Requirements

- Use TypeScript for all maintained application and test source.
- Keep maintained source, configuration, and documentation files below 120 lines; dependency lockfiles are exempt.
- Preserve the CLI, provider, config, workflow, checkpoint, and resume behavior in `README.md` and `specs/`.
- Add regression tests and provide working `npm test`, `npm run typecheck`, and build scripts.
- Scope each stage's test files explicitly; keep TypeScript tests in the declared stage scope and compile them before running Node's built-in test runner. Runtime workflow coverage belongs in `src/runtime.test.ts`, which is included by the configured `npm test` script.
- Include generated build output in `.gitignore` and ensure no generated files enter checkpoints.
- Keep Node.js 20+ support and the `strata` executable.

## Acceptance

- No maintained JavaScript implementation remains in `src/` or test directories.
- An automated check confirms every tracked maintained text file has at most 119 lines, excluding dependency lockfiles.
- Build, typecheck, tests, review, and final validation pass.
- README instructions match the TypeScript build and CLI behavior.
