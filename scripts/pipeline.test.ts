import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkpoint,
  emptyState,
  preserveCandidate,
  buildGraph,
  loadIntake,
  type Item,
  type Opportunity,
} from "./intake";
import { runCodex } from "./codex";
import { mergeLaneState, runPipeline } from "./pipeline";

const school = {
  id: "test",
  name: "Test",
  domain: "example.edu",
  discoveryUrls: [],
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  roots.push(root);
  return root;
}
function item(id: string): Item {
  return {
    id,
    candidateId: id,
    revisionHash: "revision",
    title: id,
    schoolIds: [school.id],
    category: "research",
    domain: "Energy",
    problem: "Grid faults",
    approach: "Measure faults",
    keywords: ["grid", "fault"],
    embodiment: "software",
    readiness: "unknown",
    date: null,
    dateStatus: "unverified",
    timeframe: "unknown",
    evidence: [
      {
        quote: "Measures grid faults.",
        sourceUrl: "https://example.edu/research",
      },
    ],
    reportedResults: "Not reported",
    interpretation: "Hypothesis",
    unansweredQuestions: ["Accuracy?"],
    classificationStatus: "classified",
  };
}
function opportunity(id: string): Opportunity {
  return {
    id,
    clusterId: "cluster",
    fingerprint: "fingerprint",
    evidenceItemIds: ["a", "b"],
    title: id,
    summary: "Hypothesis",
    domain: "Energy",
    whatItIs: "Fault monitor",
    problem: "Grid faults",
    breakthroughs: [{ text: "Measures faults", itemIds: ["a", "b"] }],
    buyer: "Utilities",
    statusQuo: "Manual",
    gap: "Unknown",
    marketOpportunity: "Unverified",
    risks: ["Unknown demand"],
    nextQuestions: ["Demand?"],
    marketEvidence: [],
    stage: "hypothesis",
    updatedAt: "2026-10-08T00:00:00Z",
  };
}
const provenance = {
  schoolId: school.id,
  category: "research" as const,
  year: 2026,
  discoveredAt: "2026-10-08",
  title: "Source",
};

