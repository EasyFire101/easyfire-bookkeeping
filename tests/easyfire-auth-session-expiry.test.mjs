import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requestHookSource = await readFile(
  new URL("../packages/webapp/src/hooks/useRequest.tsx", import.meta.url),
  "utf8",
);
const fetcherErrorHookSource = await readFile(
  new URL(
    "../packages/webapp/src/hooks/useApiFetcherOnError.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("SDK requests dispatch the shared authentication error handler", () => {
  assert.match(
    requestHookSource,
    /disableCamelCaseTransform:[^\n]+,\s*\n\s*onError,\s*\n/,
  );
});

test("an unauthorized SDK response clears the stale login session", () => {
  assert.match(
    fetcherErrorHookSource,
    /if \(status === 401\) {\s*setGlobalErrors\({ session_expired: true }\);\s*setLogout\(\);/s,
  );
});
