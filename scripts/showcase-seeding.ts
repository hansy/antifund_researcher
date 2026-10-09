import { readFile } from "node:fs/promises";
import {
  hash,
  type Candidate,
  type Revision,
  type State,
  type Item,
} from "./intake/model";
import { extractWaterlooProjects } from "./showcase-rosters";
import {
  extractDevpostGallery,
  extractDevpostProject,
} from "./showcase-devpost";
import { parseGatechProject } from "./showcase-portals";
import { extractBerkeleyProjects } from "./showcase-berkeley";

export function retainProject(
  state: State,
  candidate: Candidate,
  revision: Revision,
  project: {
    title: string;
    story: string;
    authors?: string[];
    identityKey?: string;
  },
) {
  const id = hash(
    `${candidate.id}|${revision.hash}|${project.identityKey ?? project.title.trim().toLowerCase()}`,
  ).slice(0, 24);
  const item: Item = {
    id,
    candidateId: candidate.id,
    revisionHash: revision.hash,
    title: project.title,
    authors: project.authors ?? [],
    schoolIds: [...new Set(candidate.provenance.map((p) => p.schoolId))],
    category: candidate.provenance[0]?.category ?? "ambiguous",
    domain: "Unknown",
    problem: "Unknown",
    approach: "Unknown",
    keywords: [],
    embodiment: "unknown",
    readiness: "unknown",
    date: null,
    dateStatus: "unverified",
    timeframe: "unknown",
    evidence: [{ quote: project.story, sourceUrl: revision.finalUrl }],
    reportedResults: "Not reported",
    interpretation: "Source project retained; analysis pending.",
    unansweredQuestions: [
      "Technical claims and commercial applicability require source analysis.",
    ],
    classificationStatus: "ambiguous",
  };
  const old = state.items.find((i) => i.id === id);
  if (!old) state.items.push(item);
  else if (!old.evidence.some((e) => e.quote === project.story))
    old.evidence.push(...item.evidence);
  return id;
}

/** Deterministic roster extraction precedes the single full-corpus analysis pass. */
export async function seedStructuredSources(state: State, ids: string[]) {
  for (const candidate of state.candidates.filter((c) => ids.includes(c.id))) {
    for (const revision of candidate.revisions) {
      if (
        revision.parseStatus !== "done" ||
        !revision.textPath ||
        revision.kind !== "html"
      )
        continue;
      const key = `${candidate.id}:${revision.hash}`;
      if (state.classification[key]?.method === "structured-v1") continue;
      const html = await readFile(revision.rawPath, "utf8");
      const retained = await readFile(revision.textPath, "utf8");
      let projects:
        { title: string; story: string; authors?: string[] }[] | undefined;
      if (new URL(candidate.url).hostname === "funginstitute.berkeley.edu") {
        const entries = extractBerkeleyProjects(html);
        if (entries.length) projects = entries;
      } else if (
        new URL(candidate.url).hostname === "uwaterloo.ca" &&
        /capstone-design/.test(candidate.url)
      ) {
        const entries = extractWaterlooProjects(html);
        if (entries.length) projects = entries;
      } else if (
        new URL(candidate.url).hostname === "devpost.com" &&
        /^\/software\//.test(new URL(candidate.url).pathname)
      ) {
        const project = extractDevpostProject(html, candidate.url);
        if (project) projects = [project];
      } else if (new URL(candidate.url).hostname === "expo.gatech.edu") {
        const project = parseGatechProject(html, candidate.url);
        if (project)
          projects = [
            {
              title: project.title,
              story: project.fullAbstract,
              authors: project.authors,
            },
          ];
      } else if (
        new URL(candidate.url).hostname.endsWith(".devpost.com") &&
        new URL(candidate.url).pathname === "/project-gallery"
      ) {
        const gallery = extractDevpostGallery(html, candidate.url);
        if (gallery.projectUrls.length) {
          // Cards are discovery metadata. Their complete detail pages are separate sources.
          projects = [];
          const title = candidate.provenance[0]?.title ?? "Project gallery";
          if (
            !state.items.some(
              (i) =>
                i.candidateId === candidate.id &&
                i.revisionHash === revision.hash,
            )
          )
            retainProject(state, candidate, revision, {
              title,
              story: retained.slice(0, 1000),
            });
        }
      }
      if (!projects) continue; // Unrecognized sources use the generic evidence-checking extractor.
      if (projects.some((p) => !retained.includes(p.story)))
        throw new Error(`Structured roster excerpt mismatch: ${candidate.url}`);
      for (const project of projects)
        retainProject(state, candidate, revision, project);
      // Only the generic pending placeholder is superseded; retained source evidence stays.
      if (projects.length)
        state.items = state.items.filter(
          (i) =>
            i.id !==
            hash(`${candidate.id}|${revision.hash}|ambiguous`).slice(0, 24),
        );
      state.classification[key] = {
        nextChunk: 1,
        done: true,
        failures: state.classification[key]?.failures ?? [],
        method: "structured-v1",
      };
    }
  }
}
