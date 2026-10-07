# NovelNest new-novel import standard

All newly added licensed novels with a web source must use `scripts/run_novel_catchup.sh`.

The catch-up runner:
- imports in resumable checkpoints,
- validates every checkpoint before publishing,
- commits and pushes every successful checkpoint,
- keeps going until the source is fully caught up,
- stops safely before the GitHub Actions timeout,
- queues another workflow run immediately when more backlog remains,
- then leaves the novel on its normal scheduled updater.

Do not use a fixed five-checkpoint / 500-chapter initial import for new novels.
Use a per-novel importer that only adds missing chapters and never deletes existing published chapters when the source temporarily reports fewer chapters.

Typical workflow environment:

```yaml
permissions:
  contents: write
  actions: write

env:
  IMPORT_NAME: "Novel title"
  IMPORT_COMMAND: "python scripts/import_example.py"
  IMPORT_GIT_PATHS: "dist/data/example-chapters-*.js dist/data/example-state.json dist/assets/example.jpg dist/licensed-example.js"
  IMPORT_MAX_CHECKPOINTS: "60"
  IMPORT_MAX_SECONDS: "9600"
  IMPORT_WORKFLOW: "import-example.yml"
  IMPORT_RESCHEDULE: "true"
  GH_TOKEN: ${{ github.token }}
```

Run it with:

```bash
bash scripts/run_novel_catchup.sh
```
