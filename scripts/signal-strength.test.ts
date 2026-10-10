import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assessSignal,
  identityUnits,
  type AssessmentDraft,
  type VerifiedMarketFact,
} from "./signal-strength";
import {
  assessSignalsMain,
  verifyAssessmentInput,
  verifyMarketFacts,
} from "./assess-signals";
import { emptyState } from "./intake/model";
import type { Item, Opportunity } from "./intake/model";
const items = ["a", "b", "c"].map(
  (id, index) =>
    ({
      id,
      candidateId: id,
      title: `Project ${id}`,
      authors: [`Person ${id}`],
      date: `202${5 + (index % 2)}`,
      dateStatus: "verified",
      timeframe: "in-window",
      evidence: [
        {
          quote: "Measured behavior",
          sourceUrl: `https://example.com/${id}`,
          page: 2,
        },
      ],
    }) as Item,
);
const opportunity = {
  id: "signal",
  title: "Candidate pattern",
  summary: "A provisional interpretation.",
} as Opportunity;
function draft(): AssessmentDraft {
  return {
    opportunityId: "signal",
    pattern: "A recurring change",
    whyItMatters: "It reduces a constraint.",
    units: items.map((item) => ({
      itemIds: [item.id],
      independence: "confirmed",
      reason: "Distinct named team",
    })),
    observations: items.flatMap((item) =>
      ["measurement", "change", "pull"].map(
        (kind) =>
          ({
            itemId: item.id,
            evidenceIndex: 0,
            kind,
            interpretation: "Team-reported; methods limited.",
          }) as AssessmentDraft["observations"][number],
      ),
    ),
    confidence: "High",
    confidenceReason: "Methods and identities supported.",
    momentum: {
      supported: false,
      itemIds: [],
      explanation: "Dates alone do not establish acceleration.",
    },
    robustness: {
      survives: true,
      removedItemId: "a",
      explanation: "Two other evaluated projects remain.",
    },
    market: {
      support: "Unknown",
      links: [],
      explanation: "Unknown",
      missing: ["Buyer value"],
    },
    wouldWeaken: ["Failed replication"],
    nextEvidence: ["Independent deployment"],
  };
}
test("market support cannot raise technical strength and unknown dates cap confidence", () => {
  expect(assessSignal(draft(), opportunity, items, []).strength).toBe("Strong");
  const unknownDates = items.map((item) => ({
    ...item,
    date: null,
    dateStatus: "unverified" as const,
  }));
  const result = assessSignal(draft(), opportunity, unknownDates, []);
  expect(result.strength).toBe("Building");
  expect(result.confidence).toBe("Medium");
  const fact = { id: "large-market" } as VerifiedMarketFact;
  const value = draft();
  value.observations = [];
  value.market = {
    support: "Supportive",
    links: [
      {
        factId: fact.id,
        relevance: "proxy",
        interpretation: "Large broad industry",
      },
    ],
    explanation: "Context only",
    missing: [],
  };
  expect(assessSignal(value, opportunity, items, [fact]).strength).toBe(
    "Emerging",
  );
});
test("duplicate pages and overlapping teams cannot manufacture independence", () => {
  const duplicate = [
    { ...items[0]! },
    { ...items[1]!, title: items[0]!.title },
    items[2]!,
  ];
  expect(identityUnits(duplicate)).toHaveLength(2);
  expect(() => assessSignal(draft(), opportunity, duplicate, [])).toThrow(
    "Duplicate",
  );
  const overlapping = items.map((item, index) =>
    index === 1 ? { ...item, authors: items[0]!.authors } : item,
  );
  expect(() => assessSignal(draft(), opportunity, overlapping, [])).toThrow(
    "overlapping",
  );
});
test("no unsupported evidence, missing records, unknown market facts or undated momentum", () => {
  const value = draft();
  value.observations[0]!.evidenceIndex = 99;
  expect(() => assessSignal(value, opportunity, items, [])).toThrow(
    "retained evidence",
  );
  const missing = draft();
  missing.units.pop();
  expect(() => assessSignal(missing, opportunity, items, [])).toThrow(
    "partition",
  );
  const market = draft();
  market.market.links = [
    { factId: "invented", relevance: "direct", interpretation: "Claim" },
  ];
  expect(() => assessSignal(market, opportunity, items, [])).toThrow(
    "unverified market",
  );
  const momentum = draft();
  momentum.momentum = {
    supported: true,
    itemIds: ["a", "b"],
    explanation: "Growing",
  };
  expect(() =>
    assessSignal(
      momentum,
      opportunity,
      items.map((item) => ({ ...item, dateStatus: "unverified" })),
      [],
    ),
  ).toThrow("verified dates");
});
test("Strong fails when the best project carries the demonstrated change", () => {
  const value = draft();
  value.observations = value.observations.filter(
    (o) => o.itemId === "a" || o.kind === "pull",
  );
  const result = assessSignal(value, opportunity, items, []);
  expect(result.strength).toBe("Emerging");
  expect(result.robustness.survives).toBe(false);
});

