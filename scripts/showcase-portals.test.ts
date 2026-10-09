import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGatechProjectSources,
  loadHackmitSnapshots,
  parseGatechProject,
} from "./showcase-portals";

const detailUrl =
  "https://expo.gatech.edu/prod1/portal/portal.jsp?c=17462&p=413142918&g=413665329&id=417260314";
function roster(id: number, title: string, total = 1) {
  return `Past Semester Expo Portal List <strong>1-1</strong> of <strong>${total}</strong><table><tr><th>Team</th></tr><tr class='listItem'><td><a href='${detailUrl.replace("417260314", String(id)).replaceAll("&", "&amp;")}'>Team ${id}</a></td><td>${title}</td><td>Sponsor</td></tr></table>`;
}

test("semester snapshots reconcile unique URLs and preserve duplicate semester contexts", async () => {
  const root = await mkdtemp(join(tmpdir(), "portals-"));
  try {
    await writeFile(
      join(root, "gatech-spring-2025-roster.html"),
      roster(12, "Useful prototype"),
    );
    await writeFile(
      join(root, "gatech-spring-2025-page-2.html"),
      roster(12, "Useful prototype"),
    );
    await writeFile(
      join(root, "gatech-fall-2026-active-roster.html"),
      roster(12, "Useful prototype", 2),
    );
    await writeFile(
      join(root, "gatech-fall-2026-active-page-2.html"),
      roster(13, "Other project", 2),
    );
    await writeFile(
      join(root, "gatech-rowrider-detail.html"),
      roster(99, "Not a dated roster"),
    );
    const sources = await loadGatechProjectSources(root);
    expect(sources).toHaveLength(2);
    const shared = sources.find((s) => s.url.endsWith("id=12"))!;
    expect(
      shared.semesterContexts.map((c) => [c.semester, c.year]),
    ).toContainEqual(["spring", 2025]);
    expect(
      shared.semesterContexts.map((c) => [c.semester, c.year]),
    ).toContainEqual(["fall", 2026]);
    expect(shared.notes).toContain("provisional");
    expect(shared.title).toBe("Useful prototype");
    const reconciliation = JSON.parse(
      await readFile(join(root, "gatech-roster-reconciliation.json"), "utf8"),
    );
    expect(
      reconciliation.cohorts.every(
        (c: { reconciled: boolean }) => c.reconciled,
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlapping ranges cannot imply complete collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "portals-"));
  try {
    await writeFile(
      join(root, "gatech-fall-2025-roster.html"),
      roster(12, "One", 2),
    );
    await writeFile(
      join(root, "gatech-fall-2025-page-2.html"),
      roster(12, "One", 2),
    );
    expect(await loadGatechProjectSources(root)).toHaveLength(1);
    const reconciliation = JSON.parse(
      await readFile(join(root, "gatech-roster-reconciliation.json"), "utf8"),
    );
    expect(reconciliation.cohorts[0]).toMatchObject({
      reportedTotal: 2,
      uniqueProjectUrls: 1,
      reconciled: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const detail = `<nav><h1>Navigation heading</h1></nav><div name='Team Project'><div class='page-header'><h1>RowRider <small>DirtWorks</small></h1><h1><small>Spring 2025 Capstone Design Expo</small></h1></div><div class='center-container'><div class='panel-heading'><h5>Description</h5></div><div class='panel-body'>First paragraph.<div><p>Nested evidence &amp; full content.</p></div>Last sentence.</div></div><table><tr><td>Primary Email Contact</td><td>private@example.com</td></tr></table><h2 class='centered-half'>Members</h2><table><thead><tr><th>Name</th><th>Major</th></tr></thead><tbody><tr><td>Luke Barnes</td><td>ME</td></tr><tr><td>Priya Soneji</td><td>ME</td></tr></tbody></table></div>`;
test("detail parser isolates complete nested abstract and visible team names", () => {
  const result = parseGatechProject(detail, detailUrl)!;
  expect(result.title).toBe("RowRider");
  expect(result.fullAbstract).toContain("Nested evidence & full content.");
  expect(result.fullAbstract).toContain("Last sentence.");
  expect(result.fullAbstract).not.toContain("private@example.com");
  expect(result.authors).toEqual(["Luke Barnes", "Priya Soneji"]);
  expect(result).toMatchObject({ year: 2025, semester: "Spring" });
  expect(
    parseGatechProject(detail, "https://example.com/?g=413665329&id=1"),
  ).toBeNull();
  expect(
    parseGatechProject(detail.replace("Description", "Navigation"), detailUrl),
  ).toBeNull();
  expect(
    parseGatechProject("<h1>Project card</h1><p>Intro only</p>", detailUrl),
  ).toBeNull();
});

test("HackMIT keeps every project and explicit request provenance without admin fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "portals-"));
  try {
    const sourceUrl =
      "https://plume.hackmit.org/api/v3/projects/gallery?hackathon_id=hack-2025&page=1";
    const snapshot = {
      sourceUrl,
      reportedTotal: 2,
      pagesFetched: 1,
      projects: [
        {
          id: "pr-1",
          name: "Shared title",
          hackathonId: "hack-2025",
          sourceUrl,
          metadata: {
            description: "Real public evidence",
            how_we_built_it: "Mechanism details",
            code_link: "https://github.com/example/public",
            individual_contributions: "Do not copy",
            magic_link: "Do not copy",
          },
        },
        {
          id: "pr-2",
          name: "Shared title",
          hackathonId: "hack-2025",
          metadata: {},
        },
      ],
      requests: [
        { requestedUrl: sourceUrl, page: 1, rawPath: join(root, "page1.json") },
      ],
    };
    await writeFile(
      join(root, "hackmit-2025-public-projects.json"),
      JSON.stringify(snapshot),
    );
    const loaded = await loadHackmitSnapshots(root);
    expect(loaded[0]!.projects).toHaveLength(2);
    expect(loaded[0]!.projects[0]!.fullStory).toContain("Mechanism details");
    expect(loaded[0]!.projects[0]!.fullStory).not.toContain("Do not copy");
    expect(loaded[0]!.projects[0]!.authors).toEqual([]);
    expect(loaded[0]!.projects[1]!.fullStory).toBe("");
    expect(loaded[0]!.requests[0]!.requestedUrl).toBe(sourceUrl);
    snapshot.projects[1]!.id = "pr-1";
    await writeFile(
      join(root, "hackmit-2025-public-projects.json"),
      JSON.stringify(snapshot),
    );
    await expect(loadHackmitSnapshots(root)).rejects.toThrow(
      "Incomplete or duplicated",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
