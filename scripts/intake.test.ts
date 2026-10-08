import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "./codex";
import {
  emptyState,
  preserveCandidate,
  collect,
  classify,
  scanSchool,
  buildGraph,
  safeUrl,
  publicAddress,
  pageLinks,
  intakeStatus,
  evidencePresent,
  loadIntake,
  dateWindow,
  type Item,
  type IntakeOptions,
} from "./intake";
const school = {
  id: "school",
  name: "Test University",
  domain: "example.edu",
  discoveryUrls: ["https://example.edu/"],
};
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function options(extra: IntakeOptions = {}): Promise<IntakeOptions> {
  const root = await mkdtemp(join(tmpdir(), "intake-test-"));
  roots.push(root);
  return { root, ...extra };
}
function seed() {
  const state = emptyState([school]);
  preserveCandidate(state, "https://example.edu/showcase", {
    schoolId: school.id,
    category: "capstone",
    year: 2026,
    title: "Design showcase",
    discoveredAt: "2026-10-08",
  });
  return state;
}
function fakeAgent(output: unknown): typeof runCodex {
  return (async (
    _prompt: string,
    schema: { parse: (value: unknown) => unknown },
  ) => schema.parse(output)) as typeof runCodex;
}
const html = (body: string) => async () => ({
  bytes: Buffer.from(body),
  finalUrl: "https://example.edu/showcase",
  contentType: "text/html",
});
describe("preservation-first intake", () => {
  test("all six year/category cells retained before discovery failure, without false completion", async () => {
    const state = emptyState([school]);
    const opts = await options({
      budget: 1,
      agent: (async () => {
        throw new Error("Subscription unavailable");
      }) as typeof runCodex,
    });
    await scanSchool(state, school, opts);
    expect(state.cells).toHaveLength(6);
    expect(state.cells.filter((c) => c.status === "failed")).toHaveLength(1);
    expect(state.candidates[0]!.provenance).toHaveLength(6);
    expect(intakeStatus(state).discovery.searchedCells).toBe(0);
    expect(state.cells[0]!.failures[0]!.retryAfter).toBeTruthy();
  });
  test("failed downloads preserve candidate and resumable retry metadata on disk", async () => {
    const state = seed();
    const opts = await options({
      downloader: async () => {
        throw new Error("HTTP 503");
      },
    });
    await collect(state, [school], opts);
    const loaded = await loadIntake([school], opts);
    expect(loaded.candidates).toHaveLength(1);
    expect(loaded.candidates[0]!.status).toBe("failed");
    expect(loaded.candidates[0]!.failures[0]!.stage).toBe("collect");
    expect(loaded.candidates[0]!.failures[0]!.retryAfter).toBeTruthy();
  });
  test("unknown-date nonrobotic software is preserved and classified", async () => {
    const state = seed();
    const opts = await options({
      downloader: html(
        "<h1>Literature Atlas</h1><p>Software maps historical fiction across languages.</p>",
      ),
    });
    await collect(state, [school], opts);
    opts.agent = fakeAgent({
      items: [
        {
          title: "Literature Atlas",
          category: "capstone",
          domain: "Digital humanities",
          problem: "Comparative literature",
          approach: "Text mapping",
          keywords: ["literature", "translation"],
          embodiment: "software",
          readiness: "Prototype",
          date: null,
          dateEvidence: null,
          evidence: [
            {
              quote: "Software maps historical fiction across languages.",
              page: null,
            },
          ],
          reportedResults: "Not reported",
          interpretation: "May support comparative research",
          unansweredQuestions: ["How accurate are mappings?"],
          classificationStatus: "classified",
        },
      ],
      ambiguity: "",
    });
    await classify(state, opts);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.domain).toBe("Digital humanities");
    expect(state.items[0]!.dateStatus).toBe("unverified");
    expect(state.items[0]!.timeframe).toBe("unknown");
    expect(
      await readFile(state.candidates[0]!.revisions[0]!.textPath!, "utf8"),
    ).toContain("historical fiction");
  });
  test("PDF parser failures retain raw revision bytes before failure", async () => {
    const state = seed();
    const opts = await options({
      downloader: async () => ({
        bytes: Buffer.from("%PDF-this is intentionally broken"),
        finalUrl: "https://example.edu/showcase",
        contentType: "application/pdf",
      }),
    });
    await collect(state, [school], opts);
    const revision = state.candidates[0]!.revisions[0]!;
    expect(revision.parseStatus).toBe("failed");
    expect(await readFile(revision.rawPath, "utf8")).toBe(
      "%PDF-this is intentionally broken",
    );
    expect(
      (await loadIntake([school], opts)).candidates[0]!.revisions[0]!.hash,
    ).toBe(revision.hash);
  });
  test("URL dedup retains school associations and content revisions", async () => {
    const state = seed();
    const candidate = preserveCandidate(
      state,
      "https://example.edu/showcase?utm_source=x#top",
      {
        schoolId: "other",
        category: "research",
        year: 2025,
        title: "Shared source",
        discoveredAt: "2026-10-08",
      },
    );
    expect(state.candidates).toHaveLength(1);
    expect(candidate.provenance).toHaveLength(2);
    const opts = await options({ downloader: html("<p>first revision</p>") });
    await collect(state, [school], opts);
    opts.refresh = true;
    opts.downloader = html("<p>second revision</p>");
    await collect(state, [school], opts);
    await collect(state, [school], opts);
    expect(candidate.revisions).toHaveLength(2);
    expect(await readFile(candidate.revisions[0]!.rawPath, "utf8")).toContain(
      "first revision",
    );
  });
  test("pagination and verified official external gallery links survive depth budget", async () => {
    const state = seed();
    const opts = await options({
      budget: 1,
      downloader: html(
        '<a href="?page=2">Next</a><a href="https://event.devpost.com/project-gallery">Projects</a><a href="https://hackmit.org/projects">HackMIT projects</a>',
      ),
    });
    await collect(state, [school], opts);
    expect(state.candidates.some((c) => c.url.endsWith("?page=2"))).toBe(true);
    expect(
      state.candidates.find((c) => c.url.includes("devpost.com"))!.externalProof
        ?.officialUrl,
    ).toBe("https://example.edu/showcase");
    expect(state.candidates.some((c) => c.url.includes("hackmit.org"))).toBe(
      true,
    );
  });
  test("classification failure retains inspectable ambiguous item", async () => {
    const state = seed();
    const opts = await options({
      downloader: html("<p>Unclear submission, date unknown.</p>"),
    });
    await collect(state, [school], opts);
    opts.agent = (async () => {
      throw new Error("Classification interrupted");
    }) as typeof runCodex;
    await classify(state, opts);
    expect(state.items[0]!.classificationStatus).toBe("ambiguous");
    expect(state.items[0]!.date).toBeNull();
    expect(Object.values(state.classification)[0]!.done).toBe(false);
  });
});
describe("provenance and URL boundaries", () => {
  test("external showcase requires verified school proof; redirects/IP/private/credential ports rejected", () => {
    for (const url of [
      "http://example.edu",
      "https://example.edu.evil.test/",
      "https://127.0.0.1/",
      "https://example.edu:8443/",
      "https://event.devpost.com/project-gallery",
    ])
      expect(() => safeUrl(url, [school])).toThrow();
    const credentialUrl = new URL("https://example.edu/");
    credentialUrl.username = "test-user";
    credentialUrl.password = "dummy-password";
    expect(() => safeUrl(credentialUrl.href, [school])).toThrow();
    expect(
      safeUrl("https://event.devpost.com/", [school], {
        schoolId: school.id,
        officialUrl: "https://example.edu/event",
      }).hostname,
    ).toBe("event.devpost.com");
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.20.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "100.64.0.1",
      "::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
  test("exact PDF page provenance and date boundaries", () => {
    const text = "[PDF PAGE 1]\nfirst finding\n[PDF PAGE 2]\nsecond finding";
    expect(evidencePresent(text, "second finding", 2)).toBe(true);
    expect(evidencePresent(text, "second finding", 1)).toBe(false);
    expect(evidencePresent(text, "invented", 2)).toBe(false);
    expect(dateWindow(null, "2026-10-08")).toBe("unknown");
    expect(dateWindow("2026-10-09", "2026-10-08")).toBe("outside-window");
    expect(dateWindow("2025", "2026-10-08")).toBe("in-window");
  });
  test("link enumeration keeps pagination, project links, relative URLs and encoded query", () => {
    const links = pageLinks(
      '<a href="?page=2&amp;sort=date">next</a><a href="/software">software</a><a href="mailto:a@test">mail</a>',
      "https://example.edu/gallery",
    );
    expect(links.map((l) => l.url)).toEqual([
      "https://example.edu/gallery?page=2&sort=date",
      "https://example.edu/software",
    ]);
  });
});
test("inspectable clusters require specific shared keywords and keep isolated ambiguous projects", () => {
  const item = (id: string, keywords: string[], domain = "Biology") =>
    ({ id, candidateId: id, title: id, keywords, domain }) as Item;
  const { edges, clusters } = buildGraph([
    item("a", ["protein", "folding"]),
    item("b", ["protein", "folding"]),
    item("c", ["protein"]),
    item("d", [], "Unknown"),
  ]);
  expect(edges).toHaveLength(1);
  expect(edges[0]!.reasons).toContain("Shared keyword: folding");
  expect(clusters.find((c) => c.itemIds.includes("a"))!.itemIds).toEqual([
    "a",
    "b",
  ]);
  expect(clusters).toHaveLength(3);
});
