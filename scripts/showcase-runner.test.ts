import { expect, test } from "bun:test";
import { emptyState, preserveCandidate, type Item } from "./intake";
import {
  selectedCollectionComplete,
  analyzedItem,
  hasUnselectedSources,
  recordAnalysisFailure,
} from "./showcase-runner";
import { showcaseAnalysisSchema } from "./showcase-analysis";
test("corpus analysis retries independent quote failures but bounds a stalled record", () => {
  let failure: ReturnType<typeof recordAnalysisFailure> | undefined;
  let completed = 100;
  for (const id of ["first", "second", "third", "fourth"]) {
    failure = recordAnalysisFailure(
      failure,
      new Error(`Invalid quote for ${id}`),
      completed,
      completed + 6,
      1000,
    );
    completed += 6;
    expect(failure.attempts).toBeLessThan(3);
    expect(failure.analyzedRecords).toBe(completed);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    failure = recordAnalysisFailure(
      failure,
      new Error("Same batch still has an invalid PDF page"),
      completed,
      completed,
      2000,
    );
    expect(failure.attempts).toBe(attempt);
  }
  expect(failure?.retryAt).toBe(32000);
  expect(failure?.error).toContain("invalid PDF page");
});
test("completion gate rejects missing/failed/unclassified selected sources", () => {
  const state = emptyState([]);
  const c = preserveCandidate(state, "https://example.edu/projects", {
    schoolId: "example",
    category: "capstone",
    year: 2026,
    title: "Projects",
    discoveredAt: "2026-10-09",
  });
  expect(selectedCollectionComplete(state, [])).toBe(false);
  expect(selectedCollectionComplete(state, [c.id])).toBe(false);
  c.status = "downloaded";
  c.revisions.push({
    hash: "h",
    kind: "html",
    rawPath: "raw",
    textPath: "text",
    parseStatus: "done",
    requestedUrl: c.url,
    finalUrl: c.url,
    accessedAt: "2026-10-09",
  });
  expect(selectedCollectionComplete(state, [c.id])).toBe(false);
  state.classification[`${c.id}:h`] = {
    done: true,
    nextChunk: 1,
    failures: [],
  };
  expect(selectedCollectionComplete(state, [c.id])).toBe(true);
  expect(selectedCollectionComplete(state, [c.id, "missing"])).toBe(false);
});
test("canonical query ordering cannot keep a drained collection restarting forever", () => {
  const state = emptyState([]);
  const c = preserveCandidate(state, "https://example.edu/project?b=2&a=1", {
    schoolId: "example",
    category: "capstone",
    year: 2026,
    title: "Project",
    discoveredAt: "2026-10-09",
  });
  expect(
    hasUnselectedSources(
      [{ url: "https://example.edu/project?b=2&a=1" }],
      [c.id],
    ),
  ).toBe(false);
  expect(
    hasUnselectedSources(
      [{ url: "https://example.edu/project?a=1&b=3" }],
      [c.id],
    ),
  ).toBe(true);
});
test("analysis enriches classification without inventing dates or changing raw evidence", () => {
  const raw = {
    title: "Atlas",
    domain: "Unknown",
    keywords: [],
    evidence: [
      { quote: "Original abstract", sourceUrl: "https://example.edu/projects" },
    ],
    date: null,
    dateStatus: "unverified",
    timeframe: "unknown",
    unansweredQuestions: ["Date unknown"],
  } as unknown as Item;
  const a = showcaseAnalysisSchema.parse({
    items: [
      {
        id: "a",
        identity: "Atlas",
        disposition: "project",
        roboticsSimulationRelevance: "direct",
        conciseDescription: "A pipe robot",
        problem: "Pipe access",
        targetCustomers: ["Operators"],
        applicability: "Inspection",
        reportedResults: "Prototype described",
        possibleImprovement: "Possibly less manual review",
        commercialInterpretation: "Unvalidated hypothesis",
        unknowns: ["Field reliability"],
        claims: [{ claim: "Prototype", quote: "Original abstract" }],
      },
    ],
  }).items[0]!;
  const result = analyzedItem(raw, a);
  expect(result.classificationStatus).toBe("classified");
  expect(result.date).toBeNull();
  expect(result.dateStatus).toBe("unverified");
  expect(raw.domain).toBe("Unknown");
  expect(raw.evidence[0]?.quote).toBe("Original abstract");
});
