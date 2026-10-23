# repo-tools

Repository-wide automation shared by all projects. The workflows here are copied into `.github/workflows/` by `../publish-to-github.sh`.

- `github/workflows/weekly-maintenance.yml` — every week, for every folder that contains a `project.json`: security (secret scan, Semgrep, npm audit, OSV), compliance (licences, hygiene, tests, type-check) and dependency updates with a release. Problems go in a per-project issue ("Weekly maintenance: <project>") assigned to the repository owner; each update says what is still failing, and the issue closes by itself once every check passes.
  It also runs a **pipeline check** for the whole repository (`pipeline-health.mjs`): failed runs and warnings from the past week, and actions that run on a deprecated Node.js version, which are moved to the smallest newer major version on Node.js 24 in every workflow file (including the projects' `ci/` copies). GitHub's built-in token may not change workflow files, so these fixes are pushed with the `WORKFLOWS_DEPLOY_KEY` secret (an SSH deploy key with write access to this repository) when it is set; otherwise the exact change is shown in the summary and in the issue "Weekly maintenance: pipelines".
- `github/workflows/failure-alerts.yml` — GitHub only emails the person who started a run, so failures of scheduled or workflow-started runs (such as a release started by the weekly maintenance) reach nobody. When a listed workflow fails on `main`, this opens an issue "Pipeline failed: <workflow>" assigned to the repository owner (GitHub notifies assignees) and closes it when the workflow next succeeds. **Add new workflows to its list.**
- `audit-with-exceptions.mjs` — npm audit (production, high and critical) honouring each project's narrow, time-limited exceptions in `osv-scanner.toml`.
- `pipeline-health.mjs` — the weekly pipeline check (run locally with `GITHUB_REPOSITORY=BearyNatural/claude GITHUB_TOKEN=$(gh auth token) node repo-tools/pipeline-health.mjs` for a read-only report; `--apply` updates workflow files).

See the repository `README.md` for the multi-project conventions.
