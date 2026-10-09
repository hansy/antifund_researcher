import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, preserveCandidate, type Item } from "./intake/model";
import { type runCodex } from "./codex";
import {
  analyzeShowcaseCollection,
  showcaseContext,
} from "./showcase-analysis";

async function fixture(count = 1) {
  const root = await mkdtemp(join(tmpdir(), "showcase-analysis-"));
  const state = emptyState([]);
  const candidate = preserveCandidate(state, "https://example.edu/2025", {
    schoolId: "school",
    category: "capstone",
    year: 2025,
    discoveredAt: "2026-10-09",
    title: "Showcase",
  });
  const text =
    "[PDF PAGE 1]\nProjects\n[PDF PAGE 2]\nA robot detects cracks.\n";
  const textPath = join(root, "source.txt");
  await writeFile(textPath, text);
  candidate.status = "downloaded";
  candidate.revisions.push({
    hash: "revision",
    requestedUrl: candidate.url,
    finalUrl: candidate.url,
    accessedAt: "2026-10-09",
    kind: "pdf",
    rawPath: textPath,
    textPath,
    parseStatus: "done",
  });
  state.classification[`${candidate.id}:revision`] = {
    nextChunk: 1,
    done: true,
    failures: [],
  };
  state.items = Array.from({ length: count }, (_, index): Item => ({
    id: `record-${index.toString().padStart(2, "0")}`,
    candidateId: candidate.id,
    revisionHash: "revision",
    title: `Project ${index}`,
    schoolIds: ["school"],
    category: "ambiguous",
    domain: "unknown",
    problem: "unknown",
    approach: "unknown",
    keywords: [],
    embodiment: "unknown",
    readiness: "unknown",
    date: null,
    dateStatus: "unverified",
    timeframe: "unknown",
    evidence: [
      { quote: "A robot detects cracks.", page: 2, sourceUrl: candidate.url },
    ],
    reportedResults: "Not reported",
    interpretation: "Unknown",
    unansweredQuestions: [],
    classificationStatus: "ambiguous",
  }));
  return {
    root,
    state,
    candidate,
    text,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
function response(ids: string[]) {
  return {
    items: ids.map((id) => ({
      id,
      identity: "Robot",
      disposition: "project",
      roboticsSimulationRelevance: "direct",
      conciseDescription: "Crack detection robot",
      problem: "Inspection",
      targetCustomers: ["Operators"],
      applicability: "Pipes",
      reportedResults: "Prototype described",
      possibleImprovement: "Unverified reduction in review",
      commercialInterpretation: "Needs field testing",
      unknowns: ["Recall"],
      claims: [
        { claim: "Detects cracks", quote: "A robot detects cracks.", page: 2 },
      ],
    })),
  };
}
function agentWith(
  transform: (output: ReturnType<typeof response>) => unknown = (x) => x,
): typeof runCodex {
  return async (prompt, schema) => {
    const input = JSON.parse(prompt.split("INPUT_RECORDS_JSON:\n")[1]!);
    return schema.parse(
      transform(response(input.map((x: { item: Item }) => x.item.id))),
    );
  };
}
test("analyzes every ambiguous unknown-date item without changing raw state and reuses checkpoints", async () => {
  const f = await fixture(8);
  try {
    const original = JSON.stringify(f.state);
    let calls = 0;
    const base = agentWith();
    const agent: typeof runCodex = async (...args) => {
      calls++;
      return base(...args);
    };
    const first = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent,
    });
    expect(first.records).toHaveLength(8);
    expect(first.completeForSnapshot).toBe(true);
    expect(JSON.stringify(f.state)).toBe(original);
    const second = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent,
    });
    expect(calls).toBe(2);
    expect(second.metrics.reusedBatches).toBe(2);
    await writeFile(
      f.candidate.revisions[0]!.textPath!,
      f.text + "New source context",
    );
    const third = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent,
    });
    expect(calls).toBe(4);
    expect(third.snapshotFingerprint).not.toBe(first.snapshotFingerprint);
  } finally {
    await f.cleanup();
  }
});
test.each(["missing", "duplicate", "foreign", "bad quote", "wrong page"])(
  "rejects %s outputs and leaves an incomplete failure ledger",
  async (mode) => {
    const f = await fixture(2);
    try {
      const agent = agentWith((output) => {
        if (mode === "missing") output.items.pop();
        if (mode === "duplicate") output.items[1]!.id = output.items[0]!.id;
        if (mode === "foreign") output.items[0]!.id = "foreign";
        if (mode === "bad quote")
          output.items[0]!.claims[0]!.quote = "Fabricated performance";
        if (mode === "wrong page") output.items[0]!.claims[0]!.page = 1;
        return output;
      });
      await expect(
        analyzeShowcaseCollection(f.state, [f.candidate.id], {
          root: f.root,
          agent,
        }),
      ).rejects.toThrow();
      const ledger = JSON.parse(
        await readFile(join(f.root, "review-ledger.json"), "utf8"),
      );
      expect(ledger.completeForSnapshot).toBe(false);
      expect(ledger.pendingRecordIds).toHaveLength(2);
      expect(ledger.error).toBeString();
    } finally {
      await f.cleanup();
    }
  },
);
test("includes TOC and later full abstract source context", async () => {
  const f = await fixture();
  try {
    f.state.items[0]!.title = "Project Atlas";
    const text =
      "Project Atlas\n" +
      "filler ".repeat(2500) +
      "Project Atlas\nA robot detects cracks. Full abstract has navigation details.\n" +
      "filler ".repeat(2500);
    const context = showcaseContext(f.state.items[0]!, text);
    expect(context).toContain("Full abstract has navigation details.");
    expect(context.match(/Project Atlas/g)).toHaveLength(2);
    expect(context.length).toBeLessThanOrEqual(10000);
  } finally {
    await f.cleanup();
  }
});
test("runs at most three independent model calls concurrently and keeps unresolved records", async () => {
  const f = await fixture(25);
  try {
    let active = 0,
      peak = 0;
    const base = agentWith((output) => {
      for (const item of output.items) {
        item.disposition = "unresolved";
        item.claims = [];
      }
      return output;
    });
    const agent: typeof runCodex = async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      try {
        return await base(...args);
      } finally {
        active--;
      }
    };
    const ledger = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent,
    });
    expect(peak).toBe(3);
    expect(ledger.unresolvedCount).toBe(25);
    expect(ledger.completeForSnapshot).toBe(true);
  } finally {
    await f.cleanup();
  }
});
test("exact duplicate candidates remain raw records, while different years stay separate", async () => {
  const f = await fixture(3);
  try {
    for (const item of f.state.items) item.title = "Atlas";
    f.state.items[2]!.date = "2026";
    const ledger = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent: agentWith(),
    });
    expect(ledger.duplicateCandidateGroups).toHaveLength(1);
    expect(ledger.duplicateCandidateGroups[0]!.rawRecordIds).toHaveLength(2);
    expect(ledger.duplicateCandidateGroups[0]!.mergerAuthorized).toBe(false);
    expect(ledger.records).toHaveLength(3);
  } finally {
    await f.cleanup();
  }
});

