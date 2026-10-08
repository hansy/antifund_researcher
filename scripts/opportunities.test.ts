import { expect, test } from "bun:test";
import { z } from "zod";
import { normalizeOutput, strictSchema } from "./codex";
import {
  explicitDateMatches,
  emptyState,
  preserveCandidate,
  collect,
  type Item,
  graph,
} from "./intake";
import { publishable, validateDraft } from "./opportunities";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("strict model output preserves required unknown dates and removes only optional nulls", () => {
  const schema = z.object({
    items: z.array(
      z.object({ date: z.string().nullable(), page: z.number().optional() }),
    ),
  });
  const original = z.toJSONSchema(schema, { target: "draft-7" });
  const output = { items: [{ date: null, page: null }] };
  expect(strictSchema(original).properties.items.items.required).toContain(
    "page",
  );
  expect(schema.parse(normalizeOutput(output, original))).toEqual({
    items: [{ date: null }],
  });
});

test("explicit calendar dates normalize, but copyright and invalid dates do not", () => {
  expect(explicitDateMatches("2026-05-08", "Published May 08, 2026")).toBe(
    true,
  );
  expect(explicitDateMatches("2025", "2025 Capstone Design Symposium")).toBe(
    true,
  );
  expect(explicitDateMatches("2025", "Copyright 2025")).toBe(false);
  expect(explicitDateMatches("2026-02-30", "2026-02-30")).toBe(false);
});

test("unknown-date projects stay archived but cannot become dated public evidence", () => {
  const item = {
    classificationStatus: "classified",
    evidence: [{ quote: "Actual result" }],
    dateStatus: "unverified",
    timeframe: "unknown",
    date: null,
  } as Item;
  expect(publishable(item)).toBe(false);
  expect(
    publishable({
      ...item,
      dateStatus: "verified",
      timeframe: "in-window",
      date: "2025",
    }),
  ).toBe(true);
  expect(
    publishable({
      ...item,
      dateStatus: "verified",
      timeframe: "outside-window",
      date: "2027",
    }),
  ).toBe(false);
});

test("signal synthesis rejects unrelated project references", () => {
  const draft = {
    publishRecommended: true,
    title: "A useful idea",
    summary: "A hypothesis",
    domain: "Health",
    whatItIs: "A product",
    problem: "A buyer problem",
    buyer: "Clinics",
    statusQuo: "Manual work",
    gap: "Unproven",
    marketOpportunity: "A hypothesis",
    breakthroughs: [{ text: "Reported", itemIds: ["a"] }],
    evidenceItemIds: ["a", "b"],
    risks: [],
    nextQuestions: [],
  };
  const items = [
    { id: "a", candidateId: "a", title: "A" },
    { id: "b", candidateId: "b", title: "B" },
  ] as Item[];
  expect(validateDraft(draft, items)).toBe(draft);
  expect(() =>
    validateDraft(
      { ...draft, breakthroughs: [{ text: "Unsupported", itemIds: ["c"] }] },
      items,
    ),
  ).toThrow();
  expect(() =>
    validateDraft({ ...draft, evidenceItemIds: ["a", "a"] }, items),
  ).toThrow();
  expect(() =>
    validateDraft(
      draft,
      items.map((i) => ({ ...i, candidateId: "a", title: "A" })),
    ),
  ).toThrow();
});

test("keyword regrouping preserves previously derived semantic links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-graph-test-"));
  try {
    const state = emptyState([]);
    state.items = ["a", "b"].map((id): Item => ({
      id,
      candidateId: id,
      title: id,
      keywords: [],
      domain: "Unknown",
      revisionHash: "revision",
      schoolIds: [],
      category: "ambiguous",
      problem: "Unknown",
      approach: "Unknown",
      embodiment: "unknown",
      readiness: "Unknown",
      date: null,
      dateStatus: "unverified",
      timeframe: "unknown",
      evidence: [],
      reportedResults: "Unknown",
      interpretation: "Unknown",
      unansweredQuestions: [],
      classificationStatus: "ambiguous",
    }));
    state.edges = [
      {
        from: "a",
        to: "b",
        score: 1,
        sharedKeywords: [],
        reasons: ["Semantic hypothesis: shared buyer problem"],
      },
    ];
    await graph(state, { root: directory });
    expect(state.edges).toHaveLength(1);
    expect(state.clusters[0]?.itemIds).toEqual(["a", "b"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsupported downloads survive parser failure as archived raw revisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intake-binary-test-"));
  try {
    const school = {
      id: "test",
      name: "Test",
      domain: "example.edu",
      discoveryUrls: [],
    };
    const state = emptyState([school]);
    preserveCandidate(state, "https://example.edu/project/data", {
      schoolId: school.id,
      category: "research",
      year: 2025,
      title: "Data",
      discoveredAt: "2026-10-08",
    });
    await collect(state, [school], {
      root: directory,
      budget: 1,
      downloader: async () => ({
        bytes: Buffer.from("retained binary content"),
        finalUrl: "https://example.edu/project/data",
        contentType: "application/octet-stream",
      }),
    });
    const revision = state.candidates[0]!.revisions[0]!;
    expect(revision.kind).toBe("binary");
    expect(revision.parseStatus).toBe("failed");
    expect(await readFile(revision.rawPath, "utf8")).toBe(
      "retained binary content",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
