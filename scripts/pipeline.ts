import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildGraph,
  checkpoint,
  classify,
  collect,
  connectedClusters,
  due,
  hash,
  intakeManifest,
  intakeRoot,
  intakeStatus,
  loadIntake,
  loadSchools,
  scanAll,
  type IntakeOptions,
  type School,
  type State,
} from "./intake";
import {
  derive,
  group,
  market,
  nextSignalRetry,
  preparePublication,
} from "./opportunities";
import { createIntakeSync } from "./intake-sync";
import { runCodex } from "./codex";
import { validateCorpus } from "./validation";

export const lanes = ["collect", "classify", "group", "analyze"] as const;
export type Lane = (typeof lanes)[number];
const serialized = (value: unknown) => JSON.stringify(value);

/** Apply only a lane's changes since its snapshot, never its whole stale state. */
function mergeRecords<T>(
  current: T[],
  baseline: T[],
  incoming: T[],
  key: (value: T) => string,
  remove = false,
): T[] {
  const before = new Map(
    baseline.map((value) => [key(value), serialized(value)]),
  );
  const after = new Map(incoming.map((value) => [key(value), value]));
  const merged = new Map(current.map((value) => [key(value), value]));
  for (const [id, value] of after)
    if (before.get(id) !== serialized(value))
      merged.set(id, structuredClone(value));
  if (remove)
    for (const id of before.keys()) if (!after.has(id)) merged.delete(id);
  return [...merged.values()];
}

/** Group topology always includes the newest classifications, even mid-batch. */
function rebuildGroups(state: State) {
  const fresh = buildGraph(state.items);
  const ids = new Set(state.items.map((item) => item.id));
  const edgeKey = (edge: State["edges"][number]) =>
    [edge.from, edge.to].sort().join(":");
  const keys = new Set(fresh.edges.map(edgeKey));
  const semantic = state.edges.filter(
    (edge) =>
      ids.has(edge.from) &&
      ids.has(edge.to) &&
      edge.reasons.some((reason) =>
        reason.startsWith("Semantic hypothesis:"),
      ) &&
      !keys.has(edgeKey(edge)),
  );
  state.edges = [...fresh.edges, ...semantic];
  state.clusters = connectedClusters(state.items, state.edges);
  state.insights = state.clusters
    .filter((cluster) => cluster.itemIds.length > 1)
    .map((cluster) => ({
      clusterId: cluster.id,
      interpretation: `${cluster.itemIds.length} retained items are connected by shared keywords or a proposed buyer problem. This is a hypothesis grouping, not evidence of market demand or technical equivalence.`,
      evidenceItemIds: cluster.itemIds,
      unansweredQuestions: [
        "Do the linked projects solve the same buyer problem?",
        "What independent market evidence validates demand?",
        "How do approaches, reported results and readiness differ?",
      ],
    }));
}

export function mergeLaneState(
  canonical: State,
  lane: Lane,
  baseline: State,
  incoming: State,
): State {
  if (lane === "collect") {
    canonical.candidates = mergeRecords(
      canonical.candidates,
      baseline.candidates,
      incoming.candidates,
      (value) => value.id,
    );
    canonical.cells = mergeRecords(
      canonical.cells,
      baseline.cells,
      incoming.cells,
      (value) => `${value.schoolId}:${value.category}:${value.year}`,
    );
  } else if (lane === "classify") {
    canonical.items = mergeRecords(
      canonical.items,
      baseline.items,
      incoming.items,
      (value) => value.id,
      true,
    );
    for (const [key, value] of Object.entries(incoming.classification))
      if (serialized(baseline.classification[key]) !== serialized(value))
        canonical.classification[key] = structuredClone(value);
  } else if (lane === "group") {
    canonical.edges = mergeRecords(
      canonical.edges,
      baseline.edges,
      incoming.edges,
      (value) => [value.from, value.to].sort().join(":"),
    );
    rebuildGroups(canonical);
  } else {
    canonical.opportunities = mergeRecords(
      canonical.opportunities ?? [],
      baseline.opportunities ?? [],
      incoming.opportunities ?? [],
      (value) => value.id,
    );
  }
  return canonical;
}

