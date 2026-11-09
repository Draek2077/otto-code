import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL(".github/workflows/otto-app-acceptance.yml", root), "utf8");

test("Otto acceptance builds fresh declarations and partitions every Otto spec with one worker per shard", () => {
  const command =
    "npm run test:e2e --workspace=@getpaseo/app -- 'e2e/browser/otto-.*\\.spec\\.ts$' --workers=1 --retries=0 --max-failures=1";
  assert.ok(source.includes(command));
  assert.ok(source.includes("run: npm run build:server"));
  assert.ok(source.indexOf("run: npm run build:server") < source.indexOf(command));
  assert.ok(source.includes("run: npm run build --workspace=@getpaseo/expo-two-way-audio"));
  assert.match(source, /E2E_WORKERS: "1"/);
  assert.ok(source.includes('--shard="$OTTO_ACCEPTANCE_SHARD/2"'));
  assert.ok(
    source.includes(
      "shard: ${{ fromJSON(github.event_name == 'workflow_dispatch' && inputs.journey != 'all' && '[1]' || '[1,2]') }}",
    ),
  );
  assert.match(source, /max-parallel: 2/);
  assert.match(source, /fail-fast: false/);
  assert.ok(source.includes("name: otto-app-acceptance-${{ matrix.shard }}"));
  const specs = new Set(
    readdirSync(new URL("packages/app/e2e/browser/", root)).filter((name) =>
      /^otto-.*\.spec\.ts$/.test(name),
    ),
  );
  assert.ok(specs.has("otto-brain.spec.ts"));
  assert.ok(specs.has("otto-provider-settings.spec.ts"));
  const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.ok(ci.includes("scripts/otto/app-acceptance.test.mjs"));
});

test("Otto acceptance remains read-only CI over an exact source with retained success/failure evidence", () => {
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(
    source,
    /:\s*write\b|secrets\.|npm publish|gh release|E2E_FORK_PASEO_HOME_FROM/,
  );
  assert.ok(source.includes("ref: ${{ inputs.checkout_ref || github.sha }}"));
  assert.match(source, /timeout-minutes: 30/);
  assert.match(source, /if: always\(\)/);
  assert.ok(source.includes("packages/app/test-results/"));
});

test("manual diagnostics stay bounded while every push and pull request retains the full gate", () => {
  const choiceMatch = /options:\s*\[([^\]]+)\]/u.exec(source);
  assert.ok(choiceMatch);
  assert.deepEqual(
    choiceMatch[1]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    [
      "all",
      "knowledge",
      "brain-cancellation",
      "context-health",
      "preview",
      "artifacts",
      "speech",
      "terminal",
      "editor",
      "workflows",
      "schedules",
    ],
  );
  assert.ok(
    source.includes("e2e/browser/otto-artifacts.spec.ts --workers=1 --retries=0 --max-failures=1"),
  );
  assert.ok(
    source.includes(
      "e2e/browser/otto-speech.spec.ts e2e/browser/mermaid-fullscreen.spec.ts e2e/browser/mermaid-streaming.spec.ts e2e/browser/streaming-markdown.spec.ts e2e/browser/agent-tab-image-stability.spec.ts --workers=1 --retries=0 --max-failures=1",
    ),
  );
  assert.ok(
    source.includes("e2e/browser/otto-preview.spec.ts --workers=1 --retries=0 --max-failures=1"),
  );
  assert.ok(source.includes("github.event_name == 'workflow_dispatch' && inputs.journey || 'all'"));
  assert.ok(
    source.includes(
      "'e2e/browser/otto-knowledge.*\\.spec\\.ts$' --workers=1 --retries=0 --max-failures=1",
    ),
  );
  assert.ok(
    source.includes(
      "--grep='canceling a running benchmark' --repeat-each=3 --workers=1 --retries=0 --max-failures=1",
    ),
  );
  assert.ok(
    source.includes("e2e/browser/otto-terminal.spec.ts --workers=1 --retries=0 --max-failures=1"),
  );
  assert.ok(
    source.includes("e2e/browser/otto-workflows.spec.ts --workers=1 --retries=0 --max-failures=1"),
  );
  assert.ok(
    source.includes(
      "e2e/browser/otto-schedules.spec.ts e2e/browser/schedules-edit-model-hydration.spec.ts e2e/browser/schedules-project-target.spec.ts e2e/browser/schedules-relative-time.spec.ts --workers=1 --retries=0 --max-failures=1",
    ),
  );
  assert.ok(source.includes('case "$OTTO_ACCEPTANCE_JOURNEY" in'));
  assert.ok(
    source.includes(
      "e2e/browser/otto-context-health.spec.ts --workers=1 --retries=0 --max-failures=1",
    ),
  );
  assert.ok(
    source.includes(
      "group: otto-app-acceptance-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && inputs.journey || 'all' }}",
    ),
  );
  assert.doesNotMatch(source, /continue-on-error|--pass-with-no-tests|--retries=[1-9]/);
});
