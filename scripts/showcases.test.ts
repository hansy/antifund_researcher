import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyState,
  preserveCandidate,
  collect,
  loadIntake,
  checkpoint,
  enrichItem,
  type Item,
} from "./intake";
import { classifyShowcases, scopeSchema } from "./showcases";
import { runCodex } from "./codex";
import { runPipeline } from "./pipeline";
const school = {
  id: "school",
  name: "School",
  domain: "example.edu",
  discoveryUrls: [],
};
const provenance = {
  schoolId: "school",
  category: "capstone" as const,
  year: 2025,
  title: "2025 Showcase",
  discoveredAt: "2026-10-09",
};
test("a full abstract enriches a table-of-contents record without losing evidence", () => {
  const first = {
    problem: "Unknown",
    approach: "Unknown",
    domain: "Unknown",
    embodiment: "unknown",
    readiness: "unknown",
    reportedResults: "Not reported",
    interpretation: "Title only",
    unansweredQuestions: ["Performance unknown"],
    classificationStatus: "ambiguous",
    evidence: [{ quote: "LiftAssist", sourceUrl: "https://example.edu" }],
  } as Item;
  const full = {
    ...first,
    problem: "Caregivers need help repositioning patients in bed.",
    approach: "A retrofit lifts and turns the mattress.",
    reportedResults: "Prototype described; clinical outcomes unreported.",
    classificationStatus: "classified",
  } as Item;
  enrichItem(first, full);
  expect(first.problem).toBe(full.problem);
  expect(first.classificationStatus).toBe("classified");
  enrichItem(first, {
    ...full,
    problem: "Unknown",
    approach: "Unknown",
    reportedResults: "Not reported",
  });
  expect(first.problem).toBe(full.problem);
  expect(first.evidence).toHaveLength(1);
});
test("focused collection retains navigation links but never downloads them", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcases-test-"));
  try {
    const state = emptyState([school]);
    const chosen = preserveCandidate(
      state,
      "https://example.edu/2025/showcase",
      provenance,
    );
    const calls: string[] = [];
    await collect(state, [school], {
      root,
      maxDepth: 5,
      budget: 20,
      candidateIds: [chosen.id],
      downloader: async (url) => {
        calls.push(url);
        return {
          bytes: Buffer.from(
            '<h1>2025 Projects</h1><a href="/publications">All research</a>',
          ),
          finalUrl: url,
          contentType: "text/html",
        };
      },
    });
    expect(calls).toEqual([chosen.url]);
    expect(state.candidates.some((c) => c.url.endsWith("/publications"))).toBe(
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("three independent source classifications overlap and retain each checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcases-test-"));
  try {
    const state = emptyState([school]);
    state.cells = [];
    for (let i = 0; i < 3; i++) {
      const c = preserveCandidate(
        state,
        `https://example.edu/2025/${i}`,
        provenance,
      );
      c.status = "downloaded";
      const path = join(root, `${i}.txt`);
      await writeFile(path, `2025 Showcase project ${i}`);
      c.revisions.push({
        hash: `rev${i}`,
        requestedUrl: c.url,
        finalUrl: c.url,
        accessedAt: "2026-10-09",
        kind: "html",
        rawPath: path,
        textPath: path,
        parseStatus: "done",
      });
    }
    let active = 0,
      peak = 0;
    const agent: typeof runCodex = async (_prompt, schema) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return schema.parse({ items: [], ambiguity: "No identifiable project" });
    };
    await classifyShowcases(state, [school], {
      root,
      candidateIds: state.candidates.map((c) => c.id),
      agent,
    });
    expect(peak).toBe(3);
    expect(
      Object.values(state.classification).filter((p) => p.done),
    ).toHaveLength(3);
    const saved = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    expect(Object.keys(saved.classification)).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("focused pipeline ignores deferred candidates and holds synthesis while selected sources are incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcases-test-"));
  try {
    const state = await loadIntake([school], { root, discovery: false });
    expect(state.cells).toHaveLength(0);
    const selected = preserveCandidate(
      state,
      "https://example.edu/2025/selected",
      provenance,
    );
    preserveCandidate(state, "https://example.edu/research", provenance);
    await checkpoint(state, { root });
    let analysis = 0;
    const result = await runPipeline({
      root,
      pipelineRoot: join(root, "pipeline"),
      schools: [school],
      candidateIds: [selected.id],
      discovery: false,
      deferAnalysisUntilClassified: true,
      runtimeMs: 50,
      pollMs: 10,
      runners: {
        collect: async () => {},
        group: async () => {
          analysis++;
        },
        analyze: async () => {
          analysis++;
        },
      },
    });
    expect(analysis).toBe(0);
    expect(result.state.candidates).toHaveLength(2);
    expect(result.state.cells).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("showcase scope includes 2026 and permits full galleries without a two-source cap", async () => {
  const scope = scopeSchema.parse(
    JSON.parse(await readFile("data/showcase-scope.json", "utf8")),
  );
  expect(scope.years).toEqual([2025, 2026]);
  expect(scope.sources.some((source) => source.year === 2026)).toBe(true);
  expect(
    scopeSchema.safeParse({
      ...scope,
      sources: [
        ...scope.sources,
        {
          ...scope.sources[0],
          url: "https://coe.gatech.edu/2026/third-gallery",
          year: 2026,
        },
        {
          ...scope.sources[0],
          url: "https://coe.gatech.edu/2026/fourth-gallery",
          year: 2026,
        },
      ],
    }).success,
  ).toBe(true);
  expect(
    scopeSchema.safeParse({
      ...scope,
      sources: [...scope.sources, scope.sources[0]],
    }).success,
  ).toBe(false);
});
