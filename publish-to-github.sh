#!/usr/bin/env bash
# Publishes every project in this folder to https://github.com/BearyNatural/claude (main).
#   bash ~/Documents/GitHub/claude_projects/publish-to-github.sh
#
# A "project" is any top-level folder containing a project.json (e.g. garden_app/).
# Workflows are kept inside each project (<project>/ci/*.yml) and in repo-tools/github/workflows,
# and are copied into .github/workflows here, because GitHub only runs them from there.
# _private_signing/ and anything not listed below is NEVER committed.
set -euo pipefail
cd "$(dirname "$0")"
REPO_URL="https://github.com/BearyNatural/claude.git"

if [ ! -d .git ]; then
  git init -b main
  git remote add origin "$REPO_URL"
fi

# Belt and braces: keep signing keys and local junk out of git.
touch .gitignore
for pat in '_private_signing/' 'node_modules/' '*.keystore' '*.jks' '.env' '*.txt.bak'; do
  grep -qxF "$pat" .gitignore || echo "$pat" >> .gitignore
done

# Pick up anything GitHub has committed since (e.g. the weekly dependency updates).
if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  git fetch origin main
  if ! git rev-parse --verify -q HEAD >/dev/null; then
    git reset -q origin/main
  else
    git pull --rebase --autostash origin main
  fi
fi

# Discover projects.
projects=()
for f in */project.json; do [ -f "$f" ] && projects+=("$(dirname "$f")"); done
echo "Projects: ${projects[*]:-none}"

# Rebuild .github/workflows from the sources (so deleted/renamed workflows disappear).
mkdir -p .github/workflows
git rm -q --cached --ignore-unmatch .github/workflows/sow-by-season-android.yml || true
rm -f .github/workflows/sow-by-season-android.yml
for p in "${projects[@]}"; do
  for wf in "$p"/ci/*.yml; do
    [ -f "$wf" ] || continue
    name=$(basename "$wf")
    case "$name" in "$p"-*) ;; *) echo "WARNING: $wf should be named $p-<something>.yml (skipped)"; continue ;; esac
    cp "$wf" ".github/workflows/$name"
  done
done
[ -d repo-tools/github/workflows ] && cp repo-tools/github/workflows/*.yml .github/workflows/

git add .gitignore .github "${projects[@]}"
[ -d repo-tools ] && git add repo-tools
[ -f README.md ] && git add README.md
git add publish-to-github.sh
git add -A .github   # records removed workflows

if git ls-files --cached | grep -q '^_private_signing/'; then
  echo "STOP: _private_signing is staged — not publishing."; exit 1
fi

if git diff --cached --quiet; then
  echo "Nothing new to publish."
else
  git -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo BearyNatural)}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo 42864379+BearyNatural@users.noreply.github.com)}" \
      commit -m "Update ${projects[*]} and repository workflows"
fi
git push -u origin main
echo
echo "Done.  Actions:  https://github.com/BearyNatural/claude/actions"
echo "       Releases: https://github.com/BearyNatural/claude/releases"
