import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authMetaSource = await readFile(
  new URL(
    "../packages/webapp/src/containers/Authentication/AuthMetaBoot.tsx",
    import.meta.url,
  ),
  "utf8",
);
const registerSource = await readFile(
  new URL(
    "../packages/webapp/src/containers/Authentication/Register.tsx",
    import.meta.url,
  ),
  "utf8",
);
const signupServiceSource = await readFile(
  new URL(
    "../packages/server/src/modules/Auth/commands/AuthSignup.service.ts",
    import.meta.url,
  ),
  "utf8",
);
const authMailSubscriberSource = await readFile(
  new URL(
    "../packages/server/src/modules/Auth/subscribers/AuthMail.subscriber.ts",
    import.meta.url,
  ),
  "utf8",
);

test("auth metadata reads the direct SDK response shape", () => {
  assert.match(
    authMetaSource,
    /signupDisabled:\s*authMeta\?\.(?:signup_disabled|signupDisabled)/,
  );
});

test("registration handles SDK errors and always releases Formik submission state", () => {
  assert.match(registerSource, /const handleSubmit = async/);
  assert.match(registerSource, /error\?\.data\?\.errors/);
  assert.match(registerSource, /finally\s*{\s*setSubmitting\(false\);?\s*}/s);
});

test("the owner email allowlist comparison is case-insensitive and trimmed", () => {
  assert.match(
    signupServiceSource,
    /const normalizedEmail = email\.trim\(\)\.toLowerCase\(\)/,
  );
  assert.match(
    signupServiceSource,
    /allowedEmail\.trim\(\)\.toLowerCase\(\) === normalizedEmail/,
  );
});

test("disabled signup confirmation cannot enqueue verification email", () => {
  assert.match(authMailSubscriberSource, /if \(!payload\.user\.verifyToken\) return;/);
});