test("the private pass resumes checkpoints, retains failed notes, and never mutates its input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "signal-pass-"));
  try {
    const state = emptyState([]);
    state.items = items.map((item) => ({
      ...item,
      evidence: [
        {
          quote: "Measured behavior",
          sourceUrl: `https://example.com/${item.id}`,
        },
      ],
    }));
    const textPath = join(directory, "source.txt");
    await writeFile(textPath, "Measured behavior");
    state.candidates = items.map((item) => ({
      id: item.candidateId,
      revisions: [
        {
          hash: item.revisionHash,
          textPath,
          finalUrl: `https://example.com/${item.id}`,
        },
      ],
    })) as typeof state.candidates;
    state.opportunities = [
      { ...opportunity, evidenceItemIds: ["a", "b"] },
      { ...opportunity, id: "lead", evidenceItemIds: ["c"] },
    ];
    const input = join(directory, "state.json"),
      output = join(directory, "output");
    const original = JSON.stringify(state);
    await writeFile(input, original);
    const catalog = JSON.parse(
      await readFile("data/market-context.json", "utf8"),
    );
    const downloader = async (url: string) => ({
      bytes: Buffer.from(
        `<p>${catalog.map((fact: { excerpt: string }) => fact.excerpt).join("</p><p>")}</p>`,
      ),
      finalUrl: url,
      contentType: "text/html",
    });
    const args = ["--input", input, "--output", output, "--budget", "1"];
    await assessSignalsMain(
      args,
      async () => {
        throw new Error("Transient model failure");
      },
      downloader,
    );
    const partial = JSON.parse(
      await readFile(join(output, "assessments.json"), "utf8"),
    );
    expect(partial.singleProjectBaselines).toBe(1);
    expect(partial.recurringPatternAssessments).toBe(0);
    expect(partial.failures[0].message).toBe("Transient model failure");
    let calls = 0;
    await assessSignalsMain(
      args,
      async (_prompt, schema) => {
        calls++;
        const value = draft();
        value.units.pop();
        value.observations = value.observations.filter((o) => o.itemId !== "c");
        return schema.parse({ assessments: [value] });
      },
      downloader,
    );
    await assessSignalsMain(
      args,
      async () => {
        throw new Error("Cache should avoid model calls");
      },
      downloader,
    );
    expect(calls).toBe(1);
    const completed = JSON.parse(
      await readFile(join(output, "assessments.json"), "utf8"),
    );
    expect(completed.assessedNotes).toBe(2);
    expect(completed.publicationAuthorized).toBe(false);
    expect(completed.failures).toEqual([]);
    expect(await readFile(input, "utf8")).toBe(original);
    expect(await readFile(join(output, "signals.md"), "utf8")).toContain(
      "1 recurring candidates assessed",
    );
    state.items[0]!.evidence[0]!.quote = "Invented quotation";
    expect(verifyAssessmentInput(state)).rejects.toThrow("mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("market facts retain bytes and provenance, verify cached bytes, reject snippets and quotation overflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "signal-market-"));
  try {
    const fact = {
      id: "fact",
      title: "Primary report",
      url: "https://example.com/report",
      excerpt: "Reported growth was 9%",
      publishedAt: "2026-01-01",
      period: "2025",
      geography: "Global",
      segment: "Robot stock",
      kind: "growth" as const,
      basis: "reported" as const,
      finding: "Reported growth",
      limitation: "Not revenue",
    };
    let calls = 0;
    const downloader = async () => {
      calls++;
      return {
        bytes: Buffer.from("<p>Reported growth was 9%</p>"),
        finalUrl: fact.url,
        contentType: "text/html",
      };
    };
    const verified = await verifyMarketFacts([fact], directory, downloader);
    expect(verified[0]!.contentHash).toHaveLength(64);
    expect(
      await readFile(
        join(directory, `${verified[0]!.contentHash}.html`),
        "utf8",
      ),
    ).toContain("9%");
    await verifyMarketFacts([fact], directory, downloader);
    expect(calls).toBe(1);
    expect(
      verifyMarketFacts(
        [{ ...fact, excerpt: "Invented quote" }],
        directory,
        downloader,
      ),
    ).rejects.toThrow("mismatch");
    expect(
      verifyMarketFacts(
        [{ ...fact, excerpt: Array(26).fill("word").join(" ") }],
        directory,
        downloader,
      ),
    ).rejects.toThrow("budget");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
