import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import { intakeManifest, intakeStatus, type State } from "./intake";

type RecordKind =
  "candidate" | "item" | "cell" | "edge" | "cluster" | "opportunity";
type ArchiveRecord = {
  kind: RecordKind;
  recordId: string;
  revision: string;
  payload: string;
  updatedAt: string;
};
const batch = makeFunctionReference<
  "mutation",
  { secret: string; records: ArchiveRecord[] },
  { added: number }
>("intake:recordBatch");
const status = makeFunctionReference<
  "mutation",
  { secret: string; updatedAt: string; summary: string },
  null
>("intake:setStatus");

/** Immutable metadata revisions in Convex; raw downloads remain in the local archive. */
export function createIntakeSync(
  url: string,
  secret: string,
  statusContext?: () => Record<string, unknown>,
  options: { fetch?: typeof fetch; requestTimeoutMs?: number } = {},
) {
  const transport = options.fetch ?? fetch;
  const db = new ConvexHttpClient(url, {
    fetch: Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const deadline = AbortSignal.timeout(
          options.requestTimeoutMs ?? 30_000,
        );
        return transport(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, deadline])
            : deadline,
        });
      },
      { preconnect: transport.preconnect },
    ),
  });
  const sent = new Map<string, string>();
  let lastSync = 0;
  return async (state: State, force = false) => {
    if (!force && Date.now() - lastSync < 15_000) return;
    const manifest = intakeManifest(state);
    const records: ArchiveRecord[] = [];
    const add = (kind: RecordKind, id: string, value: unknown) => {
      const payload = JSON.stringify(value);
      const revision = createHash("sha256").update(payload).digest("hex");
      if (sent.get(`${kind}:${id}`) !== revision)
        records.push({
          kind,
          recordId: id,
          revision,
          payload,
          updatedAt: state.updatedAt,
        });
    };
    manifest.candidates.forEach((x) => add("candidate", x.id, x));
    manifest.items.forEach((x) => add("item", x.id, x));
    manifest.coverage.forEach((x) =>
      add("cell", `${x.schoolId}:${x.category}:${x.year}`, x),
    );
    manifest.edges.forEach((x) => add("edge", `${x.from}:${x.to}`, x));
    manifest.clusters.forEach((x) => add("cluster", x.id, x));
    manifest.insights.forEach((x) => add("opportunity", x.clusterId, x));
    manifest.opportunities.forEach((x) => add("opportunity", x.id, x));
    let start = 0;
    while (start < records.length) {
      const part: ArchiveRecord[] = [];
      let bytes = 0;
      while (start < records.length && part.length < 75) {
        const record = records[start]!;
        const size = Buffer.byteLength(JSON.stringify(record));
        if (part.length && bytes + size > 256_000) break;
        part.push(record);
        bytes += size;
        start++;
      }
      // Each deployment stays below 0.5 MB/s, including initial full syncs.
      await Bun.sleep(Math.ceil((bytes / 500_000) * 1000));
      await db.mutation(batch, { secret, records: part });
      part.forEach((x) => sent.set(`${x.kind}:${x.recordId}`, x.revision));
    }
    await db.mutation(status, {
      secret,
      updatedAt: state.updatedAt,
      summary: JSON.stringify({ ...intakeStatus(state), ...statusContext?.() }),
    });
    lastSync = Date.now();
  };
}
