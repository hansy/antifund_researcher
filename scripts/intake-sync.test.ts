import { expect, test } from "bun:test";
import { emptyState, preserveCandidate } from "./intake";
import { createIntakeSync } from "./intake-sync";

const school = {
  id: "test",
  name: "Test",
  domain: "example.edu",
  discoveryUrls: [],
};
const state = () => {
  const value = emptyState([school]);
  value.cells = [];
  preserveCandidate(value, "https://example.edu/project", {
    schoolId: school.id,
    category: "capstone",
    year: 2026,
    title: "Project",
    discoveredAt: "2026-10-09",
  });
  return value;
};

test("archive request deadline releases a stalled sync and preserves records for retry", async () => {
  let stalled = true;
  const payloads: unknown[] = [];
  const transport = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (stalled)
        return await new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
        });
      payloads.push(JSON.parse(String(init!.body)));
      return Response.json({ status: "success", value: null });
    },
    { preconnect: fetch.preconnect },
  );
  const sync = createIntakeSync(
    "https://example.convex.cloud",
    "fixture-secret",
    undefined,
    {
      fetch: transport,
      requestTimeoutMs: 20,
    },
  );
  const value = state();
  await expect(sync(value, true)).rejects.toThrow();
  stalled = false;
  await sync(value, true);
  expect(payloads).toHaveLength(2);
  expect(
    (payloads[0] as { args: [{ records: unknown[] }] }).args[0].records,
  ).toHaveLength(1);
  await sync(value, true);
  expect(payloads).toHaveLength(3); // Only status is sent after an acknowledged retry.
});

test("archive batches bound bytes and retry only records without acknowledgement", async () => {
  const value = state();
  value.candidates = [];
  for (let n = 0; n < 3; n++)
    preserveCandidate(value, `https://example.edu/project-${n}`, {
      schoolId: school.id,
      category: "capstone",
      year: 2026,
      title: "x".repeat(135_000),
      discoveredAt: "2026-10-09",
    });
  const batches: string[][] = [];
  let fail = true;
  const transport = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = JSON.parse(String(init!.body));
      if (request.path === "intake:recordBatch") {
        const records = request.args[0].records as { recordId: string }[];
        expect(Buffer.byteLength(JSON.stringify(records))).toBeLessThan(
          256_000,
        );
        batches.push(records.map((r) => r.recordId));
        if (batches.length === 2 && fail) {
          fail = false;
          throw new Error("Transient network failure");
        }
      }
      return Response.json({ status: "success", value: null });
    },
    { preconnect: fetch.preconnect },
  );
  const sync = createIntakeSync(
    "https://example.convex.cloud",
    "fixture-secret",
    undefined,
    { fetch: transport },
  );
  await expect(sync(value, true)).rejects.toThrow("Transient network failure");
  await sync(value, true);
  expect(batches).toHaveLength(4);
  expect(batches[2]).toEqual(batches[1]);
  expect(batches.slice(1).flat()).not.toContain(batches[0]![0]);
});

test("large candidate provenance is preserved losslessly in linked immutable records", async () => {
  const value = state();
  const candidate = value.candidates[0]!;
  const original = candidate.provenance[0]!;
  candidate.provenance = Array.from({ length: 1000 }, (_, n) => ({
    ...original,
    title: "x".repeat(400),
    parentUrl: `https://example.edu/project-${n}`,
  }));
  const stored = new Map<string, { revision: string; payload: string }>();
  const transport = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = JSON.parse(String(init!.body));
      for (const record of request.args[0].records ?? []) {
        expect(record.payload.length).toBeLessThanOrEqual(400_000);
        stored.set(record.recordId, record);
      }
      return Response.json({ status: "success", value: null });
    },
    { preconnect: fetch.preconnect },
  );
  const sync = createIntakeSync(
    "https://example.convex.cloud",
    "fixture-secret",
    undefined,
    { fetch: transport },
  );
  await sync(value, true);
  const parent = JSON.parse(stored.get(candidate.id)!.payload);
  expect(parent.associationCount).toBe(1000);
  const restored = parent.associationChunks.flatMap(
    (ref: { recordId: string; revision: string }) => {
      const record = stored.get(ref.recordId)!;
      expect(record.revision).toBe(ref.revision);
      const chunk = JSON.parse(record.payload);
      expect(chunk.candidateId).toBe(candidate.id);
      return chunk.associations;
    },
  );
  expect(restored).toEqual(candidate.provenance);
  expect(parent.url).toBe(candidate.url);
});
