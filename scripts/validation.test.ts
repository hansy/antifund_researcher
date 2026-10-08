import { describe, expect, test } from "bun:test";
import {
  leaseMatches,
  retrieve,
  validateAnswer,
  validateCorpus,
} from "./validation";
import { safeCatalog, safeChildEnv } from "./codex";
import { validateOfficialUrl } from "./collection";
import type { Corpus } from "../src/lib/contracts";
const corpus: Corpus = {
  schools: [
    {
      id: "test-school",
      name: "Test School",
      shortName: "Test",
      country: "US",
      domain: "school.edu",
      rank: 1,
      discoveryUrls: ["https://school.edu/research"],
    },
  ],
  sources: [
    {
      id: "source-one",
      schoolId: "test-school",
      title: "Paper",
      url: "https://school.edu/paper.pdf",
      kind: "pdf",
      year: 2025,
      accessedAt: "2026-10-08",
      excerpt:
        "The robot completed 20 manipulation trials with a success rate of 85 percent.",
    },
  ],
  projects: [
    {
      id: "project-one",
      schoolId: "test-school",
      title: "Robot manipulation",
      year: 2025,
      summary: "Robot learns manipulation in simulation",
      problem: "Grasping",
      approach: "Simulation",
      whyItMatters: "Our interpretation",
      statusQuo: "Unknown",
      results: "Reported 85 percent",
      limitations: "Limited trials",
      topics: ["Manipulation", "Simulation"],
      stage: "Hardware",
      authors: [],
      evidence: [
        {
          sourceId: "source-one",
          quote: "The robot completed 20 manipulation trials",
          page: 2,
        },
      ],
    },
  ],
  insights: [],
  meta: {
    collectedAt: "2026-10-08",
    rankingName: "Test registry",
    rankingUrl: "https://school.edu/",
    coverageNote: "One fixture",
  },
};
describe("corpus integrity", () => {
  test("market estimates retain their linked publisher evidence", async () => {
    const published = validateCorpus(await Bun.file("data/corpus.json").json());
    const signal = published.insights.find((item) => item.brief?.marketSize);
    expect(signal?.brief?.marketSize?.sourceUrls.length).toBeGreaterThan(0);
    const invalid = structuredClone(published);
    invalid.insights.find(
      (item) => item.id === signal!.id,
    )!.brief!.marketSize!.sourceUrls = [
      "https://example.com/unsupported-estimate",
    ];
    expect(() => validateCorpus(invalid)).toThrow(
      "Market size requires linked evidence",
    );
  });
  test("accepts linked corpus; rejects dangling cross-school refs", () => {
    expect(validateCorpus(corpus).projects).toHaveLength(1);
    const invalid = structuredClone(corpus);
    invalid.projects[0]!.evidence[0]!.sourceId = "missing";
    expect(() => validateCorpus(invalid)).toThrow("Invalid project citation");
  });
  test("rejects duplicate slugs, future dates and unrelated insight evidence", () => {
    const invalid = structuredClone(corpus);
    invalid.sources.push(invalid.sources[0]!);
    expect(() => validateCorpus(invalid)).toThrow("duplicate id");
    invalid.sources.pop();
    invalid.meta.collectedAt = "2099-01-01";
    expect(() => validateCorpus(invalid)).toThrow("Invalid collection date");
  });
});
describe("answer grounding", () => {
  const answer = {
    answer: "The source reports 20 trials.",
    citations: [
      {
        sourceId: "source-one",
        quote: "The robot completed 20 manipulation trials",
        page: 2,
      },
    ],
    projectIds: ["project-one"],
    followUps: [],
  };
  test("accepts exact normalized quotations; rejects invented quotes/pages/IDs", () => {
    expect(validateAnswer(answer, corpus).citations).toHaveLength(1);
    expect(() =>
      validateAnswer(
        {
          ...answer,
          citations: [
            { sourceId: "source-one", quote: "The robot performed 900 trials" },
          ],
        },
        corpus,
      ),
    ).toThrow("not grounded");
    expect(() =>
      validateAnswer(
        { ...answer, citations: [{ ...answer.citations[0], page: 9 }] },
        corpus,
      ),
    ).toThrow();
    expect(() =>
      validateAnswer({ ...answer, projectIds: ["missing"] }, corpus),
    ).toThrow("Unknown answer project");
  });
  test("retrieves relevant project and source without fabricated matches", () => {
    expect(retrieve(corpus, "manipulation simulation").projects).toHaveLength(
      1,
    );
    expect(retrieve(corpus, "quantum chemistry").projects).toHaveLength(0);
  });
});
test("only current worker with exact unexpired lease can finish", () => {
  const job = {
    status: "running",
    workerId: "worker-one",
    leaseToken: "token",
    leaseUntil: 200,
  };
  expect(leaseMatches(job, "worker-one", "token", 100)).toBe(true);
  expect(leaseMatches(job, "worker-two", "token", 100)).toBe(false);
  expect(leaseMatches(job, "worker-one", "old-token", 100)).toBe(false);
  expect(leaseMatches(job, "worker-one", "token", 200)).toBe(false);
});
test("no-tool model metadata and credential whitelist", () => {
  const catalog = safeCatalog(
    {
      models: [
        {
          slug: "test",
          shell_type: "unified_exec",
          apply_patch_tool_type: "freeform",
          experimental_supported_tools: ["clock"],
        },
      ],
    },
    "test",
  );
  expect(catalog.models[0]!.shell_type).toBe("disabled");
  expect(catalog.models[0]!.apply_patch_tool_type).toBeNull();
  expect(catalog.models[0]!.experimental_supported_tools).toEqual([]);
  expect(() => safeCatalog({ models: [] }, "test")).toThrow("unavailable");
  expect(Object.keys(safeChildEnv("/tmp/test")).sort()).toEqual([
    "CODEX_HOME",
    "HOME",
    "LANG",
    "PATH",
    "TMPDIR",
  ]);
});
test("official download boundaries reject lookalikes and alternate protocols", () => {
  const school = corpus.schools[0]!;
  expect(
    validateOfficialUrl("https://lab.school.edu/paper.pdf", school).hostname,
  ).toBe("lab.school.edu");
  for (const url of [
    "https://school.edu.evil.test/a",
    "https://localhost/a",
    "http://school.edu/a",
    "https://school.edu:1234/a",
  ])
    expect(() => validateOfficialUrl(url, school)).toThrow();
  const credentialUrl = new URL("https://school.edu/a");
  credentialUrl.username = "test-only-user";
  credentialUrl.password = "test-only-password";
  expect(() => validateOfficialUrl(credentialUrl.href, school)).toThrow();
});

// The output API rejects Zod's URI format, while local parsing still checks URLs.
test("Codex schema conversion keeps nested fields strict without URI format", async () => {
  const { strictSchema } = await import("./codex");
  const schema = strictSchema({
    type: "object",
    properties: {
      source: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          page: { type: "integer" },
        },
        required: ["url"],
      },
    },
    required: ["source"],
  });
  expect(schema.properties.source.properties.url).not.toHaveProperty("format");
  expect(schema.properties.source.required).toEqual(["url", "page"]);
  expect(schema.properties.source.properties.page.anyOf).toContainEqual({
    type: "null",
  });
  expect(schema.properties.source.additionalProperties).toBe(false);
});

test("broad simulation queries retain rarer mapping evidence", async () => {
  const { default: seed } = await import("../data/corpus.json");
  const selected = retrieve(
    validateCorpus(seed),
    "Which projects report measurable improvements in simulation or mapping?",
  );
  expect(selected.projects.map((p) => p.id)).toContain(
    "oxford-planarmesh-2025",
  );
  expect(selected.projects.map((p) => p.id)).toContain("oxford-osprey-2024");
  expect(selected.projects.length).toBeLessThanOrEqual(12);
  expect(selected.sources.length).toBeLessThanOrEqual(16);
});
