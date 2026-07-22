import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setupInitializingSource = await readFile(
  new URL(
    "../packages/webapp/src/containers/Setup/SetupInitializingForm.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("setup initializing imports every React hook it calls", () => {
  assert.match(
    setupInitializingSource,
    /import React,\s*\{\s*useEffect\s*\}\s*from ['"]react['"]/,
  );
});
