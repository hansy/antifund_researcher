/** Finite showcase intake -> every-record analysis -> private signal extraction. */
import {
  mkdir,
  open,
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { runShowcases, showcaseRoot, showcasePipeline } from "./showcases";
import { expandShowcaseSources } from "./showcase-intake";
import {
  analyzeShowcaseCollection,
  type ShowcaseItemAnalysis,
} from "./showcase-analysis";
import {
  hash,
  canonicalUrl,
  graph,
  checkpoint,
  type State,
  type Item,
} from "./intake";
import { group, derive, market } from "./opportunities";
import { createIntakeSync } from "./intake-sync";

const analysisRoot = join(showcasePipeline, "analysis");
const completionPath = join(showcasePipeline, "completion-status.json");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJSON = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));
async function atomic(path: string, value: unknown) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
export function selectedCollectionComplete(state: State, ids: string[]) {
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const c = state.candidates.find((c) => c.id === id);
      return (
        c?.status === "downloaded" &&
        c.revisions.length > 0 &&
        c.revisions.every(
          (r) =>
            r.parseStatus === "done" &&
            r.textPath &&
            state.classification[`${id}:${r.hash}`]?.done,
        )
      );
    })
  );
}
export function hasUnselectedSources(
  sources: { url: string }[],
  candidateIds: string[],
) {
  return sources.some(
    (s) => !candidateIds.includes(hash(canonicalUrl(s.url)).slice(0, 24)),
  );
}
export function analyzedItem(raw: Item, a: ShowcaseItemAnalysis): Item {
  return {
    ...raw,
    title: a.identity,
    domain: a.domain,
    keywords: [...new Set([...raw.keywords, ...a.keywords])],
    problem: a.problem,
    approach: a.conciseDescription,
    embodiment: a.embodiment,
    reportedResults: a.reportedResults,
    interpretation: a.commercialInterpretation,
    classificationStatus:
      a.disposition === "project" ? "classified" : "ambiguous",
    unansweredQuestions: [
      ...new Set([...raw.unansweredQuestions, ...a.unknowns]),
    ],
    evidence: a.claims.length
      ? a.claims.map((c) => ({
          quote: c.quote,
          ...(c.page ? { page: c.page } : {}),
          sourceUrl: raw.evidence[0]?.sourceUrl ?? "",
        }))
      : raw.evidence,
  };
}