export type LaneStatus = {
  phase: "waiting" | "running" | "backoff" | "stopped";
  iterations: number;
  checkpoints: number;
  successes: number;
  agentCalls: number;
  lastSuccess?: string;
  lastError?: string;
  retryAfter?: string;
};
export type PipelineStatus = {
  pid: number;
  root: string;
  startedAt: string;
  updatedAt: string;
  phase: "running" | "stopping" | "stopped";
  reason?: string;
  lanes: Record<Lane, LaneStatus>;
  summary: ReturnType<typeof intakeStatus>;
  mirror: { enabled: boolean; lastSuccess?: string; lastError?: string };
};
export type PipelineOptions = {
  root?: string;
  pipelineRoot?: string;
  runtimeMs?: number;
  pollMs?: number;
  idleMs?: number;
  budgets?: Partial<Record<Lane, number>>;
  maxDepth?: number;
  schoolId?: string;
  schools?: School[];
  agent?: typeof runCodex;
  downloader?: IntakeOptions["downloader"];
  signal?: AbortSignal;
  /** Environment destinations are enabled by the CLI, never by test/library calls. */
  mirrorEnv?: boolean;
  sync?: (state: State, force?: boolean) => Promise<void>;
  /** Test seam; each actor still receives an isolated snapshot and private root. */
  runners?: Partial<
    Record<
      Lane,
      (
        state: State,
        schools: School[],
        options: IntakeOptions,
      ) => Promise<unknown>
    >
  >;
};
export const pipelineDirectory = (root = intakeRoot) =>
  join(resolve(root), "..", "pipeline", hash(resolve(root)).slice(0, 12));
const paths = (options: PipelineOptions) => {
  const root = resolve(options.root ?? intakeRoot);
  return {
    root,
    pipeline: resolve(options.pipelineRoot ?? pipelineDirectory(root)),
  };
};
async function atomicJson(path: string, value: unknown) {
  await writeFile(path + ".tmp", serialized(value) + "\n", { mode: 0o600 });
  await rename(path + ".tmp", path);
}
async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function inputKey(state: State, lane: Lane) {
  if (lane === "group") return hash(serialized(state.items));
  if (lane === "analyze")
    return hash(
      serialized({
        items: state.items,
        clusters: state.clusters,
        opportunities: (state.opportunities ?? []).map(
          ({ id, fingerprint, stage, publishRecommended }) => ({
            id,
            fingerprint,
            stage,
            publishRecommended,
          }),
        ),
      }),
    );
  return "";
}
function ownedKey(state: State, lane: Lane) {
  return hash(
    serialized(
      lane === "collect"
        ? [state.candidates, state.cells]
        : lane === "classify"
          ? [state.items, state.classification]
          : lane === "group"
            ? [state.edges, state.clusters, state.insights]
            : (state.opportunities ?? []),
    ),
  );
}
function progressUnits(state: State, lane: Lane) {
  if (lane === "collect")
    return (
      state.candidates.reduce(
        (count, candidate) => count + candidate.revisions.length,
        0,
      ) + state.cells.filter((cell) => cell.status === "done").length
    );
  if (lane === "classify")
    return Object.values(state.classification).reduce(
      (count, progress) => count + progress.nextChunk,
      0,
    );
  if (lane === "group") return state.edges.length;
  return (state.opportunities ?? []).reduce(
    (count, opportunity) =>
      count + (opportunity.stage === "researched" ? 2 : 1),
    0,
  );
}
function hasWork(
  state: State,
  lane: Lane,
  maxDepth: number,
  schoolId?: string,
) {
  if (lane === "collect")
    return (
      state.cells.some(
        (cell) =>
          (!schoolId || cell.schoolId === schoolId) && cell.status !== "done",
      ) ||
      state.candidates.some(
        (candidate) =>
          candidate.depth <= maxDepth &&
          (!schoolId ||
            candidate.provenance.some((p) => p.schoolId === schoolId)) &&
          (candidate.status !== "downloaded" ||
            candidate.revisions.some(
              (revision) => revision.parseStatus !== "done",
            )),
      )
    );
  if (lane === "classify")
    return state.candidates.some(
      (candidate) =>
        (!schoolId ||
          candidate.provenance.some((p) => p.schoolId === schoolId)) &&
        candidate.revisions.some(
          (revision) =>
            revision.parseStatus === "done" &&
            revision.textPath &&
            !state.classification[`${candidate.id}:${revision.hash}`]?.done,
        ),
    );
  if (lane === "group") return state.items.length > 0;
  return (
    state.clusters.some((cluster) => cluster.itemIds.length > 1) ||
    (state.opportunities ?? []).some(
      (opportunity) =>
        opportunity.publishRecommended && opportunity.stage !== "researched",
    )
  );
}
function runnable(
  state: State,
  lane: Lane,
  maxDepth: number,
  schoolId?: string,
) {
  if (lane === "collect")
    return (
      state.cells.some(
        (cell) =>
          (!schoolId || cell.schoolId === schoolId) &&
          cell.status !== "done" &&
          due(cell.failures, false),
      ) ||
      state.candidates.some(
        (candidate) =>
          candidate.depth <= maxDepth &&
          (!schoolId ||
            candidate.provenance.some((p) => p.schoolId === schoolId)) &&
          (candidate.status !== "downloaded" ||
            candidate.revisions.some(
              (revision) => revision.parseStatus !== "done",
            )) &&
          due(candidate.failures, false),
      )
    );
  if (lane === "classify")
    return state.candidates.some(
      (candidate) =>
        (!schoolId ||
          candidate.provenance.some((p) => p.schoolId === schoolId)) &&
        candidate.revisions.some((revision) => {
          const progress =
            state.classification[`${candidate.id}:${revision.hash}`];
          return (
            revision.parseStatus === "done" &&
            revision.textPath &&
            !progress?.done &&
            due(progress?.failures ?? [], false)
          );
        }),
    );
  return hasWork(state, lane, maxDepth, schoolId);
}

