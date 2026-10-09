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
import {
  publishable,
  validateDraft,
  group,
  groupingFingerprint,
  nextSignalRetry,
  derive,
  market,
} from "./opportunities";
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
  expect(
    validateDraft(
      { ...draft, publishRecommended: false, evidenceItemIds: ["a"] },
      items,
    ).publishRecommended,
  ).toBe(false);
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

function classifiedItem(index: number): Item {
  const id = "project-" + index;
  return {
    id,
    candidateId: id,
    title: id,
    keywords: [],
    domain: "Engineering",
    revisionHash: "revision",
    schoolIds: [],
    category: "research",
    problem: "Buyer problem",
    approach: "Reported approach",
    embodiment: "Unknown",
    readiness: "Unknown",
    date: null,
    dateStatus: "unverified",
    timeframe: "unknown",
    evidence: [
      { quote: "Actual result", sourceUrl: "https://example.edu/result" },
    ],
    reportedResults: "Actual result",
    interpretation: "Possible use",
    unansweredQuestions: [],
    classificationStatus: "classified",
  };
}

test("grouping caches empty and positive results and advances through all budgeted windows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "signal-progress-"));
  try {
    const state = emptyState([]);
    state.items = Array.from({ length: 95 }, (_, index) =>
      classifiedItem(index),
    );
    const starts: string[] = [];
    const agent = (async (prompt: string) => {
      const batch = JSON.parse(
        prompt.slice(prompt.indexOf("\n") + 1),
      ) as Item[];
      starts.push(batch[0]!.id);
      return {
        groups:
          batch[0]!.id === "project-0"
            ? []
            : [
                {
                  itemIds: batch.slice(0, 2).map((item) => item.id),
                  reason: "Shared buyer hypothesis",
                },
              ],
      };
    }) as NonNullable<Parameters<typeof group>[1]>["agent"];
    for (let pass = 0; pass < 4; pass++)
      await group(state, { root: directory, budget: 1, agent });
    expect(starts).toEqual(["project-0", "project-40", "project-80"]);
    expect(state.edges).toHaveLength(2);
    state.edges = [];
    await group(state, { root: directory, budget: 1, agent });
    expect(starts).toHaveLength(3);
    expect(state.edges).toHaveLength(2);
    const before = groupingFingerprint(state.items.slice(0, 50));
    state.items[0]!.reportedResults = "Field absent from grouping input";
    expect(groupingFingerprint(state.items.slice(0, 50))).toBe(before);
    state.items[0]!.problem = "Changed buyer problem";
    await group(state, { root: directory, budget: 1, agent });
    expect(starts).toEqual([
      "project-0",
      "project-40",
      "project-80",
      "project-0",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid grouping applies no partial links and backs off while later windows progress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "signal-backoff-"));
  try {
    const state = emptyState([]);
    state.items = Array.from({ length: 60 }, (_, index) =>
      classifiedItem(index),
    );
    let calls = 0;
    const agent = (async () => {
      calls++;
      return calls === 1
        ? {
            groups: [
              { itemIds: ["project-0", "project-1"], reason: "Possible link" },
              { itemIds: ["project-0", "invented"], reason: "Invalid link" },
            ],
          }
        : { groups: [] };
    }) as NonNullable<Parameters<typeof group>[1]>["agent"];
    await group(state, { root: directory, budget: 1, agent });
    expect(state.edges).toHaveLength(0);
    expect(await nextSignalRetry({ root: directory })).toBeGreaterThan(
      Date.now(),
    );
    await group(state, { root: directory, budget: 1, agent });
    await group(state, { root: directory, budget: 1, agent });
    expect(calls).toBe(2);
    await group(state, { root: directory, budget: 1, agent, retry: true });
    expect(calls).toBe(3);
    expect(await nextSignalRetry({ root: directory })).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("derivation failures back off and allow another cluster to advance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "derive-backoff-"));
  try {
    const state = emptyState([]);
    state.items = Array.from({ length: 4 }, (_, index) =>
      classifiedItem(index),
    );
    state.clusters = [0, 2].map((index) => ({
      id: "cluster-" + index,
      itemIds: state.items.slice(index, index + 2).map((item) => item.id),
      edgeIndices: [],
    }));
    let calls = 0;
    const agent = (async () => {
      calls++;
      throw new Error("Model unavailable");
    }) as NonNullable<Parameters<typeof derive>[1]>["agent"];
    await derive(state, { root: directory, budget: 1, agent });
    await derive(state, { root: directory, budget: 1, agent });
    await derive(state, { root: directory, budget: 1, agent });
    expect(calls).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("market rejects unmatched downloaded excerpts and backs off repeated attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "market-backoff-"));
  try {
    const state = emptyState([]);
    state.opportunities = [
      {
        id: "signal-test",
        clusterId: "cluster-test",
        fingerprint: "test",
        evidenceItemIds: ["a", "b"],
        title: "Signal",
        summary: "Hypothesis",
        domain: "Engineering",
        whatItIs: "Possible product",
        problem: "Buyer problem",
        buyer: "Operators",
        breakthroughs: [{ text: "Reported result", itemIds: ["a", "b"] }],
        statusQuo: "Unknown",
        gap: "Unverified",
        marketOpportunity: "Hypothesis",
        risks: [],
        nextQuestions: [],
        updatedAt: "2026-10-08T00:00:00.000Z",
        publishRecommended: true,
        stage: "hypothesis",
        marketEvidence: [],
      },
    ];
    let calls = 0;
    const agent = (async () => {
      calls++;
      return {
        marketOpportunity: "Hypothesis",
        statusQuo: "Unverified",
        gap: "Unknown",
        risks: [],
        nextQuestions: [],
        sources: [
          {
            title: "Company",
            url: "https://example.com/product",
            excerpt: "Unsupported reported outcome",
          },
        ],
      };
    }) as NonNullable<Parameters<typeof market>[1]>["agent"];
    const downloader = (async () => ({
      bytes: Buffer.from("<p>Actual source content</p>"),
      finalUrl: "https://example.com/product",
      contentType: "text/html",
    })) as NonNullable<Parameters<typeof market>[1]>["downloader"];
    await market(state, { root: directory, agent, downloader });
    await market(state, { root: directory, agent, downloader });
    expect(calls).toBe(1);
    expect(state.opportunities[0]!.stage).toBe("hypothesis");
    expect(state.opportunities[0]!.marketEvidence).toHaveLength(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
