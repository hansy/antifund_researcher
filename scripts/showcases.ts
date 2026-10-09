import {
  mkdir,
  readFile,
  writeFile,
  access,
  open,
  unlink,
  statfs,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  classify,
  collect,
  checkpoint,
  emptyState,
  loadSchools,
  preserveCandidate,
  due,
  safeUrl,
  type State,
  type IntakeOptions,
  type School,
} from "./intake";
import { download } from "./intake/network";
import { mergeLaneState, runPipeline } from "./pipeline";
import { seedStructuredSources } from "./showcase-seeding";
import { expandShowcaseSources, importHackmit } from "./showcase-intake";
import { importShowcaseArtifacts } from "./showcase-artifacts";

export const showcaseRoot = resolve(".research-cache/showcases-2025");
export const showcasePipeline = resolve(
  ".research-cache/pipeline/showcases-2025",
);

/** Each source worker owns only its source, not six copies of the whole archive. */
export function sourceSnapshot(state: State, candidateId: string): State {
  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error(`Missing source ${candidateId}`);
  return structuredClone({
    version: state.version,
    updatedAt: state.updatedAt,
    cells: [],
    candidates: [candidate],
    items: state.items.filter((i) => i.candidateId === candidateId),
    classification: Object.fromEntries(
      Object.entries(state.classification).filter(([key]) =>
        key.startsWith(candidateId + ":"),
      ),
    ),
    edges: [],
    clusters: [],
    insights: [],
    opportunities: [],
  });
}

