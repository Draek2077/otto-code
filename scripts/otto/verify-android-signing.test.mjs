import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAndroidSignerMatch } from "./verify-android-signing.mjs";

const digest = "1234567890abcdef".repeat(4);
const certificate = `Certificate fingerprints:\n\t SHA256: ${digest.toUpperCase().match(/../g).join(":")}\n`;

for (const label of ["Signer #1", "V2 Signer"]) {
  test(`matches ${label} to keytool's colon-delimited fingerprint`, () => {
    assert.equal(
      verifyAndroidSignerMatch(`${label}: certificate SHA-256 digest: ${digest}\n`, certificate),
      digest,
    );
  });
}

test("rejects mismatched, missing, malformed and ambiguous signers", () => {
  const signer = (value) => `V2 Signer: certificate SHA-256 digest: ${value}\n`;
  assert.throws(() => verifyAndroidSignerMatch(signer("a".repeat(64)), certificate), /differ/);
  assert.throws(() => verifyAndroidSignerMatch("", certificate), /exactly one/);
  assert.throws(() => verifyAndroidSignerMatch(signer("1234"), certificate), /exactly one/);
  assert.throws(() => verifyAndroidSignerMatch(signer(digest), ""), /exactly one/);
  assert.throws(
    () => verifyAndroidSignerMatch(signer(digest) + signer("a".repeat(64)), certificate),
    /exactly one/,
  );
});