test("missing retained source invalidates an older completed ledger and throws", async () => {
  const f = await fixture();
  try {
    await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent: agentWith(),
    });
    await rm(f.candidate.revisions[0]!.textPath!);
    await expect(
      analyzeShowcaseCollection(f.state, [f.candidate.id], {
        root: f.root,
        agent: agentWith(),
      }),
    ).rejects.toThrow();
    const ledger = JSON.parse(
      await readFile(join(f.root, "review-ledger.json"), "utf8"),
    );
    expect(ledger.completeForSnapshot).toBe(false);
  } finally {
    await f.cleanup();
  }
});
test("model failures are explicit and preserve successful batch checkpoints for resume", async () => {
  const f = await fixture(8);
  try {
    const base = agentWith();
    const failing: typeof runCodex = async (prompt, schema, options) => {
      if (prompt.includes('"id":"record-06"'))
        throw new Error("agent unavailable");
      return base(prompt, schema, options);
    };
    await expect(
      analyzeShowcaseCollection(f.state, [f.candidate.id], {
        root: f.root,
        agent: failing,
      }),
    ).rejects.toThrow("agent unavailable");
    const resumed = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent: base,
    });
    expect(resumed.metrics.reusedBatches).toBe(1);
    expect(resumed.records).toHaveLength(8);
  } finally {
    await f.cleanup();
  }
});

test("growing collections analyze only new records even when batch boundaries change", async () => {
  const f = await fixture(8);
  try {
    const base = agentWith();
    await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent: base,
    });
    f.state.items.unshift({
      ...structuredClone(f.state.items[0]!),
      id: "record-00-new",
      title: "New project",
    });
    const seen: string[] = [];
    const agent: typeof runCodex = async (prompt, schema, options) => {
      const input = JSON.parse(prompt.split("INPUT_RECORDS_JSON:\n")[1]!);
      seen.push(...input.map((x: { item: Item }) => x.item.id));
      return base(prompt, schema, options);
    };
    const ledger = await analyzeShowcaseCollection(f.state, [f.candidate.id], {
      root: f.root,
      agent,
    });
    expect(seen).toEqual(["record-00-new"]);
    expect(ledger.records).toHaveLength(9);
    expect(ledger.completeForSnapshot).toBe(true);
  } finally {
    await f.cleanup();
  }
});
