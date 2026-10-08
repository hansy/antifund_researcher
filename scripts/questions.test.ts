import { beforeEach, afterEach, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import seed from "../data/corpus.json";
import { corpusSchema } from "../src/lib/contracts";
const corpus = corpusSchema.parse(seed);

const modules = {
  "../convex/questions.ts": () => import("../convex/questions"),
  "../convex/research.ts": () => import("../convex/research"),
  "../convex/corpus.ts": () => import("../convex/corpus"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
};
const secret = "test-capability-only";
const original = process.env.RESEARCH_WRITE_SECRET;
beforeEach(() => {
  process.env.RESEARCH_WRITE_SECRET = secret;
});
afterEach(() => {
  if (original === undefined) delete process.env.RESEARCH_WRITE_SECRET;
  else process.env.RESEARCH_WRITE_SECRET = original;
});
const request = {
  secret,
  clientKey: "a".repeat(64),
  text: "Where is simulation useful?",
};

test("writes require the capability and questions require a live runner", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.questions.enqueue, { ...request, secret: "wrong" }),
  ).rejects.toThrow("Unauthorized");
  await expect(t.mutation(api.questions.enqueue, request)).rejects.toThrow(
    "offline",
  );
  await t.mutation(api.questions.heartbeat, {
    secret,
    workerId: "test-worker",
  });
  const { id } = await t.mutation(api.questions.enqueue, request);
  const publicJob = await t.query(api.questions.get, { id });
  expect(publicJob?.status).toBe("queued");
  expect(publicJob).not.toHaveProperty("clientKey");
  expect(publicJob).not.toHaveProperty("leaseToken");
});

test("sixth client question is rejected even when the runner is online", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.questions.heartbeat, {
    secret,
    workerId: "test-worker",
  });
  for (let i = 0; i < 5; i++) await t.mutation(api.questions.enqueue, request);
  await expect(t.mutation(api.questions.enqueue, request)).rejects.toThrow(
    "Question limit reached",
  );
});

test("expired leases can be reclaimed once and stale workers cannot finish", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.questions.heartbeat, { secret, workerId: "first" });
  const { id } = await t.mutation(api.questions.enqueue, request);
  const first = await t.mutation(api.questions.claim, {
    secret,
    workerId: "first",
  });
  expect(first?.id).toBe(id);
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { leaseUntil: Date.now() - 1 });
  });
  const second = await t.mutation(api.questions.claim, {
    secret,
    workerId: "second",
  });
  expect(second?.leaseToken).not.toBe(first?.leaseToken);
  await expect(
    t.mutation(api.questions.finish, {
      secret,
      id,
      workerId: "first",
      leaseToken: first!.leaseToken,
      failed: true,
    }),
  ).rejects.toThrow("Lease expired");
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { leaseUntil: Date.now() - 1 });
  });
  expect(
    await t.mutation(api.questions.claim, { secret, workerId: "third" }),
  ).toBeNull();
  expect((await t.query(api.questions.get, { id }))?.status).toBe("failed");
});

test("ingestion is idempotent and completion rejects invented quotations", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.research.ingest, { secret, corpus });
  await t.mutation(api.research.ingest, { secret, corpus });
  expect((await t.query(api.corpus.get, {})).projects).toHaveLength(
    corpus.projects.length,
  );
  await t.mutation(api.questions.heartbeat, { secret, workerId: "worker" });
  const { id } = await t.mutation(api.questions.enqueue, request);
  const lease = await t.mutation(api.questions.claim, {
    secret,
    workerId: "worker",
  });
  const completion = {
    secret,
    id,
    workerId: "worker",
    leaseToken: lease!.leaseToken,
  };
  await expect(
    t.mutation(api.questions.finish, {
      ...completion,
      answer: {
        answer: "An unsupported claim",
        projectIds: [],
        followUps: [],
        citations: [
          {
            sourceId: corpus.sources[0]!.id,
            quote: "This invented quotation has no evidence.",
          },
        ],
      },
    }),
  ).rejects.toThrow("not grounded");
  await t.mutation(api.questions.finish, {
    ...completion,
    answer: {
      answer: "The collection cannot establish that.",
      projectIds: [],
      followUps: [],
      citations: [],
    },
  });
  expect((await t.query(api.questions.get, { id }))?.status).toBe("complete");
});