export async function runCompleteShowcases() {
  await mkdir(analysisRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(showcasePipeline, "controller.lock");
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  const status = {
    pid: process.pid,
    phase: "collecting" as string,
    startedAt: new Date().toISOString(),
    updatedAt: "",
    selectedSources: 0,
    downloadedSources: 0,
    sourceClassifications: 0,
    rawRecords: 0,
    analyzedRecords: 0,
    analyzedSources: 0,
    privateSignals: 0,
    publicationAuthorized: false,
    exhaustiveInstitutionCoverage: false,
    error: undefined as string | undefined,
  };
  let stopped = false,
    collectionFinished = false;
  const analysisFailures = new Map<
    string,
    { attempts: number; error: string; retryAt: number }
  >();
  const reviewed = new Map<
    string,
    {
      fingerprint: string;
      records: { raw: Item; analysis: ShowcaseItemAnalysis }[];
    }
  >();
  let saves = Promise.resolve();
  const save = () => {
    status.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(status);
    saves = saves.then(() => atomic(completionPath, snapshot));
    return saves;
  };
  const refreshCollection = async () => {
    const state: State = await readJSON(join(showcaseRoot, "state.json"));
    const scope: { candidateIds: string[] } = await readJSON(
      join(showcasePipeline, "scope.json"),
    );
    const ids = new Set(scope.candidateIds);
    status.selectedSources = ids.size;
    status.downloadedSources = state.candidates.filter(
      (c) => ids.has(c.id) && c.status === "downloaded",
    ).length;
    status.sourceClassifications = state.candidates.filter(
      (c) => ids.has(c.id) && selectedCollectionComplete(state, [c.id]),
    ).length;
    status.rawRecords = state.items.filter((i) =>
      ids.has(i.candidateId),
    ).length;
    await save();
  };
  let refreshing = false;
  const refreshTimer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void refreshCollection()
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          status.error = String(error);
      })
      .finally(() => {
        refreshing = false;
      });
  }, 15_000);
  const abortAnalysis = new AbortController();
  const onSignal = () => {
    stopped = true;
    abortAnalysis.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  let analysisTask: Promise<void> | undefined;
  try {
    await save();
    // An existing bounded writer finishes cooperatively; this controller never competes with it.
    analysisTask = (async () => {
      while (!stopped) {
        let state: State, scope: { candidateIds: string[] };
        try {
          state = await readJSON(join(showcaseRoot, "state.json"));
          scope = await readJSON(join(showcasePipeline, "scope.json"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await wait(2000);
          continue;
        }
        const ids = scope.candidateIds;
        status.selectedSources = ids.length;
        status.downloadedSources = state.candidates.filter(
          (c) => ids.includes(c.id) && c.status === "downloaded",
        ).length;
        status.sourceClassifications = state.candidates.filter(
          (c) =>
            ids.includes(c.id) && selectedCollectionComplete(state, [c.id]),
        ).length;
        status.rawRecords = state.items.filter((i) =>
          ids.includes(i.candidateId),
        ).length;
        let worked = false;
        const ready = ids.filter((id) =>
          selectedCollectionComplete(state, [id]),
        );
        const readyItems = state.items.filter((i) =>
          ready.includes(i.candidateId),
        );
        const snapshot = hash(JSON.stringify(readyItems));
        const hasNew = ready.some(
          (id) =>
            reviewed.get(id)?.fingerprint !==
            hash(
              JSON.stringify(state.items.filter((i) => i.candidateId === id)),
            ),
        );
        const failed = analysisFailures.get(snapshot);
        if (
          hasNew &&
          (!failed || (failed.attempts < 3 && failed.retryAt <= Date.now()))
        ) {
          worked = true;
          await save();
          try {
            const ledger = await analyzeShowcaseCollection(state, ready, {
              root: join(analysisRoot, "working"),
              signal: abortAnalysis.signal,
              onProgress: async (metrics) => {
                status.analyzedRecords = metrics.analyzedRecords;
                await save();
              },
            });
            if (
              !ledger.completeForSnapshot ||
              !ledger.collectionCompleteForSelectedSources
            )
              throw new Error("Source analysis gate incomplete");
            for (const id of ready) {
              const records = ledger.records.filter(
                (r) => r.raw.candidateId === id,
              );
              reviewed.set(id, {
                fingerprint: hash(
                  JSON.stringify(
                    state.items.filter((i) => i.candidateId === id),
                  ),
                ),
                records,
              });
            }
            analysisFailures.delete(snapshot);
          } catch (error) {
            analysisFailures.set(snapshot, {
              attempts: (failed?.attempts ?? 0) + 1,
              error: error instanceof Error ? error.message : String(error),
              retryAt: Date.now() + 30_000,
            });
            await atomic(join(analysisRoot, "failures.json"), [
              ...analysisFailures.entries(),
            ]);
          }
          status.analyzedSources = reviewed.size;
          await save();
        }
        if (collectionFinished && !worked) {
          const pending = ids.filter(
            (id) =>
              reviewed.get(id)?.fingerprint !==
              hash(
                JSON.stringify(state.items.filter((i) => i.candidateId === id)),
              ),
          );
          if (!pending.length) break;
          if ((analysisFailures.get(snapshot)?.attempts ?? 0) >= 3)
            throw new Error(
              `Analysis requires attention for ${pending.length} sources; see analysis/failures.json`,
            );
        }
        if (!worked) await wait(2000);
      }
    })();
    // Observe failures immediately, without an unhandled promise during collection.
    let analysisError: unknown;
    analysisTask.catch((error) => {
      analysisError = error;
      stopped = true;
    });
    while (!stopped) {
      const disk = await statfs(showcaseRoot);
      if (Number(disk.bavail) * Number(disk.bsize) < 1_000_000_000)
        throw new Error(
          "Less than 1 GB free disk; downloads and checkpoints preserved.",
        );
      let existing: number | undefined;
      try {
        existing = Number(
          await readFile(join(showcaseRoot, "startup.lock"), "utf8"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (existing) {
        if (!alive(existing))
          throw new Error(
            `Stale showcase startup lock for PID ${existing}; verify before recovery.`,
          );
        await wait(2000);
        continue;
      }
      const result = await runShowcases();
      if (
        result.status.reason === "signal" ||
        result.status.reason === "stop-file"
      ) {
        stopped = true;
        break;
      }
      const expanded = await expandShowcaseSources(
        result.state,
        result.sources,
        join(showcasePipeline, "discovery"),
      );
      const newUrls = hasUnselectedSources(expanded, result.candidateIds);
      if (
        result.scope.discoveryComplete &&
        !newUrls &&
        selectedCollectionComplete(result.state, result.candidateIds)
      ) {
        collectionFinished = true;
        break;
      }
      const exhausted = result.state.candidates.filter(
        (c) =>
          result.candidateIds.includes(c.id) &&
          c.status !== "downloaded" &&
          c.attempts >= 3,
      );
      if (exhausted.length) {
        await atomic(
          join(showcasePipeline, "unavailable-sources.json"),
          exhausted,
        );
        throw new Error(
          `${exhausted.length} sources persistently unavailable; evidence/checkpoints retained.`,
        );
      }
    }
    if (analysisError) throw analysisError;
    if (stopped) {
      status.phase = "stopped";
      await save();
      return;
    }
    status.phase = "analyzing";
    await save();
    await analysisTask;
    const state: State = await readJSON(join(showcaseRoot, "state.json"));
    const scope = await readJSON(join(showcasePipeline, "scope.json"));
    const records = scope.candidateIds.flatMap(
      (id: string) => reviewed.get(id)?.records ?? [],
    );
    const actualIds = state.items
      .filter((i) => scope.candidateIds.includes(i.candidateId))
      .map((i) => i.id)
      .sort();
    if (
      JSON.stringify(records.map((r: { raw: Item }) => r.raw.id).sort()) !==
      JSON.stringify(actualIds)
    )
      throw new Error(
        "Final record accounting mismatch; signal extraction blocked.",
      );
    await atomic(join(analysisRoot, "review-ledger.json"), {
      completeForSnapshot: true,
      collectionCompleteForSelectedSources: true,
      rawRecordCount: records.length,
      records,
      publicationAuthorized: false,
      exhaustiveInstitutionCoverage: false,
      gaps: scope.gaps,
    });
    const allAnalyzed = structuredClone(state);
    const byId = new Map<string, ShowcaseItemAnalysis>(
      records.map((r: { raw: Item; analysis: ShowcaseItemAnalysis }) => [
        r.raw.id,
        r.analysis,
      ]),
    );
    allAnalyzed.items = allAnalyzed.items.map((raw) =>
      byId.has(raw.id) ? analyzedItem(raw, byId.get(raw.id)!) : raw,
    );
    await checkpoint(allAnalyzed, { root: join(analysisRoot, "classified") });
    let signals = structuredClone(allAnalyzed);
    signals.items = signals.items.filter((i) => {
      const a = byId.get(i.id);
      return (
        a?.disposition === "project" &&
        ["direct", "adjacent"].includes(a.roboticsSimulationRelevance)
      );
    });
    signals.items.sort(
      (a, b) =>
        a.domain.localeCompare(b.domain) || a.problem.localeCompare(b.problem),
    );
    signals.edges = [];
    signals.clusters = [];
    signals.insights = [];
    signals.opportunities = [];
    const signalRoot = join(analysisRoot, "signals");
    const signalInput = hash(JSON.stringify(signals.items));
    try {
      const previous = await readJSON(join(signalRoot, "input.json"));
      if (previous.fingerprint === signalInput)
        signals = await readJSON(join(signalRoot, "state.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(signalRoot, { recursive: true, mode: 0o700 });
    await atomic(join(signalRoot, "input.json"), { fingerprint: signalInput });
    status.phase = "extracting-signals";
    await save();
    await graph(signals, { root: signalRoot });
    await group(signals, {
      root: signalRoot,
      budget: Math.max(1, Math.ceil(signals.items.length / 40)),
    });
    await derive(signals, {
      root: signalRoot,
      budget: Math.max(
        1,
        signals.clusters.length + Math.ceil(signals.items.length / 18),
      ),
    });
    status.phase = "market-research";
    status.privateSignals = signals.opportunities?.length ?? 0;
    await save();
    await market(signals, {
      root: signalRoot,
      budget: Math.max(1, signals.opportunities?.length ?? 0),
    });
    const attempts = await readdir(join(signalRoot, "signal-attempts")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    if (attempts.length)
      throw new Error(
        `${attempts.length} signal/market calls require retry; private drafts retained.`,
      );
    const urls = [
      process.env.CONVEX_URL,
      process.env.CONVEX_PRODUCTION_URL,
    ].filter((x): x is string => !!x);
    if (process.env.RESEARCH_WRITE_SECRET)
      for (const url of new Set(urls))
        await createIntakeSync(url, process.env.RESEARCH_WRITE_SECRET)(
          allAnalyzed,
          true,
        );
    await atomic(join(analysisRoot, "outcome.json"), {
      finishedAt: new Date().toISOString(),
      reviewedRawRecords: records.length,
      focusProjects: signals.items.length,
      privateSignals: signals.opportunities,
      coverageGaps: scope.gaps,
      publicationAuthorized: false,
      exhaustiveInstitutionCoverage: false,
    });
    status.phase = "complete";
    await save();
  } catch (error) {
    stopped = true;
    status.phase = "failed";
    status.error = error instanceof Error ? error.message : String(error);
    await save();
    throw error;
  } finally {
    clearInterval(refreshTimer);
    stopped = true;
    abortAnalysis.abort();
    await analysisTask?.catch(() => {});
    await saves;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await lock.close();
    await unlink(lockPath);
  }
}
if (import.meta.main) await runCompleteShowcases();
