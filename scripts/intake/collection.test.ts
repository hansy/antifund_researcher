import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collect,
  emptyState,
  preserveCandidate,
  recordFailure,
  type School,
  type State,
} from "../intake";

const school: School = {
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
function add(state: State, path: string, title = "Research", owner = school) {
  return preserveCandidate(
    state,
    path.startsWith("https:") ? path : `https://${owner.domain}${path}`,
    {
      schoolId: owner.id,
      category: "research",
      year: 2026,
      title,
      discoveredAt: "2026-10-08",
    },
  );
}
async function run(
  state: State,
  budget: number,
  body = "<p>Full retained evidence.</p>",
  schools = [school],
  retry = false,
) {
  const root = await mkdtemp(join(tmpdir(), "collection-test-"));
  roots.push(root);
  const visited: string[] = [];
  await collect(state, schools, {
    root,
    budget,
    maxDepth: 1,
    retry,
    downloader: async (url) => {
      visited.push(url);
      return {
        bytes: Buffer.from(body),
        finalUrl: url,
        contentType: "text/html",
      };
    },
  });
  return visited;
}

test("current output details and pagination precede generic research navigation and old papers", async () => {
  const state = emptyState([school]);
  add(state, "/research");
  add(state, "/publications/old-paper-2019", "2019 paper");
  add(state, "/publications/new-paper-2025", "2025 paper");
  add(state, "/gallery?page=2", "2026 capstone gallery");
  const pdf = add(state, "/files/2026-project.pdf", "2026 project report");
  pdf.depth = 1;
  expect(await run(state, 3)).toEqual([
    pdf.url,
    "https://example.edu/publications/new-paper-2025",
    "https://example.edu/gallery?page=2",
  ]);
  expect(state.candidates).toHaveLength(5);
  expect(await readFile(pdf.revisions[0]!.rawPath, "utf8")).toBe(
    "<p>Full retained evidence.</p>",
  );
});

test("the search cell year alone does not make an undated research root current", async () => {
  const state = emptyState([school]);
  add(state, "/research", "Research");
  const detail = add(state, "/projects/solar-membrane", "Solar membrane");
  expect(await run(state, 1)).toEqual([detail.url]);
});

test("unresolved external discoveries retain failures without wasting retry attempts", async () => {
  const state = emptyState([school]);
  const external = add(
    state,
    "https://devpost.com/software/current-project",
    "2026 project",
  );
  external.status = "failed";
  external.attempts = 1;
  external.failures.push(
    recordFailure(
      "collect",
      new Error(
        "External showcase needs a preserved link from an official school source",
      ),
    ),
  );
  const proof = add(state, "/event", "Affiliation source for 2026 project");
  add(state, "/files/2026-project.pdf", "2026 project report");
  expect(await run(state, 1, "<p>Event page</p>", [school], true)).toEqual([
    proof.url,
  ]);
  expect(external.attempts).toBe(1);
  expect(external.failures).toHaveLength(1);
  expect(external.status).toBe("failed");
});

test("collecting an official affiliation link unlocks the external project with prior failure retained", async () => {
  const state = emptyState([school]);
  const external = add(
    state,
    "https://devpost.com/software/current-project",
    "2026 project",
  );
  external.status = "failed";
  external.attempts = 1;
  external.failures.push(
    recordFailure(
      "collect",
      new Error(
        "External showcase needs a preserved link from an official school source",
      ),
    ),
  );
  const proof = add(state, "/event", "Affiliation source for 2026 project");
  expect(
    await run(state, 2, `<a href="${external.url}">2026 project</a>`),
  ).toEqual([proof.url, external.url]);
  expect(state.candidates.find((c) => c.id === external.id)?.status).toBe(
    "downloaded",
  );
  expect(external.failures).toHaveLength(1);
  expect(external.externalProof?.officialUrl).toBe(proof.url);
  expect(external.provenance.some((p) => p.parentUrl === proof.url)).toBe(true);
});

test("school balancing survives priority scheduling", async () => {
  const other = { ...school, id: "other", domain: "other.edu" };
  const state = emptyState([school, other]);
  const report = add(state, "/files/2026-project.pdf", "2026 report");
  add(state, "/projects/next-project", "2026 project");
  const otherRoot = add(state, "/research", "Research", other);
  expect(
    await run(
      state,
      2,
      '<a href="/projects/deep">Deep project</a><a href="/contact">Contact</a>',
      [school, other],
    ),
  ).toEqual([report.url, otherRoot.url]);
  expect(
    state.candidates.find((c) => c.url === "https://example.edu/contact"),
  ).toBeDefined();
});

test("all approved links and provenance remain retained beyond traversal depth", async () => {
  const state = emptyState([school]);
  const gallery = add(state, "/gallery", "2026 gallery");
  gallery.depth = 1;
  expect(
    await run(
      state,
      3,
      '<a href="/projects/beyond">Beyond depth</a><a href="/contact">Contact</a>',
    ),
  ).toEqual([gallery.url]);
  const child = state.candidates.find(
    (c) => c.url === "https://example.edu/projects/beyond",
  )!;
  expect(child.depth).toBe(2);
  expect(child.status).toBe("pending");
  expect(child.provenance[0]?.parentUrl).toBe(gallery.url);
  expect(
    state.candidates.find((c) => c.url === "https://example.edu/contact"),
  ).toBeDefined();
});