/** Four actors; one canonical writer, one checkpoint queue, one separate mirror actor. */
export async function runPipeline(options: PipelineOptions = {}) {
  const { root, pipeline } = paths(options);
  const budgets = {
    collect: 10,
    classify: 3,
    group: 3,
    analyze: 2,
    ...options.budgets,
  };
  for (const value of Object.values(budgets))
    if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value))
      throw new Error("Lane budgets must be positive integers");
  const runtimeMs = options.runtimeMs ?? 120 * 60_000;
  if (!Number.isFinite(runtimeMs) || runtimeMs <= 0)
    throw new Error("Runtime must be positive");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, "writer.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        "Intake writer already active or stale writer.lock; inspect its PID before removing it",
      );
    throw error;
  }
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  const wakeups = new Set<() => void>();
  const stop = (reason: string) => {
    stopped = true;
    if (status) {
      status.phase = "stopping";
      status.reason ??= reason;
    }
    for (const wake of wakeups) wake();
  };
  let status: PipelineStatus | undefined;
  const onSignal = () => stop("signal");
  const onAbort = () => stop("abort");
  const enqueue = (operation: () => Promise<void>) => {
    const result = queue.then(operation);
    // Keep the queue usable for final status/cleanup after a rejected operation.
    queue = result.catch(() => {});
    return result;
  };
  const wait = (ms: number) =>
    new Promise<void>((done) => {
      const finish = () => {
        clearTimeout(timer);
        wakeups.delete(finish);
        done();
      };
      const timer = setTimeout(finish, ms);
      wakeups.add(finish);
      if (stopped) finish();
    });
  try {
    await lock.writeFile(String(process.pid));
    await mkdir(pipeline, { recursive: true, mode: 0o700 });
    await unlink(join(pipeline, "stop")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    const schools = options.schools ?? (await loadSchools());
    const canonical = await loadIntake(schools, { root });
    // Existing archives may contain relative paths; all lanes must reference the same files.
    for (const candidate of canonical.candidates)
      for (const revision of candidate.revisions) {
        revision.rawPath = resolve(revision.rawPath);
        if (revision.textPath) revision.textPath = resolve(revision.textPath);
      }
    let mirrorDirty = true;
    const statusContext = () => ({
      pipeline: status
        ? {
            phase: status.phase,
            startedAt: status.startedAt,
            updatedAt: status.updatedAt,
            lanes: Object.fromEntries(
              lanes.map((lane) => [
                lane,
                {
                  phase: status!.lanes[lane].phase,
                  iterations: status!.lanes[lane].iterations,
                  checkpoints: status!.lanes[lane].checkpoints,
                  agentCalls: status!.lanes[lane].agentCalls,
                },
              ]),
            ),
          }
        : null,
    });
    const destinations = options.mirrorEnv
      ? [
          ...new Set(
            [process.env.CONVEX_URL, process.env.CONVEX_PRODUCTION_URL].filter(
              (url): url is string => !!url,
            ),
          ),
        ]
      : [];
    const mirrors = process.env.RESEARCH_WRITE_SECRET
      ? destinations.map((url) =>
          createIntakeSync(
            url,
            process.env.RESEARCH_WRITE_SECRET!,
            statusContext,
          ),
        )
      : [];
    const sync =
      options.sync ??
      (mirrors.length
        ? async (state: State, force?: boolean) => {
            const results = await Promise.allSettled(
              mirrors.map((mirror) => mirror(state, force)),
            );
            const failure = results.find(
              (result) => result.status === "rejected",
            );
            if (failure?.status === "rejected") throw failure.reason;
          }
        : undefined);
    status = {
      pid: process.pid,
      root,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phase: "running",
      lanes: Object.fromEntries(
        lanes.map((lane) => [
          lane,
          {
            phase: "waiting",
            iterations: 0,
            checkpoints: 0,
            successes: 0,
            agentCalls: 0,
          },
        ]),
      ) as Record<Lane, LaneStatus>,
      summary: intakeStatus(canonical),
      mirror: { enabled: !!sync },
    };
    const writeStatus = () =>
      enqueue(async () => {
        status!.updatedAt = new Date().toISOString();
        status!.summary = intakeStatus(canonical);
        await atomicJson(join(pipeline, "status.json"), status);
      });
    await checkpoint(canonical, { root });
    await writeStatus();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    options.signal?.addEventListener("abort", onAbort);
    if (options.signal?.aborted) stop("abort");
    const deadline = Date.now() + runtimeMs;
    const pollMs = Math.max(10, options.pollMs ?? 2000);
    const maxDepth = options.maxDepth ?? 3;
    const completed = new Map<Lane, string>();
    let lastProgress = Date.now();
    const pending = (lane: Lane) =>
      hasWork(canonical, lane, maxDepth, options.schoolId) &&
      completed.get(lane) !== inputKey(canonical, lane);
    const log = async (lane: Lane | "mirror", error: unknown) => {
      await appendFile(
        join(pipeline, "errors.log"),
        `${new Date().toISOString()} ${lane}: ${error instanceof Error ? error.message : String(error)}\n`,
        { mode: 0o600 },
      );
    };
    const actor = async (lane: Lane) => {
      const laneStatus = status!.lanes[lane];
      const laneRoot = join(pipeline, lane);
      await mkdir(laneRoot, { recursive: true, mode: 0o700 });
      let backoff = 0;
      let lastInput: string | undefined;
      while (!stopped) {
        if (Date.now() >= deadline) {
          stop("runtime");
          break;
        }
        if (
          (lane === "group" || lane === "analyze") &&
          lastInput !== inputKey(canonical, lane)
        )
          delete laneStatus.retryAfter;
        if (
          !pending(lane) ||
          !runnable(canonical, lane, maxDepth, options.schoolId) ||
          Date.parse(laneStatus.retryAfter ?? "") > Date.now()
        ) {
          laneStatus.phase =
            Date.parse(laneStatus.retryAfter ?? "") > Date.now()
              ? "backoff"
              : "waiting";
          await wait(pollMs);
          continue;
        }
        laneStatus.phase = "running";
        laneStatus.iterations++;
        const snapshot = structuredClone(canonical);
        let baseline = structuredClone(snapshot);
        const input = inputKey(snapshot, lane);
        lastInput = input;
        const before = ownedKey(snapshot, lane);
        let agentErrors = 0,
          calls = 0;
        const laneOptions: IntakeOptions = {
          root: laneRoot,
          budget: budgets[lane],
          runtimeMs: Math.max(1, deadline - Date.now()),
          maxDepth,
          schoolId: options.schoolId,
          agent: async (prompt, schema, agentOptions) => {
            if (stopped || Date.now() >= deadline)
              throw new Error("Pipeline stopping before next agent call");
            calls++;
            laneStatus.agentCalls++;
            try {
              return await (options.agent ?? runCodex)(prompt, schema, {
                ...agentOptions,
                timeoutMs: Math.max(
                  1,
                  Math.min(
                    agentOptions?.timeoutMs ?? 180_000,
                    deadline - Date.now(),
                  ),
                ),
              });
            } catch (error) {
              agentErrors++;
              laneStatus.lastError =
                error instanceof Error ? error.message : String(error);
              throw error;
            }
          },
          downloader: async (...args) => {
            if (stopped || Date.now() >= deadline)
              throw new Error("Pipeline stopping before next download");
            const download =
              options.downloader ?? (await import("./intake/network")).download;
            return download(...args);
          },
          onCheckpoint: async (state) => {
            const update = structuredClone(state);
            const previous = baseline;
            await enqueue(async () => {
              const beforeMerge = ownedKey(canonical, lane);
              const beforeProgress = progressUnits(canonical, lane);
              mergeLaneState(canonical, lane, previous, update);
              if (beforeMerge !== ownedKey(canonical, lane)) {
                const progress =
                  progressUnits(canonical, lane) - beforeProgress;
                if (progress > 0) {
                  laneStatus.successes += progress;
                  laneStatus.lastSuccess = new Date().toISOString();
                }
                lastProgress = Date.now();
                mirrorDirty = true;
              }
              await checkpoint(canonical, { root });
              laneStatus.checkpoints++;
            });
            baseline = update;
            await writeStatus();
          },
        };
        try {
          if (options.runners?.[lane])
            await options.runners[lane]!(snapshot, schools, laneOptions);
          else if (lane === "collect") {
            // Download existing discoveries promptly, then spend a small discovery budget.
            await collect(snapshot, schools, laneOptions);
            if (!stopped)
              await scanAll(snapshot, schools, {
                ...laneOptions,
                budget: Math.min(2, budgets.collect),
              });
          } else if (lane === "classify") await classify(snapshot, laneOptions);
          else if (lane === "group") {
            rebuildGroups(snapshot);
            await checkpoint(snapshot, laneOptions);
            await group(snapshot, laneOptions);
          } else {
            await derive(snapshot, {
              ...laneOptions,
              budget: Math.ceil(budgets.analyze / 2),
            });
            if (!stopped && calls < budgets.analyze)
              await market(snapshot, {
                ...laneOptions,
                budget: budgets.analyze - calls,
              });
          }
          // Some functions return without checkpointing, and injected runners may do so too.
          if (ownedKey(baseline, lane) !== ownedKey(snapshot, lane))
            await checkpoint(snapshot, laneOptions);
          const changed = before !== ownedKey(snapshot, lane);
          const retryAt =
            lane === "group" || lane === "analyze"
              ? await nextSignalRetry(laneOptions)
              : undefined;
          if (
            (lane === "group" || lane === "analyze") &&
            calls === 0 &&
            agentErrors === 0 &&
            !retryAt
          )
            completed.set(lane, input);
          if (!changed) {
            backoff = Math.min(backoff + 1, 6);
            laneStatus.retryAfter = new Date(
              Date.now() + Math.max(pollMs, 5000 * 2 ** backoff),
            ).toISOString();
          } else {
            backoff = 0;
            delete laneStatus.retryAfter;
          }
          if (retryAt && calls === 0)
            laneStatus.retryAfter = new Date(retryAt).toISOString();
          if (agentErrors) {
            backoff = Math.min(backoff + 1, 6);
            laneStatus.retryAfter = new Date(
              Date.now() + Math.max(pollMs, 30_000 * 2 ** backoff),
            ).toISOString();
            await log(lane, laneStatus.lastError);
          }
        } catch (error) {
          laneStatus.lastError =
            error instanceof Error ? error.message : String(error);
          backoff = Math.min(backoff + 1, 6);
          laneStatus.retryAfter = new Date(
            Date.now() + Math.max(pollMs, 30_000 * 2 ** backoff),
          ).toISOString();
          await log(lane, error);
        }
        laneStatus.phase = "waiting";
        await writeStatus();
        await wait(pollMs);
      }
      laneStatus.phase = "stopped";
    };
    const mirror = async () => {
      while (!stopped) {
        if (sync && mirrorDirty) {
          // The mirror gets an immutable coherent copy; network waits never block canonical merges.
          const copy = structuredClone(canonical);
          mirrorDirty = false;
          try {
            await sync(copy, true);
            status!.mirror.lastSuccess = new Date().toISOString();
            delete status!.mirror.lastError;
          } catch (error) {
            mirrorDirty = true;
            status!.mirror.lastError =
              error instanceof Error ? error.message : String(error);
            await log("mirror", error);
          }
          await writeStatus();
        }
        await wait(15_000);
      }
    };
    const monitor = async () => {
      while (!stopped) {
        if (await exists(join(pipeline, "stop"))) stop("stop-file");
        else if (Date.now() >= deadline) stop("runtime");
        else if (
          lanes.every((lane) => status!.lanes[lane].phase !== "running") &&
          lanes.every((lane) => !pending(lane))
        )
          stop("drained");
        else if (
          options.idleMs &&
          Date.now() - lastProgress >= options.idleMs &&
          lanes.every((lane) => status!.lanes[lane].phase !== "running")
        )
          stop("idle");
        await wait(pollMs);
      }
    };
    const tasks = [...lanes.map(actor), mirror(), monitor()].map((task) =>
      task.catch((error) => {
        stop("error");
        throw error;
      }),
    );
    const results = await Promise.allSettled(tasks);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
    await queue;
    await checkpoint(canonical, { root });
    status.phase = "stopped";
    status.updatedAt = new Date().toISOString();
    if (sync) {
      try {
        await sync(structuredClone(canonical), true);
        status.mirror.lastSuccess = new Date().toISOString();
      } catch (error) {
        status.mirror.lastError =
          error instanceof Error ? error.message : String(error);
        await log("mirror", error);
      }
    }
    await atomicJson(
      join(pipeline, "manifest.json"),
      intakeManifest(canonical),
    );
    if (!options.schools) {
      const base = validateCorpus(
        JSON.parse(await readFile("data/corpus.json", "utf8")),
      );
      await atomicJson(
        join(pipeline, "publication.json"),
        await preparePublication(base, canonical),
      );
    }
    status.phase = "stopped";
    await writeStatus();
    return { state: canonical, status };
  } catch (error) {
    if (status) {
      status.phase = "stopped";
      status.reason = "error";
      for (const lane of lanes) status.lanes[lane].phase = "stopped";
      await queue;
      await atomicJson(join(pipeline, "status.json"), status).catch(() => {});
    }
    throw error;
  } finally {
    stopped = true;
    for (const wake of wakeups) wake();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    options.signal?.removeEventListener("abort", onAbort);
    await queue;
    await lock.close();
    await unlink(lockPath);
  }
}

