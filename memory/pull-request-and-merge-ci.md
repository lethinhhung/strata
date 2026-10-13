# Pull‑Request and Merge CI

**Stage outcomes**

* All GitHub Actions workflows were created and validated against the completion criteria.
* **PR workflow**:
  * Node.js 20 used.
  * `npm ci` for clean dependency install.
  * Runs `npm run lint`, `npm run typecheck`, and `npm run test`.
  * Command failures result in a failed job; no external credentials are required. Permission scope is read‑only repository access.
* **Post‑merge workflow**:
  * Triggered on pushes to `main`.
  * Node.js 20, `npm ci`.
  * Runs `npm run build`.
  * Verifies that `dist/src/cli.js` exists, is executable (`chmod 755`), and returns valid version/help output (`--help`, `--version`).
* README updated to document the two workflows and the required package scripts.

**Key evidence**

* All CI command exit codes were zero.
* Workflow files passed the specification verifier.
* No runtime credentials or deployment actions are present.
* The build artifact passes the tests for executing the CLI help/version flags.

**Next steps**

The stage passes. Commit and push the changes, then proceed to the next stage in the run.
