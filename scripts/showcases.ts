import {
  mkdir,
  readFile,
  writeFile,
  access,
  open,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  classify,
  checkpoint,
  emptyState,
  loadSchools,
  preserveCandidate,
  due,
  type State,
  type IntakeOptions,
  type School,
} from "./intake";
import { download } from "./intake/network";
import { mergeLaneState, runPipeline } from "./pipeline";

export const showcaseRoot = resolve(".research-cache/showcases-2025");
export const showcasePipeline = resolve(
  ".research-cache/pipeline/showcases-2025",
);
export const scopeSchema = z
  .object({
    id: z.literal("showcases-2025"),
    year: z.literal(2025),
    targetProjects: z.tuple([z.number(), z.number()]),
    schoolIds: z.array(z.string()).length(5),
    sources: z
      .array(
        z.object({
          schoolId: z.string(),
          category: z.enum(["capstone", "hackathon"]),
          title: z.string(),
          url: z.url(),
          assets: z
            .array(z.object({ title: z.string(), url: z.url() }))
            .optional(),
        }),
      )
      .max(10),
  })
  .superRefine((scope, ctx) => {
    if (new Set(scope.sources.map((s) => s.url)).size !== scope.sources.length)
      ctx.addIssue({ code: "custom", message: "Duplicate source URL" });
    for (const school of scope.schoolIds) {
      const count = scope.sources.filter((s) => s.schoolId === school).length;
      if (count < 1 || count > 2)
        ctx.addIssue({
          code: "custom",
          message: `Expected one or two sources for ${school}`,
        });
    }
    if (scope.sources.some((s) => !scope.schoolIds.includes(s.schoolId)))
      ctx.addIssue({ code: "custom", message: "Unselected school" });
  });

/** Disjoint sources run concurrently; one serialized merge owns the lane checkpoint. */
export async function classifyShowcases(
  state: State,
  _schools: School[],
  options: IntakeOptions,
) {
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
      let baseline = structuredClone(state);
      const local = structuredClone(state);
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
    }),
  );
  await queue;
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

async function runShowcaseBatch() {
  const scope = scopeSchema.parse(
    JSON.parse(await readFile("data/showcase-scope.json", "utf8")),
  );
  const schools = (await loadSchools()).filter((s) =>
    scope.schoolIds.includes(s.id),
  );
  if (schools.length !== 5) throw new Error("Scope school registry mismatch");
  const sources = scope.sources.flatMap((source) => [
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
  const candidateIds = sources.map(
    (source) =>
      preserveCandidate(
        state,
        source.url,
        {
          schoolId: source.schoolId,
          category: source.category,
          year: 2025,
          title: source.title,
          discoveredAt: new Date().toISOString(),
          discoveryRationale:
            "Selected 2025 showcase; event dates still require source evidence.",
        },
        0,
      ).id,
  );
  await checkpoint(state, { root: showcaseRoot });
  await writeFile(
    join(showcasePipeline, "scope.json"),
    JSON.stringify(
      {
        ...scope,
        candidateIds,
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
    enabledLanes: ["collect", "classify", "group"],
    discovery: false,
    deferAnalysisUntilClassified: true,
    maxDepth: 0,
    runtimeMs: 120 * 60_000,
    idleMs: 5 * 60_000,
    mirrorEnv: true,
    budgets: { collect: 10, classify: 3, group: 3, analyze: 2 },
    downloader: async (...args) => {
      const result = await download(...args);
      // This linked roster is data, never executed as JavaScript.
      if (
        args[0] ===
        "https://hci.stanford.edu/courses/cs147/2025/au/data/data.js?v=0"
      )
        result.contentType = "text/plain";
      return result;
    },
    runners: { classify: classifyShowcases },
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
            i.dateStatus === "verified" && !i.date?.startsWith("2025")
              ? "deferred-outside-2025"
              : "needs-review",
        })),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
export async function runShowcases() {
  await mkdir(showcaseRoot, { recursive: true, mode: 0o700 });
  const path = join(showcaseRoot, "startup.lock");
  const lock = await open(path, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  try {
    await runShowcaseBatch();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
if (import.meta.main) await runShowcases();
