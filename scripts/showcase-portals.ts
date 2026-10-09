import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { htmlText } from "./intake/network";

const GT = "https://expo.gatech.edu/prod1/portal/portal.jsp";
const GT_ROSTER = `${GT}?c=17462&g=413665364&p=413142918`;
type Year = 2025 | 2026;
export type GatechProjectSource = {
  schoolId: "gatech";
  year: Year;
  category: "capstone";
  title: string;
  url: string;
  kind: "project";
  evidenceUrl: string;
  notes: string;
  semesterContexts: { semester: string; year: Year; rawPaths: string[] }[];
};
function text(value: string) {
  return htmlText(value).replace(/\s+/g, " ").trim();
}
function gatechUrl(value: string): string | null {
  try {
    const url = new URL(text(value), GT);
    const id = url.searchParams.get("id");
    if (
      url.hostname !== "expo.gatech.edu" ||
      url.pathname !== "/prod1/portal/portal.jsp" ||
      url.searchParams.get("g") !== "413665329" ||
      !id ||
      !/^\d+$/.test(id)
    )
      return null;
    return `${GT}?c=17462&p=413142918&g=413665329&id=${id}`;
  } catch {
    return null;
  }
}

/** Read only saved, dated semester lists; never treat an unfiltered GET as a cohort. */
export async function loadGatechProjectSources(
  discoveryRoot: string,
): Promise<GatechProjectSource[]> {
  const output = new Map<string, GatechProjectSource>();
  const cohorts = new Map<
    string,
    { expected: number | null; ids: Set<string>; rawPaths: string[] }
  >();
  const filenames = (await readdir(discoveryRoot)).sort();
  for (const filename of filenames) {
    const match =
      /^gatech-(spring|summer|fall)-(2025|2026)(-active)?-(roster|page-\d+)\.html$/.exec(
        filename,
      );
    if (!match) continue;
    const semester = match[1]!;
    const year = Number(match[2]) as Year;
    const active = Boolean(match[3]);
    const cohortKey = `${semester}-${year}${active ? "-active" : ""}`;
    const rawPath = join(discoveryRoot, filename);
    const html = await readFile(rawPath, "utf8");
    const cohort = cohorts.get(cohortKey) ?? {
      expected: null,
      ids: new Set<string>(),
      rawPaths: [],
    };
    cohort.rawPaths.push(rawPath);
    const count =
      /(?:Past Semester|Active) Expo Portal List\s+\d[\d,]*-\d[\d,]*\s+of\s+([\d,]+)/.exec(
        text(html),
      );
    if (count) {
      const expected = Number(count[1]!.replaceAll(",", ""));
      if (cohort.expected !== null && cohort.expected !== expected)
        throw new Error(`Conflicting roster totals for ${cohortKey}`);
      cohort.expected = expected;
    }
    for (const row of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)) {
      const cells = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)];
      if (cells.length < 2) continue;
      const links = [
        ...cells[0]![1]!.matchAll(
          /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
        ),
      ];
      const urls = [
        ...new Set(
          links
            .map((m) => gatechUrl(m[1] ?? m[2]!))
            .filter((u): u is string => Boolean(u)),
        ),
      ];
      if (urls.length !== 1) continue;
      const url = urls[0]!;
      const title = text(cells[1]![1]!);
      if (!title) continue;
      cohort.ids.add(url);
      const source = output.get(url) ?? {
        schoolId: "gatech",
        year,
        category: "capstone",
        title,
        url,
        kind: "project",
        evidenceUrl: active
          ? `${GT}?c=17462&g=413665353&p=413142918`
          : GT_ROSTER,
        notes: "",
        semesterContexts: [],
      };
      let context = source.semesterContexts.find(
        (c) => c.semester === semester && c.year === year,
      );
      if (!context) {
        context = { semester, year, rawPaths: [] };
        source.semesterContexts.push(context);
      }
      if (!context.rawPaths.includes(rawPath)) context.rawPaths.push(rawPath);
      source.notes =
        source.semesterContexts
          .map((c) => `${c.semester} ${c.year}`)
          .join("; ") +
        (active || source.notes.includes("provisional")
          ? "; Fall 2026 active roster is provisional."
          : ".") +
        " Semester provenance comes from saved filtered lists; generic roster URL alone does not encode the filter.";
      output.set(url, source);
    }
    cohorts.set(cohortKey, cohort);
  }
  await writeFile(
    join(discoveryRoot, "gatech-roster-reconciliation.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        publicationAuthorized: false,
        cohorts: [...cohorts].map(([cohort, c]) => ({
          cohort,
          reportedTotal: c.expected,
          uniqueProjectUrls: c.ids.size,
          reconciled: c.expected !== null && c.ids.size === c.expected,
          rawPaths: c.rawPaths,
        })),
        distinctProjectUrls: output.size,
      },
      null,
      2,
    ) + "\n",
  );
  return [...output.values()];
}

