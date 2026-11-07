import { strict as assert } from "node:assert";
import { test } from "node:test";
import { insertionOrders, SiblingEntry } from "../src/siblingOrder";

test("insertion planning matches sequential placement across reordered, retained and interleaved siblings", () => {
  let seed = 3;
  const random = (): number =>
    (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 300; run++) {
    const siblings = ["a", "b", "c", "d", "note"];
    const entries: SiblingEntry[] = [
      ...siblings.slice(0, 4),
      "new1",
      "new2",
      "new3",
    ]
      .sort(() => random() - 0.5)
      .map((uid) => ({
        uid,
        existing: siblings.includes(uid),
        retained: uid === "c",
        header: false,
      }));
    if (run % 2)
      entries.unshift({
        uid: "header",
        existing: false,
        retained: false,
        header: true,
      });
    const expected = [...siblings];
    const expectedOrders = new Map<string, number>();
    let preceding: string | undefined;
    entries.forEach((entry, index) => {
      if (entry.retained) return;
      if (!entry.existing) {
        const next = entries
          .slice(index + 1)
          .find((e) => e.existing && !e.retained);
        const order = entry.header
          ? 0
          : next
            ? expected.indexOf(next.uid)
            : preceding
              ? expected.indexOf(preceding) + 1
              : expected.length;
        expectedOrders.set(entry.uid, order);
        expected.splice(order, 0, entry.uid);
      }
      preceding = entry.uid;
    });
    assert.deepEqual(
      insertionOrders({ siblings, entries }),
      expectedOrders,
      `run ${run}`,
    );
  }
});