export async function pipelineMain(args = process.argv.slice(2)) {
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const number = (name: string, fallback: number) => {
    const value = flag(name) === undefined ? fallback : Number(flag(name));
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`${name} must be a positive number`);
    return value;
  };
  const options: PipelineOptions = {
    root: flag("--root"),
    pipelineRoot: flag("--pipeline-root"),
  };
  const { pipeline } = paths(options);
  if (args[0] === "status" || !args[0]) {
    try {
      const status = JSON.parse(
        await readFile(join(pipeline, "status.json"), "utf8"),
      ) as PipelineStatus;
      let alive = true;
      try {
        process.kill(status.pid, 0);
      } catch {
        alive = false;
      }
      console.log(JSON.stringify(compactStatus(status, alive), null, 2));
      return status;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        console.log("Pipeline has not run for this archive.");
        return;
      }
      throw error;
    }
  }
  if (args[0] === "stop") {
    await mkdir(pipeline, { recursive: true, mode: 0o700 });
    await writeFile(join(pipeline, "stop"), new Date().toISOString(), {
      mode: 0o600,
    });
    console.log("Stop requested; active work will checkpoint and drain.");
    return;
  }
  if (args[0] !== "run")
    throw new Error(
      "Usage: bun scripts/pipeline.ts run | status | stop [--root PATH] [--minutes 120] [--collect-budget 10] [--classify-budget 3] [--group-budget 3] [--analyze-budget 2] [--depth 3] [--school ID] [--idle-seconds N]",
    );
  const result = await runPipeline({
    ...options,
    mirrorEnv: true,
    runtimeMs: number("--minutes", 120) * 60_000,
    maxDepth: number("--depth", 3),
    schoolId: flag("--school"),
    idleMs: flag("--idle-seconds")
      ? number("--idle-seconds", 300) * 1000
      : undefined,
    budgets: Object.fromEntries(
      lanes.map((lane) => [
        lane,
        number(
          `--${lane}-budget`,
          { collect: 10, classify: 3, group: 3, analyze: 2 }[lane],
        ),
      ]),
    ),
  });
  console.log(JSON.stringify(compactStatus(result.status, false), null, 2));
  return result;
}
function compactStatus(status: PipelineStatus, processAlive: boolean) {
  const { coverage: _, ...discovery } = status.summary.discovery;
  return {
    phase: status.phase,
    reason: status.reason,
    pid: status.pid,
    processAlive,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    lanes: status.lanes,
    summary: { ...status.summary, discovery },
    mirror: status.mirror,
  };
}
if (import.meta.main) await pipelineMain();