// Return a balanced element's contents; a nested paragraph/div cannot truncate an abstract.
function elementContent(
  html: string,
  start: number,
  tag: string,
): string | null {
  const tokens = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tokens.lastIndex = start;
  let depth = 0,
    contentStart = -1;
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    if (match[0].startsWith("</")) {
      if (--depth === 0) return html.slice(contentStart, match.index);
    } else {
      if (depth++ === 0) contentStart = tokens.lastIndex;
    }
  }
  return null;
}
export function parseGatechProject(
  html: string,
  url: string,
): {
  title: string;
  fullAbstract: string;
  authors: string[];
  year: Year;
  semester: string;
  sourceUrl: string;
} | null {
  const sourceUrl = gatechUrl(url);
  if (!sourceUrl) return null;
  const clean = html.replace(
    /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  const scopeStart = /<div\b[^>]*\bname\s*=\s*['"]Team Project['"][^>]*>/i.exec(
    clean,
  );
  if (!scopeStart) return null;
  const scope = elementContent(clean, scopeStart.index, "div");
  if (!scope) return null;
  const headings = [...scope.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 2) return null;
  const title = text(
    headings[0]![1]!.replace(/<small\b[^>]*>[\s\S]*?<\/small>/gi, ""),
  );
  const event = /^(Spring|Summer|Fall) (2025|2026) Capstone Design Expo$/.exec(
    text(headings[1]![1]!),
  );
  const description = /<h5\b[^>]*>\s*Description\s*<\/h5>/i.exec(scope);
  if (!title || !event || !description) return null;
  const remaining = scope.slice(description.index + description[0].length);
  const panel =
    /<div\b[^>]*\bclass\s*=\s*['"][^'"]*\bpanel-body\b[^'"]*['"][^>]*>/i.exec(
      remaining,
    );
  if (!panel) return null;
  const abstractHtml = elementContent(remaining, panel.index, "div");
  const fullAbstract = abstractHtml === null ? "" : htmlText(abstractHtml);
  if (!fullAbstract) return null;
  const authors: string[] = [];
  const members =
    /<h2\b[^>]*>\s*Members\s*<\/h2>\s*<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(
      scope,
    )?.[1];
  if (members && /<th\b[^>]*>\s*Name\s*<\/th>/i.test(members)) {
    for (const row of members.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const name = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(row[1]!);
      if (name && text(name[1]!)) authors.push(text(name[1]!));
    }
  }
  return {
    title,
    fullAbstract,
    authors: [...new Set(authors)],
    year: Number(event[2]) as Year,
    semester: event[1]!,
    sourceUrl,
  };
}

export type HackmitProject = {
  id: string;
  title: string;
  fullStory: string;
  authors: string[];
  publicUrl: string;
  sourceUrl: string;
  year: Year;
  rawPath: string;
};
export type HackmitSnapshot = {
  year: Year;
  rawPath: string;
  sourceUrl: string;
  reportedTotal: number;
  pagesFetched: number;
  uniqueIds: number;
  projects: HackmitProject[];
  requests: { requestedUrl: string; page: number; rawPath: string }[];
};
const storyFields = [
  "description",
  "inspiration",
  "what_it_does",
  "how_we_built_it",
  "challenges_we_ran_into",
  "accomplishments",
  "what_we_learned",
  "whats_next",
  "code_link",
  "links",
  "video_demo",
] as const;
/** Public writeups only: intentionally excludes join links and account/admin fields. */
export async function loadHackmitSnapshots(
  discoveryRoot: string,
): Promise<HackmitSnapshot[]> {
  const snapshots: HackmitSnapshot[] = [];
  for (const year of [2025, 2026] as const) {
    const rawPath = join(discoveryRoot, `hackmit-${year}-public-projects.json`);
    if (!(await Bun.file(rawPath).exists())) continue;
    const raw: unknown = JSON.parse(await readFile(rawPath, "utf8"));
    if (!raw || typeof raw !== "object")
      throw new Error(`Invalid HackMIT snapshot: ${rawPath}`);
    const data = raw as Record<string, unknown>;
    const expectedSource = `https://plume.hackmit.org/api/v3/projects/gallery?hackathon_id=hack-${year}&page=1`;
    if (
      data.sourceUrl !== expectedSource ||
      !Array.isArray(data.projects) ||
      typeof data.reportedTotal !== "number" ||
      typeof data.pagesFetched !== "number"
    )
      throw new Error(`Invalid HackMIT provenance: ${rawPath}`);
    const projects: HackmitProject[] = data.projects.map(
      (value: unknown, index: number) => {
        if (!value || typeof value !== "object")
          throw new Error(`Invalid HackMIT project ${index}`);
        const p = value as Record<string, unknown>;
        if (
          typeof p.id !== "string" ||
          typeof p.name !== "string" ||
          p.hackathonId !== `hack-${year}` ||
          !p.metadata ||
          typeof p.metadata !== "object"
        )
          throw new Error(`Invalid HackMIT project ${index}`);
        const metadata = p.metadata as Record<string, unknown>;
        const fullStory = storyFields
          .flatMap((key) => {
            const value = metadata[key];
            if (typeof value === "string" && value.trim())
              return [`${key.replaceAll("_", " ")}\n${value.trim()}`];
            if (
              Array.isArray(value) &&
              value.every((v) => typeof v === "string")
            )
              return [`${key}\n${value.join("\n")}`];
            return [];
          })
          .join("\n\n");
        // Sanitized snapshots omit gallery View tokens; use the actual supported search view.
        const publicUrl = `https://plume.hackmit.org/gallery?${new URLSearchParams({ hackathon_id: `hack-${year}`, search: p.name }).toString()}`;
        return {
          id: p.id,
          title: p.name,
          fullStory,
          authors: [],
          publicUrl,
          sourceUrl:
            typeof p.sourceUrl === "string" &&
            /^https:\/\/plume\.hackmit\.org\/api\/v3\/projects\/gallery\?hackathon_id=hack-(2025|2026)&page=[1-9]\d*$/.test(
              p.sourceUrl,
            ) &&
            p.sourceUrl.includes(`hack-${year}&`)
              ? p.sourceUrl
              : expectedSource,
          year,
          rawPath,
        };
      },
    );
    const uniqueIds = new Set(projects.map((p) => p.id)).size;
    if (
      projects.length !== data.reportedTotal ||
      uniqueIds !== projects.length ||
      data.pagesFetched !== Math.ceil(projects.length / 24)
    )
      throw new Error(`Incomplete or duplicated HackMIT snapshot: ${rawPath}`);
    const requests = Array.isArray(data.requests)
      ? data.requests.map((value: unknown) => {
          if (!value || typeof value !== "object")
            throw new Error("Invalid HackMIT request provenance");
          const r = value as Record<string, unknown>;
          if (
            typeof r.requestedUrl !== "string" ||
            typeof r.page !== "number" ||
            typeof r.rawPath !== "string"
          )
            throw new Error("Invalid HackMIT request provenance");
          return {
            requestedUrl: r.requestedUrl,
            page: r.page,
            rawPath: r.rawPath,
          };
        })
      : [];
    snapshots.push({
      year,
      rawPath,
      sourceUrl: expectedSource,
      reportedTotal: data.reportedTotal,
      pagesFetched: data.pagesFetched,
      uniqueIds,
      projects,
      requests,
    });
  }
  return snapshots;
}
