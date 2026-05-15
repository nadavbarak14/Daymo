# Demo chat fixtures

Each subdirectory is a fixture customer with:
- One or more `.demo` files
- A pre-built `.daymo/` (capture + step-index + state)
- A pre-built `output.mp4`
- `golden-questions.json`: ground-truth Q→stepId pairs for retrieval recall tests

To rebuild a fixture from scratch:

```bash
cd tests/fixtures/demo-chat/loomly
npx daymo capture tour.demo --all   # requires the dev server fixture in demo-server.mjs
npx daymo stitch tour.demo
```

Then update `golden-questions.json` if step boundaries changed.

## Updating expected stepIds after running stitch

After `daymo stitch` runs, open `tests/fixtures/demo-chat/loomly/.daymo/step-index.json`. For each entry in `golden-questions.json` that has `expectedStepId`, find the step whose `description` field matches the question intent and update the `expectedStepId` to that step's stepId. If the matching scene has no `fx.step()` calls, the stepId stays at `tour:<sceneIndex>:0` (preamble).

The placeholder stepIds in this file are best-guess and must be confirmed manually before the recall test will pass.
