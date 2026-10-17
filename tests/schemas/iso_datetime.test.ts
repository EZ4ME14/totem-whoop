import { describe, it, expect } from "vitest";
import { IsoDateTime } from "../../src/schemas/primitives.js";
import { JournalOut } from "../../src/schemas/journal.js";

// Regression guard: Whoop's journal / pg-range endpoints emit timestamps in the
// no-colon offset form ("+0000" / "-0700"). zod's z.iso.datetime({offset:true})
// rejects that form, which made JournalOut.parse throw on real journal entries
// once `recorded_at` was populated (output validation runs BEFORE jsonOut's
// localizeTimestamps normalizes the offset). IsoDateTime must accept it.
describe("IsoDateTime", () => {
  it("accepts every form Whoop emits", () => {
    for (const s of [
      "2026-05-23T07:35:46Z",
      "2026-05-23T07:35:46.220Z",
      "2026-05-23T07:35:46.220+00:00",
      "2026-05-23T07:35:46.220+0000", // Whoop journal / pg-range form
      "2026-05-23T00:35:46.220-07:00",
      "2026-05-23T00:35:46.220-0700", // no-colon local offset
    ]) {
      expect(IsoDateTime.safeParse(s).success, s).toBe(true);
    }
  });

  it("rejects non-datetime strings", () => {
    for (const s of ["2026-05-23", "hello", "", "2026-05-23 07:35:46", "07:35:46"]) {
      expect(IsoDateTime.safeParse(s).success, s).toBe(false);
    }
  });
});

describe("JournalOut with a populated +0000 recorded_at (the regression case)", () => {
  it("parses instead of throwing", () => {
    const entry = {
      date: "2026-05-23",
      cycle_id: 123,
      journal_entry_id: "abc",
      notes: null,
      behaviors: [
        {
          behavior_tracker_id: 1,
          title: "Alcohol",
          category: "Lifestyle",
          internal_name: "alcohol",
          answered_yes: true,
          magnitude_value: null,
          magnitude_label: null,
          recorded_at: "2026-05-23T07:35:46.220+0000",
        },
      ],
    };
    expect(() => JournalOut.parse(entry)).not.toThrow();
  });
});
