#!/usr/bin/env bash
set -euo pipefail

: "${IMPORT_NAME:?Set IMPORT_NAME}"
: "${IMPORT_COMMAND:?Set IMPORT_COMMAND}"
: "${IMPORT_GIT_PATHS:?Set IMPORT_GIT_PATHS}"

max_checkpoints="${IMPORT_MAX_CHECKPOINTS:-60}"
max_seconds="${IMPORT_MAX_SECONDS:-9600}"
commit_prefix="${IMPORT_COMMIT_PREFIX:-Auto-update ${IMPORT_NAME} chapters}"
start_time="$(date +%s)"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

queue_continuation() {
  if [[ "${IMPORT_RESCHEDULE:-false}" != "true" || -z "${IMPORT_WORKFLOW:-}" ]]; then
    echo "${IMPORT_NAME}: catch-up will continue on the next scheduled run."
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "${IMPORT_NAME}: GitHub CLI is unavailable; next scheduled run will continue."
    return 0
  fi
  echo "${IMPORT_NAME}: queueing an immediate continuation run..."
  gh workflow run "${IMPORT_WORKFLOW}" --ref main || {
    echo "${IMPORT_NAME}: could not queue continuation; the next scheduled run will continue."
    return 0
  }
}

queue_pages_deploy() {
  if [[ "${IMPORT_DEPLOY_EACH_CHECKPOINT:-true}" != "true" ]]; then
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "${IMPORT_NAME}: GitHub CLI is unavailable; final workflow completion will publish the site."
    return 0
  fi
  if [[ -z "${GH_TOKEN:-}" ]]; then
    echo "${IMPORT_NAME}: GH_TOKEN is unavailable; final workflow completion will publish the site."
    return 0
  fi

  echo "${IMPORT_NAME}: queueing NovelHaven deployment for this checkpoint..."
  gh workflow run pages.yml --ref main || {
    echo "${IMPORT_NAME}: checkpoint was saved, but an immediate Pages deploy could not be queued."
    echo "${IMPORT_NAME}: the final workflow completion will still request publication."
    return 0
  }
}

for checkpoint in $(seq 1 "$max_checkpoints"); do
  echo "=== ${IMPORT_NAME} catch-up checkpoint ${checkpoint}/${max_checkpoints} ==="

  eval "$IMPORT_COMMAND"
  node scripts/check.mjs

  # IMPORT_GIT_PATHS is intentionally word-split so globs such as
  # dist/data/book-chapters-*.js expand to the generated checkpoint files.
  # shellcheck disable=SC2086
  git add -A -- $IMPORT_GIT_PATHS

  if git diff --cached --quiet; then
    echo "${IMPORT_NAME}: source and NovelNest are fully caught up."
    exit 0
  fi

  git commit -m "${commit_prefix} (checkpoint ${checkpoint})"

  pushed=0
  for attempt in 1 2 3; do
    git fetch origin main
    git rebase origin/main
    if git push origin HEAD:main; then
      pushed=1
      break
    fi
    echo "Push raced with another updater; retrying (${attempt}/3)..."
    sleep 2
  done

  if [[ "$pushed" -ne 1 ]]; then
    echo "${IMPORT_NAME}: could not push checkpoint after 3 attempts."
    exit 1
  fi

  # Commits created with GITHUB_TOKEN do not start new push-triggered workflows.
  # Explicitly request a Pages run so each safe checkpoint can become visible
  # while a long catch-up import is still running.
  queue_pages_deploy

  elapsed="$(( $(date +%s) - start_time ))"
  if (( elapsed >= max_seconds )); then
    echo "${IMPORT_NAME}: safe runtime budget reached after ${elapsed}s."
    queue_continuation
    exit 0
  fi
done

echo "${IMPORT_NAME}: checkpoint safety cap reached before the source was fully caught up."
queue_continuation