/** Downloads have no model budget; independent sources share a serialized merge. */
export async function collectShowcases(
  state: State,
  schools: School[],
  options: IntakeOptions,
) {
  const disk = await statfs(options.root!);
  if (Number(disk.bavail) * Number(disk.bsize) < 1_000_000_000)
    throw new Error(
      "Collection waiting for at least 1 GB free disk; evidence and checkpoints retained.",
    );
  const selected = state.candidates
    .filter(
      (c) =>
        options.candidateIds?.includes(c.id) &&
        (c.status !== "downloaded" ||
          c.revisions.some((r) => r.parseStatus !== "done")) &&
        due(c.failures, false) &&
        (() => {
          try {
            safeUrl(c.url, schools, c.externalProof);
            return true;
          } catch {
            return false;
          }
        })(),
    )
    .slice(0, 6);
  let queue = Promise.resolve();
  const results = await Promise.allSettled(
    selected.map(async (candidate) => {
      const local = sourceSnapshot(state, candidate.id);
      let baseline = structuredClone(local);
      await collect(local, schools, {
        ...options,
        root: join(options.root!, candidate.id),
        candidateIds: [candidate.id],
        budget: 1,
        onCheckpoint: (incoming) => {
          queue = queue.then(async () => {
            await seedStructuredSources(incoming, [candidate.id]);
            mergeLaneState(state, "collect", baseline, incoming);
            // Collection owns new revisions; structured records are seeded separately
            // because lane merges intentionally keep model-classification ownership.
            await seedStructuredSources(state, [candidate.id]);
            baseline = structuredClone(incoming);
            await checkpoint(state, options);
          });
          return queue;
        },
      });
      // Raw/text evidence stays; the canonical checkpoint already owns this copy.
      await unlink(join(options.root!, candidate.id, "state.json")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }),
  );
  await queue;
  const failure = results.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
export const scopeSchema = z
  .object({
    id: z.literal("showcases-2025"),
    years: z.array(z.union([z.literal(2025), z.literal(2026)])).min(1),
    discoveryComplete: z.boolean(),
    gaps: z
      .array(
        z.object({
          schoolId: z.string(),
          year: z.number(),
          detail: z.string(),
        }),
      )
      .default([]),
    schoolIds: z.array(z.string()).length(5),
    sources: z
      .array(
        z.object({
          schoolId: z.string(),
          year: z.union([z.literal(2025), z.literal(2026)]),
          category: z.enum(["capstone", "hackathon"]),
          title: z.string(),
          url: z.url(),
          kind: z
            .enum(["gallery", "roster-asset", "event-report", "project"])
            .optional(),
          evidenceUrl: z.url().optional(),
          notes: z.string().optional(),
          availability: z
            .enum(["available", "unavailable", "future", "unresolved"])
            .optional(),
          externalProof: z
            .object({
              officialUrl: z.url(),
              schoolId: z.string(),
              linkedHost: z.string().optional(),
            })
            .optional(),
          assets: z
            .array(z.object({ title: z.string(), url: z.url() }))
            .optional(),
        }),
      )
      .min(1),
  })
  .superRefine((scope, ctx) => {
    if (new Set(scope.sources.map((s) => s.url)).size !== scope.sources.length)
      ctx.addIssue({ code: "custom", message: "Duplicate source URL" });
    for (const school of scope.schoolIds) {
      const count = scope.sources.filter((s) => s.schoolId === school).length;
      if (count < 1)
        ctx.addIssue({
          code: "custom",
          message: `Expected sources for ${school}`,
        });
    }
    if (scope.sources.some((s) => !scope.schoolIds.includes(s.schoolId)))
      ctx.addIssue({ code: "custom", message: "Unselected school" });
    if (scope.sources.some((s) => !scope.years.includes(s.year)))
      ctx.addIssue({ code: "custom", message: "Source year outside scope" });
  });

/** Disjoint sources run concurrently; one serialized merge owns the lane checkpoint. */
export async function classifyShowcases(
  state: State,
  _schools: School[],
  options: IntakeOptions,
) {
  await seedStructuredSources(state, options.candidateIds ?? []);
  await checkpoint(state, options);
  const candidates = state.candidates
    .filter(
      (c) =>
        options.candidateIds?.includes(c.id) &&
        c.revisions.some((r) => {
          const p = state.classification[`${c.id}:${r.hash}`];
          return (
            r.parseStatus === "done" &&
            r.textPath &&
            !p?.done &&
            due(p?.failures ?? [], false)
          );
        }),
    )
    .sort((a, b) => {
      const progress = (id: string) =>
        Object.entries(state.classification)
          .filter(([key]) => key.startsWith(id + ":"))
          .reduce((n, [, p]) => n + p.nextChunk, 0);
      return progress(a.id) - progress(b.id);
    })
    .slice(0, 3);
  let queue = Promise.resolve();
  const results = await Promise.allSettled(
    candidates.map(async (c) => {
      const local = sourceSnapshot(state, c.id);
      let baseline = structuredClone(local);
      await classify(local, {
        ...options,
        root: join(options.root!, c.id),
        candidateIds: [c.id],
        budget: 1,
        onCheckpoint: (incoming) => {
          queue = queue.then(async () => {
            mergeLaneState(state, "classify", baseline, incoming);
            baseline = structuredClone(incoming);
            await checkpoint(state, options);
          });
          return queue;
        },
      });
      await unlink(join(options.root!, c.id, "state.json")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }),
  );
  await queue;
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

export async function runShowcaseBatch() {
  const scope = scopeSchema.parse(
    JSON.parse(await readFile("data/showcase-scope.json", "utf8")),
  );
  const schools = (await loadSchools()).filter((s) =>
    scope.schoolIds.includes(s.id),
  );
  if (schools.length !== 5) throw new Error("Scope school registry mismatch");
  let sources = scope.sources
    .filter((source) => source.availability !== "unavailable")
    .flatMap((source) => [
      source,
      ...(source.assets ?? []).map((asset) => ({
        ...source,
        ...asset,
        assets: undefined,
      })),
    ]);
  // Broad collection is deferred, never deleted or overwritten.
  try {
    await access(".research-cache/intake/writer.lock");
    throw new Error(
      "Wait for the broad archive writer to drain before switching scope",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(showcaseRoot, { recursive: true, mode: 0o700 });
  await mkdir(showcasePipeline, { recursive: true, mode: 0o700 });
  let state: State;
  try {
    state = JSON.parse(
      await readFile(join(showcaseRoot, "state.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    state = emptyState(schools);
    state.cells = [];
    const archived: State = JSON.parse(
      await readFile(".research-cache/intake/state.json", "utf8"),
    );
    for (const source of sources) {
      const old = archived.candidates.find((c) => c.url === source.url);
      if (old) {
        const copy = structuredClone(old);
        copy.depth = 0;
        state.candidates.push(copy);
        for (const revision of copy.revisions) {
          revision.rawPath = resolve(revision.rawPath);
          if (revision.textPath) revision.textPath = resolve(revision.textPath);
          const key = `${copy.id}:${revision.hash}`;
          if (archived.classification[key])
            state.classification[key] = structuredClone(
              archived.classification[key],
            );
        }
        state.items.push(
          ...structuredClone(
            archived.items.filter((i) => i.candidateId === copy.id),
          ),
        );
      }
    }
  }
  // Never edit a live focus writer's archive on a duplicate start.
  try {
    await access(join(showcaseRoot, "writer.lock"));
    throw new Error("Showcase writer already active");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const discoveryRoot = join(showcasePipeline, "discovery");
  const apiSources = await importHackmit(state, discoveryRoot, showcaseRoot);
  sources = await expandShowcaseSources(
    state,
    [...sources, ...apiSources],
    discoveryRoot,
  );
  await importShowcaseArtifacts(state, sources, discoveryRoot, showcaseRoot);
  const candidateIds = [
    ...new Set(
      sources.map((source) => {
        const candidate = preserveCandidate(
          state,
          source.url,
          {
            schoolId: source.schoolId,
            category: source.category,
            year: source.year,
            title: source.title,
            discoveredAt: new Date().toISOString(),
            discoveryRationale:
              "Selected 2025–2026 showcase; event dates still require source evidence.",
          },
          0,
        );
        if (source.externalProof)
          candidate.externalProof = source.externalProof;
        return candidate.id;
      }),
    ),
  ];
  await checkpoint(state, { root: showcaseRoot });
  await writeFile(
    join(showcasePipeline, "scope.json"),
    JSON.stringify(
      {
        ...scope,
        candidateIds,
        selectedSources: sources,
        broaderArchive: ".research-cache/intake",
        publicationHold: true,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  const result = await runPipeline({
    root: showcaseRoot,
    pipelineRoot: showcasePipeline,
    schools,
    candidateIds,
    enabledLanes: ["collect", "classify"],
    discovery: false,
    deferAnalysisUntilClassified: true,
    maxDepth: 0,
    runtimeMs: 10 * 60_000,
    idleMs: 5 * 60_000,
    mirrorEnv: true,
    budgets: { collect: 10, classify: 3, group: 3, analyze: 2 },
    downloader: async (...args) => {
      const result = await download(...args);
      // This linked roster is data, never executed as JavaScript.
      if (
        /\/data\/data\.js(?:\?|$)/.test(args[0]) ||
        /(?:json|javascript)/i.test(result.contentType)
      )
        result.contentType = "text/plain";
      return result;
    },
    runners: { collect: collectShowcases, classify: classifyShowcases },
  });
  await writeFile(
    join(showcasePipeline, "review-queue.json"),
    JSON.stringify(
      {
        scope: scope.id,
        publicationHold: true,
        note: "Classification is not human evidence review. Unknown dates, ambiguous projects and duplicate titles require review. No automatic publication.",
        items: result.state.items.map((i) => ({
          id: i.id,
          title: i.title,
          schoolIds: i.schoolIds,
          date: i.date,
          dateStatus: i.dateStatus,
          classificationStatus: i.classificationStatus,
          disposition:
            i.dateStatus === "verified" &&
            !scope.years.some((y) => i.date?.startsWith(String(y)))
              ? "deferred-outside-scope"
              : "needs-review",
        })),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return { ...result, scope, candidateIds, sources };
}
export async function runShowcases() {
  await mkdir(showcaseRoot, { recursive: true, mode: 0o700 });
  const path = join(showcaseRoot, "startup.lock");
  const lock = await open(path, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  try {
    return await runShowcaseBatch();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
if (import.meta.main) await runShowcases();
