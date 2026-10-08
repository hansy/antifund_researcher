import { createHash } from "node:crypto";
export const categories = ["hackathon", "capstone", "research"] as const;
export type Category = (typeof categories)[number];
export type School = {
  id: string;
  name: string;
  domain: string;
  discoveryUrls: string[];
};
export const intakeRoot = ".research-cache/intake";
export const hash = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
export type Failure = {
  at: string;
  stage: string;
  message: string;
  retryAfter: string;
};
export type Provenance = {
  schoolId: string;
  category: Category;
  year: number;
  parentUrl?: string;
  discoveredAt: string;
  title: string;
  claimedDate?: string | null;
  discoveryRationale?: string;
};
export type Revision = {
  hash: string;
  requestedUrl: string;
  finalUrl: string;
  accessedAt: string;
  kind: "html" | "pdf" | "binary";
  rawPath: string;
  textPath?: string;
  pages?: number;
  parseStatus: "pending" | "done" | "failed";
  failure?: string;
};
export type Candidate = {
  id: string;
  url: string;
  provenance: Provenance[];
  status: "pending" | "downloaded" | "failed";
  attempts: number;
  failures: Failure[];
  revisions: Revision[];
  externalProof?: {
    officialUrl: string;
    schoolId: string;
    linkedHost?: string;
  };
  depth: number;
};
export type Cell = {
  schoolId: string;
  category: Category;
  year: number;
  status: "pending" | "done" | "failed";
  attempts: number;
  candidates: number;
  failures: Failure[];
  searchedAt?: string;
  limitations?: string;
};
export type Item = {
  id: string;
  candidateId: string;
  revisionHash: string;
  title: string;
  schoolIds: string[];
  category: Category | "ambiguous";
  domain: string;
  problem: string;
  approach: string;
  keywords: string[];
  embodiment: string;
  readiness: string;
  date: string | null;
  dateStatus: "verified" | "unverified";
  timeframe: "in-window" | "outside-window" | "unknown";
  evidence: { quote: string; page?: number; sourceUrl: string }[];
  reportedResults: string;
  interpretation: string;
  unansweredQuestions: string[];
  classificationStatus: "classified" | "ambiguous";
  authors?: string[];
};
export type Edge = {
  from: string;
  to: string;
  score: number;
  reasons: string[];
  sharedKeywords: string[];
};
export type Cluster = { id: string; itemIds: string[]; edgeIndices: number[] };
export type Opportunity = {
  id: string;
  clusterId: string;
  fingerprint: string;
  evidenceItemIds: string[];
  title: string;
  summary: string;
  domain: string;
  publishRecommended?: boolean;
  whatItIs: string;
  problem: string;
  breakthroughs: { text: string; itemIds: string[] }[];
  buyer: string;
  statusQuo: string;
  gap: string;
  marketOpportunity: string;
  risks: string[];
  nextQuestions: string[];
  marketEvidence: {
    title: string;
    url: string;
    excerpt: string;
    accessedAt: string;
  }[];
  stage: "hypothesis" | "researched";
  updatedAt: string;
};
export type State = {
  version: 1;
  updatedAt: string;
  cells: Cell[];
  candidates: Candidate[];
  items: Item[];
  classification: Record<
    string,
    {
      nextChunk: number;
      done: boolean;
      failures: Failure[];
      chunkSize?: number;
    }
  >;
  edges: Edge[];
  clusters: Cluster[];
  opportunities?: Opportunity[];
  insights: {
    clusterId: string;
    interpretation: string;
    evidenceItemIds: string[];
    unansweredQuestions: string[];
  }[];
};
export function emptyState(schools: School[]): State {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    cells: schools.flatMap((s) =>
      categories.flatMap((category) =>
        [2025, 2026].map((year) => ({
          schoolId: s.id,
          category,
          year,
          status: "pending" as const,
          attempts: 0,
          candidates: 0,
          failures: [],
        })),
      ),
    ),
    candidates: [],
    items: [],
    classification: {},
    edges: [],
    clusters: [],
    insights: [],
  };
}
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}
/** Preserve first: this deliberately accepts unresolved external URLs as pending candidates. */
export function preserveCandidate(
  state: State,
  raw: string,
  provenance: Provenance,
  depth = 0,
): Candidate {
  const url = canonicalUrl(raw);
  let candidate = state.candidates.find((c) => c.url === url);
  if (!candidate) {
    candidate = {
      id: hash(url).slice(0, 24),
      url,
      provenance: [],
      depth,
      status: "pending",
      attempts: 0,
      failures: [],
      revisions: [],
    };
    state.candidates.push(candidate);
  }
  if (
    !candidate.provenance.some(
      (p) =>
        p.schoolId === provenance.schoolId &&
        p.category === provenance.category &&
        p.year === provenance.year &&
        p.parentUrl === provenance.parentUrl,
    )
  )
    candidate.provenance.push(provenance);
  candidate.depth = Math.min(candidate.depth, depth);
  return candidate;
}
export function recordFailure(
  stage: string,
  error: unknown,
  attempts = 1,
): Failure {
  return {
    stage,
    at: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    retryAfter: new Date(
      Date.now() +
        Math.min(24 * 3600_000, 60_000 * 2 ** Math.min(attempts, 10)),
    ).toISOString(),
  };
}
export function due(failures: Failure[], retry: boolean) {
  return (
    retry ||
    !failures.length ||
    Date.parse(failures.at(-1)!.retryAfter) <= Date.now()
  );
}
export function dateWindow(
  date: string | null,
  today = new Date().toISOString().slice(0, 10),
): Item["timeframe"] {
  if (!date || !/^202[0-9](?:-\d{2}(?:-\d{2})?)?$/.test(date)) return "unknown";
  const expanded =
    date.length === 4
      ? `${date}-01-01`
      : date.length === 7
        ? `${date}-01`
        : date;
  const parsed = new Date(`${expanded}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== expanded
  )
    return "unknown";
  return date >= "2025" && date <= today ? "in-window" : "outside-window";
}
export function buildGraph(items: Item[]): {
  edges: Edge[];
  clusters: Cluster[];
} {
  const edges: Edge[] = [];
  const norm = (s: string) => s.trim().toLowerCase();
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a]!,
        y = items[b]!;
      // Do not connect alternate revisions of the same source to themselves.
      if (x.candidateId === y.candidateId && norm(x.title) === norm(y.title))
        continue;
      const shared = [...new Set(x.keywords.map(norm))].filter(
        (k) => k.length > 2 && y.keywords.map(norm).includes(k),
      );
      const domain =
        norm(x.domain) === norm(y.domain) &&
        !["", "unknown", "not reported", "ambiguous"].includes(norm(x.domain));
      if (shared.length < 2) continue;
      const score = shared.length + (domain ? 1 : 0);
      edges.push({
        from: x.id,
        to: y.id,
        score,
        sharedKeywords: shared,
        reasons: [
          ...shared.map((k) => `Shared keyword: ${k}`),
          ...(domain ? [`Shared domain: ${x.domain}`] : []),
        ],
      });
    }
  return { edges, clusters: connectedClusters(items, edges) };
}
export function connectedClusters(items: Item[], edges: Edge[]): Cluster[] {
  const neighbors = new Map(items.map((i) => [i.id, new Set<string>()]));
  edges.forEach((e) => {
    neighbors.get(e.from)!.add(e.to);
    neighbors.get(e.to)!.add(e.from);
  });
  const seen = new Set<string>();
  const clusters: Cluster[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const ids: string[] = [],
      queue = [item.id];
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      queue.push(...neighbors.get(id)!);
    }
    ids.sort();
    clusters.push({
      id: hash(ids.join("|")).slice(0, 16),
      itemIds: ids,
      edgeIndices: edges.flatMap((e, i) =>
        ids.includes(e.from) && ids.includes(e.to) ? [i] : [],
      ),
    });
  }
  return clusters;
}
