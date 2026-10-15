## Provider Modules Refactor

### Summary
- The provider implementation was refactored into cohesive modules: `provider-invoke.ts`, `provider-output.ts`, `provider-process.ts`, and an updated `provider.ts` that re‑exports the public API.
- All new source files are under 120 lines.
- Public imports of `invoke`, `jsonResponse`, and `run` continue to resolve via the updated `provider.ts`.
- Focused provider tests (`tests/provider.test.ts`) pass.
- Extra non‑provider tests (`npm test`) also pass, confirming no regression.
- Validation succeeded on attempt 4; no validator errors remain.

### Decisions
- Split logic to isolate provider invocation, JSON parsing, and process lifecycle.
- Preserve backward compatibility by exporting the same functions from `provider.ts`.
- Removed unused code and comments to keep sources concise.
- Updated `cli.ts` to import from `provider.ts` (unchanged public API).
- Enforced 120‑line limit by moving helper classes to separate files.
- No new external dependencies introduced.

### Outstanding
- None.

### References
- Source files: `src/provider.ts`, `src/provider-invoke.ts`, `src/provider-output.ts`, `src/provider-process.ts`.
- Tests: `tests/provider.test.ts`.