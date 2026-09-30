import test from "node:test";
import assert from "node:assert/strict";
import { getMediaQuotas } from "../lib/media-policy";

test("media quotas have finite family and system defaults", () => {
  assert.deepEqual(getMediaQuotas({}), { familyBytes: 1024 ** 3, systemBytes: 10 * 1024 ** 3 });
});

test("media quotas accept positive safe integer byte limits", () => {
  assert.deepEqual(getMediaQuotas({ MEDIA_FAMILY_QUOTA_BYTES: "100", MEDIA_SYSTEM_QUOTA_BYTES: "500" }), {
    familyBytes: 100, systemBytes: 500,
  });
});

test("invalid configured quotas fail closed rather than disabling limits", () => {
  for (const value of ["", "0", "-1", "1.5", "1e9", "NaN", "Infinity", " 100 ", "9007199254740992"]) {
    for (const name of ["MEDIA_FAMILY_QUOTA_BYTES", "MEDIA_SYSTEM_QUOTA_BYTES"]) {
      assert.throws(() => getMediaQuotas({ [name]: value }), /параметр квоты/);
    }
  }
});
