import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  hash,
  preserveCandidate,
  type State,
  type Candidate,
} from "./intake/model";
import {
  loadGatechProjectSources,
  loadHackmitSnapshots,
} from "./showcase-portals";
import { extractDevpostGallery } from "./showcase-devpost";
import { retainProject } from "./showcase-seeding";

export type ShowcaseSource = {
  schoolId: string;
  year: 2025 | 2026;
  category: "capstone" | "hackathon";
  title: string;
  url: string;
  kind?: "gallery" | "roster-asset" | "event-report" | "project";
  evidenceUrl?: string;
  notes?: string;
  externalProof?: Candidate["externalProof"];
};

/** Only approved event pagination and actual project hrefs, never broad navigation. */
export async function expandShowcaseSources(
  state: State,
  roots: ShowcaseSource[],
  discoveryRoot: string,
) {
  const sources = [...roots];
  const keys = new Set(sources.map((s) => `${s.url}|${s.schoolId}|${s.year}`));
  const add = (s: ShowcaseSource) => {
    const k = `${s.url}|${s.schoolId}|${s.year}`;
    if (!keys.has(k)) {
      keys.add(k);
      sources.push(s);
    }
  };
  for (const source of await loadGatechProjectSources(discoveryRoot))
    add(source);
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    const u = new URL(source.url);
    if (
      u.hostname === "hci.stanford.edu" &&
      /\/cs147\/202[56]\/au\/data\/data\.js$/.test(u.pathname)
    ) {
      const candidate = state.candidates.find((c) => c.url === source.url);
      const revision = candidate?.revisions.at(-1);
      if (revision?.parseStatus === "done") {
        const js = await readFile(revision.rawPath, "utf8");
        for (const match of js.matchAll(
          /\blink:\s*["'](https:\/\/hci\.stanford\.edu\/courses\/cs147\/202[56]\/au\/projects\/[^"']+)["']/g,
        )) {
          add({
            ...source,
            url: match[1]!,
            title: `CS147 project from ${source.title}`,
            kind: "project",
            evidenceUrl: source.url,
          });
        }
      }
    }
    if (
      !u.hostname.endsWith(".devpost.com") ||
      u.pathname !== "/project-gallery"
    )
      continue;
    const candidate = state.candidates.find((c) => c.url === source.url);
    const revision = candidate?.revisions.at(-1);
    if (!revision || revision.parseStatus !== "done") continue;
    const gallery = extractDevpostGallery(
      await readFile(revision.rawPath, "utf8"),
      source.url,
    );
    const last =
      gallery.lastPage ??
      (gallery.totalProjects ? Math.ceil(gallery.totalProjects / 24) : 1);
    // The server's observed count and page links bound this event; no open-ended crawl.
    if (last > 1000)
      throw new Error(`Implausible event pagination: ${source.url}`);
    for (let page = 2; page <= last; page++) {
      const url = new URL(source.url);
      url.searchParams.set("page", String(page));
      add({
        ...source,
        url: url.href,
        title: `${source.title.replace(/ — page \d+$/, "")} — page ${page}`,
        kind: "roster-asset",
        evidenceUrl: source.url,
      });
    }
    for (const url of gallery.projectUrls)
      add({
        ...source,
        url,
        title: `Project from ${source.title}`,
        kind: "project",
        evidenceUrl: source.url,
      });
  }
  return sources;
}

/** Import redacted public API snapshots as explicitly derived evidence, never refetch account fields. */
export async function importHackmit(
  state: State,
  discoveryRoot: string,
  root: string,
): Promise<ShowcaseSource[]> {
  const sources: ShowcaseSource[] = [];
  const directory = join(root, "normalized-api");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const snapshot of await loadHackmitSnapshots(discoveryRoot)) {
    for (const request of snapshot.requests) {
      const projects = snapshot.projects.filter(
        (p) => p.sourceUrl === request.requestedUrl,
      );
      if (!projects.length)
        throw new Error(
          `No writeups mapped to retained API page ${request.requestedUrl}`,
        );
      const rawPath = resolve(request.rawPath);
      const raw = await readFile(rawPath);
      const rawMeta = JSON.parse(raw.toString());
      const accessedAt =
        rawMeta.accessedAt ?? rawMeta.fetchedAt ?? new Date().toISOString();
      const source: ShowcaseSource = {
        schoolId: "mit",
        year: snapshot.year,
        category: "hackathon",
        title: `HackMIT ${snapshot.year} public writeups — page ${request.page}`,
        url: request.requestedUrl,
        kind: "roster-asset",
        evidenceUrl: `https://plume.hackmit.org/gallery?hackathon_id=hack-${snapshot.year}`,
        notes:
          "Public project metadata from a redacted API response. Internal/join fields omitted; original response hash and request provenance retained privately. Hosted event association, not proof of MIT enrollment.",
      };
      sources.push(source);
      const candidate = preserveCandidate(
        state,
        source.url,
        {
          schoolId: "mit",
          year: snapshot.year,
          category: "hackathon",
          title: source.title,
          discoveredAt: accessedAt,
          discoveryRationale: source.notes,
        },
        0,
      );
      const digest = hash(raw);
      let revision = candidate.revisions.find((r) => r.hash === digest);
      const textPath = resolve(directory, `${digest}.txt`);
      const text = projects
        .map((p) => `PROJECT ID ${p.id}\n${p.title}\n${p.fullStory}`)
        .join("\n\n");
      await writeFile(textPath, text, { mode: 0o600 });
      if (!revision) {
        revision = {
          hash: digest,
          requestedUrl: source.url,
          finalUrl: source.url,
          accessedAt,
          kind: "html",
          rawPath,
          textPath,
          parseStatus: "done",
        };
        candidate.revisions.push(revision);
      }
      candidate.status = "downloaded";
      for (const project of projects)
        retainProject(state, candidate, revision, {
          title: project.title,
          story: project.fullStory || project.title,
          authors: project.authors,
          identityKey: project.id,
        });
      state.classification[`${candidate.id}:${digest}`] = {
        nextChunk: 1,
        done: true,
        failures: [],
        method: "structured-v1",
      };
    }
  }
  return sources;
}