test("interleaved stale checkpoints preserve every other lane's records and fresh grouping members", () => {
  const canonical = emptyState([school]);
  canonical.items = [item("a"), item("b")];
  const baseline = structuredClone(canonical);
  const collector = structuredClone(baseline);
  preserveCandidate(collector, "https://example.edu/new", provenance);
  const classifier = structuredClone(baseline);
  classifier.items.push(item("c"));
  classifier.classification.new = { nextChunk: 1, done: true, failures: [] };
  const grouping = structuredClone(baseline);
  grouping.edges = [
    {
      from: "a",
      to: "b",
      score: 1,
      sharedKeywords: [],
      reasons: ["Semantic hypothesis: Shared buyer"],
    },
  ];
  const analysis = structuredClone(baseline);
  analysis.opportunities = [opportunity("one")];
  mergeLaneState(canonical, "collect", baseline, collector);
  mergeLaneState(canonical, "analyze", baseline, analysis);
  mergeLaneState(canonical, "classify", baseline, classifier);
  mergeLaneState(canonical, "group", baseline, grouping);
  const lateAnalysis = structuredClone(baseline);
  lateAnalysis.opportunities = [opportunity("two")];
  mergeLaneState(canonical, "analyze", baseline, lateAnalysis);
  const nextCollection = structuredClone(collector);
  nextCollection.candidates[0]!.attempts++;
  mergeLaneState(canonical, "collect", collector, nextCollection);
  expect(canonical.candidates).toHaveLength(1);
  expect(canonical.items.map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(canonical.classification.new?.done).toBe(true);
  expect(
    canonical.clusters.flatMap((cluster) => cluster.itemIds).sort(),
  ).toEqual(["a", "b", "c"]);
  expect(canonical.opportunities?.map((x) => x.id)).toEqual(["one", "two"]);
});

test("classifier removal only removes a baseline ambiguity, preserving newer canonical records", () => {
  const canonical = emptyState([school]);
  canonical.items = [item("ambiguous")];
  const baseline = structuredClone(canonical);
  canonical.items.push(item("newer"));
  const classifier = structuredClone(baseline);
  classifier.items = [item("classified")];
  mergeLaneState(canonical, "classify", baseline, classifier);
  expect(canonical.items.map((x) => x.id)).toEqual(["newer", "classified"]);
});

test("real four-lane operations checkpoint collection/grouping/analysis while classifier agent is blocked", async () => {
  const root = await temporary();
  const laneRoot = join(root, "pipeline");
  const archive = join(root, "archive");
  const state = emptyState([school]);
  state.cells.forEach((cell) => {
    cell.status = "done";
  });
  state.items = [item("a"), item("b")];
  Object.assign(state, buildGraph(state.items));
  const parsed = preserveCandidate(
    state,
    "https://example.edu/old",
    provenance,
  );
  parsed.status = "downloaded";
  const textPath = join(root, "old.txt");
  await writeFile(textPath, "Measures grid faults.");
  parsed.revisions.push({
    hash: "old",
    requestedUrl: parsed.url,
    finalUrl: parsed.url,
    accessedAt: "2026-10-08",
    kind: "html",
    rawPath: textPath,
    textPath,
    parseStatus: "done",
  });
  preserveCandidate(state, "https://example.edu/new", provenance);
  await checkpoint(state, { root: archive });
  let resolveCollected!: () => void,
    resolveGrouped!: () => void,
    resolveAnalyzed!: () => void;
  const collected = new Promise<void>((resolve) => {
    resolveCollected = resolve;
  });
  const grouped = new Promise<void>((resolve) => {
    resolveGrouped = resolve;
  });
  const analyzed = new Promise<void>((resolve) => {
    resolveAnalyzed = resolve;
  });
  let blocked = false,
    released = false;
  const agent: typeof runCodex = async (prompt, schema) => {
    if (prompt.startsWith("Classify")) {
      blocked = true;
      await Promise.all([collected, grouped, analyzed]);
      const latest = await loadIntake([school], { root: archive });
      expect(
        latest.candidates.find((x) => x.url.endsWith("/new"))?.status,
      ).toBe("downloaded");
      expect(latest.opportunities?.length).toBeGreaterThan(0);
      expect(latest.classification[`${parsed.id}:old`]?.done).not.toBe(true);
      released = true;
      const {
        id,
        candidateId,
        revisionHash,
        schoolIds,
        dateStatus,
        timeframe,
        ...record
      } = item("Extracted");
      return schema.parse({
        items: [
          {
            ...record,
            dateEvidence: null,
            evidence: [{ quote: "Measures grid faults.", page: null }],
          },
        ],
        ambiguity: "",
      });
    }
    if (prompt.startsWith("Group")) {
      resolveGrouped();
      return schema.parse({ groups: [] });
    }
    if (prompt.startsWith("Assess")) {
      const {
        id,
        clusterId,
        fingerprint,
        marketEvidence,
        stage,
        updatedAt,
        ...draft
      } = opportunity("draft");
      // This milestone follows the real derive checkpoint, not merely the agent return.
      setTimeout(async () => {
        for (let i = 0; i < 100; i++) {
          if (
            (await loadIntake([school], { root: archive })).opportunities
              ?.length
          ) {
            resolveAnalyzed();
            return;
          }
          await Bun.sleep(5);
        }
      }, 0);
      return schema.parse({ ...draft, publishRecommended: false });
    }
    throw new Error("Unexpected agent prompt");
  };
  const controller = new AbortController();
  const resultPromise = runPipeline({
    root: archive,
    pipelineRoot: laneRoot,
    schools: [school],
    agent,
    runtimeMs: 1500,
    pollMs: 10,
    signal: controller.signal,
    downloader: async (url) => {
      setTimeout(async () => {
        for (let i = 0; i < 100; i++) {
          const latest = await loadIntake([school], { root: archive });
          if (
            latest.candidates.find((x) => x.url.endsWith("/new"))?.status ===
            "downloaded"
          ) {
            resolveCollected();
            return;
          }
          await Bun.sleep(5);
        }
      }, 0);
      return {
        bytes: Buffer.from("<html><body>Measures grid faults.</body></html>"),
        finalUrl: url,
        contentType: "text/html",
      };
    },
  });
  const result = await resultPromise;
  expect(blocked).toBe(true);
  expect(released).toBe(true);
  expect(result.state.items.some((x) => x.title === "Extracted")).toBe(true);
  for (const lane of ["collect", "classify", "group", "analyze"] as const)
    expect(result.status.lanes[lane].checkpoints).toBeGreaterThan(0);
  expect(
    result.state.candidates.every((candidate) =>
      candidate.revisions.every((revision) => revision.rawPath.startsWith("/")),
    ),
  ).toBe(true);
  await expect(access(join(archive, "writer.lock"))).rejects.toThrow();
}, 5000);

test("existing lock is never replaced; runtime exit releases only the coordinator lock", async () => {
  const root = await temporary();
  const pipelineRoot = join(root, "pipeline");
  await writeFile(join(root, "writer.lock"), "another-writer");
  await expect(
    runPipeline({ root, pipelineRoot, schools: [school], runtimeMs: 30 }),
  ).rejects.toThrow("writer already active");
  expect(await readFile(join(root, "writer.lock"), "utf8")).toBe(
    "another-writer",
  );
  await rm(join(root, "writer.lock"));
  const result = await runPipeline({
    root,
    pipelineRoot,
    schools: [school],
    runtimeMs: 40,
    pollMs: 10,
    runners: { collect: async () => {} },
  });
  expect(result.status.reason).toBe("runtime");
  await expect(access(join(root, "writer.lock"))).rejects.toThrow();
});

test("stop file drains an active lane checkpoint before releasing canonical writer lock", async () => {
  const root = await temporary();
  const pipelineRoot = join(root, "pipeline");
  let lockObserved = false;
  const result = await runPipeline({
    root,
    pipelineRoot,
    schools: [school],
    runtimeMs: 1000,
    pollMs: 10,
    runners: {
      collect: async (snapshot, _schools, options) => {
        await writeFile(join(pipelineRoot, "stop"), "stop");
        await Bun.sleep(40);
        lockObserved =
          (await readFile(join(root, "writer.lock"), "utf8")) ===
          String(process.pid);
        snapshot.cells.forEach((cell) => {
          cell.status = "done";
        });
        await checkpoint(snapshot, options);
      },
    },
  });
  expect(lockObserved).toBe(true);
  expect(result.status.reason).toBe("stop-file");
  expect(
    (await loadIntake([school], { root })).cells.every(
      (cell) => cell.status === "done",
    ),
  ).toBe(true);
  await expect(access(join(root, "writer.lock"))).rejects.toThrow();
});

test("library pipeline calls cannot implicitly mirror fixtures using operator credentials", async () => {
  const root = await temporary();
  const previous = {
    url: process.env.CONVEX_URL,
    secret: process.env.RESEARCH_WRITE_SECRET,
  };
  process.env.CONVEX_URL = "https://example.invalid";
  process.env.RESEARCH_WRITE_SECRET = "test-fixture-capability";
  try {
    const result = await runPipeline({
      root,
      pipelineRoot: join(root, "pipeline"),
      schools: [],
      runtimeMs: 100,
      pollMs: 10,
    });
    expect(result.status.mirror.enabled).toBe(false);
    expect(result.status.reason).toBe("drained");
  } finally {
    if (previous.url === undefined) delete process.env.CONVEX_URL;
    else process.env.CONVEX_URL = previous.url;
    if (previous.secret === undefined) delete process.env.RESEARCH_WRITE_SECRET;
    else process.env.RESEARCH_WRITE_SECRET = previous.secret;
  }
});
