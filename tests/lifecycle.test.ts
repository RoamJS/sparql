import { strict as assert } from "node:assert";
import { test } from "node:test";
import { COEXISTENCE_WARNING, developerPresent } from "../src/lifecycle";
test("Developer runtime guard recognizes known IDs and requires a verified reload handoff", () => {
  assert.equal(developerPresent(new Set(["developer", "sparql"])), true);
  assert.equal(developerPresent(["@roamjs/developer"]), true);
  assert.equal(developerPresent(["sparql", "query-builder"]), false);
  assert.match(COEXISTENCE_WARNING, /reload/i);
  assert.match(COEXISTENCE_WARNING, /cannot verify/);
});
