# BearyNatural · claude projects

One repository, several independent projects. Each project lives in its own top-level
folder and is built, checked and released on its own.

| Project | What it is | Releases |
|---|---|---|
| [`garden_app`](garden_app/) | **Sow by Season** — Australian garden-planning app: Android APK, plus a browser version published to the personal site ([`/sow-by-season/`](https://daydreaminginthecloud.bearynatural.dev/sow-by-season/)) | tags `garden_app-v…` |

## How projects are kept apart

| Rule | Why |
|---|---|
| Every project is a top-level folder with a **`project.json`** | The weekly maintenance workflow finds projects by this file |
| Project workflows are named **`<project>-*.yml`** and only trigger on **`<project>/**`** | A change to one project never builds another |
| Each workflow has its own **concurrency group** (`<project>-…`) | Runs of different projects never queue behind or cancel each other |
| Release tags start with **`<project>-v`** | Releases for different projects never clash |
| Automated commits only touch **files inside that project's folder** | Dependency updates can't leak across projects |

## Weekly maintenance (every Monday ~4 am Brisbane time)

`.github/workflows/weekly-maintenance.yml` runs a separate job for each project:

1. **Security** — secret scan (gitleaks), static analysis (Semgrep), known vulnerabilities (npm audit, OSV-Scanner).
2. **Compliance** — dependency licences against the project's allow-list, no keys/`.env` committed, README present, tests and type-check pass.
3. **Dependencies** — updates to the newest compatible versions. If anything changed *and* tests pass,
   it bumps the patch version, commits to `main` and starts that project's release workflow → a new release.

Every check runs even if an earlier one fails. Failures turn the job red, are listed in the run summary,
and are recorded in an issue titled **"Weekly maintenance: &lt;project&gt;"** (closed automatically once all checks pass).
Run it manually from **Actions → Weekly maintenance → Run workflow** (optionally for one project only).

## Adding a new project

1. Create `my_project/` with a `README.md`, a `package.json` with `test` (and ideally `typecheck`) scripts.
2. Add `my_project/project.json` (copy `garden_app/project.json`; change `name`, `tagPrefix`, `releaseWorkflow`, `dependencyUpdate` — use `"npm"` for non-Expo projects).
3. Put its build/release workflow at `my_project/ci/my_project-<something>.yml` with
   `paths: ['my_project/**']`, `concurrency: my_project-…` and tags `my_project-v…`.
4. Run `bash publish-to-github.sh` — it copies workflows into `.github/workflows` and pushes.

Signing keys and other secrets live in `_private_signing/` on your computer and in GitHub
**Settings → Secrets and variables → Actions** — never in the repository.
