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
) {
  const db = new ConvexHttpClient(url);
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
    for (let start = 0; start < records.length; start += 75) {
      const part = records.slice(start, start + 75);
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
