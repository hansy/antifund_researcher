import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireSecret } from "./security";
import { answer } from "./validators";
import { LEASE_MS, leaseMatches, validateAnswer } from "../scripts/validation";
export const enqueue = mutation({
  args: { secret: v.string(), clientKey: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const text = args.text.trim();
    if (
      text.length < 8 ||
      text.length > 1200 ||
      !/^[a-f0-9]{64}$/.test(args.clientKey)
    )
      throw new Error("Invalid question");
    const now = Date.now();
    const worker = await ctx.db
      .query("worker")
      .withIndex("by_key", (q) => q.eq("key", "active"))
      .unique();
    if (!worker || now - worker.seenAt > 90_000)
      throw new Error(
        "Live research is offline. You can still explore the index.",
      );
    const client = await ctx.db
      .query("questions")
      .withIndex("by_client_created", (q) =>
        q.eq("clientKey", args.clientKey).gt("createdAt", now - 3_600_000),
      )
      .take(5);
    if (client.length >= 5)
      throw new Error("Question limit reached. Try again later.");
    const daily = await ctx.db
      .query("questions")
      .withIndex("by_created", (q) => q.gt("createdAt", now - 86_400_000))
      .take(100);
    if (daily.length >= 100)
      throw new Error("Daily question capacity reached.");
    const queued = await ctx.db
      .query("questions")
      .withIndex("by_status_created", (q) => q.eq("status", "queued"))
      .take(20);
    const running = await ctx.db
      .query("questions")
      .withIndex("by_status_created", (q) => q.eq("status", "running"))
      .take(20);
    if (queued.length + running.length >= 20)
      throw new Error("Question queue is full. Try again later.");
    const id = await ctx.db.insert("questions", {
      text,
      clientKey: args.clientKey,
      createdAt: now,
      status: "queued",
    });
    return { id };
  },
});
export const get = query({
  args: { id: v.id("questions") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id);
    if (!job) return null;
    return {
      id: job._id,
      text: job.text,
      createdAt: job.createdAt,
      status: job.status,
      answer: job.answer ?? null,
      error: job.error ?? null,
    };
  },
});
export const claim = mutation({
  args: { secret: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!/^[a-z0-9-]{1,80}$/i.test(args.workerId))
      throw new Error("Invalid worker");
    const now = Date.now();
    const running = await ctx.db
      .query("questions")
      .withIndex("by_status_created", (q) => q.eq("status", "running"))
      .take(20);
    for (const stale of running.filter(
      (job) => (job.leaseUntil ?? 0) <= now && (job.attempts ?? 0) >= 2,
    )) {
      await ctx.db.patch(stale._id, {
        status: "failed",
        error: "This question timed out. Please try again.",
        leaseToken: undefined,
        leaseUntil: undefined,
        workerId: undefined,
      });
    }
    const expired = running.find(
      (job) => (job.leaseUntil ?? 0) <= now && (job.attempts ?? 0) < 2,
    );
    const job =
      expired ??
      (await ctx.db
        .query("questions")
        .withIndex("by_status_created", (q) => q.eq("status", "queued"))
        .first());
    if (!job) return null;
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(job._id, {
      status: "running",
      attempts: (job.attempts ?? 0) + 1,
      workerId: args.workerId,
      leaseToken,
      leaseUntil: now + LEASE_MS,
    });
    return {
      id: job._id,
      text: job.text,
      leaseToken,
      leaseUntil: now + LEASE_MS,
    };
  },
});
export const finish = mutation({
  args: {
    secret: v.string(),
    id: v.id("questions"),
    workerId: v.string(),
    leaseToken: v.string(),
    answer: v.optional(answer),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const job = await ctx.db.get(args.id);
    if (!job || !leaseMatches(job, args.workerId, args.leaseToken, Date.now()))
      throw new Error("Lease expired or not owned");
    if (args.failed || !args.answer) {
      await ctx.db.patch(job._id, {
        status: "failed",
        error:
          "The research runner could not produce a grounded answer. Please try again.",
        leaseToken: undefined,
        leaseUntil: undefined,
        workerId: undefined,
      });
    } else {
      const projects = await ctx.db.query("projects").collect();
      const sources = await ctx.db.query("sources").collect();
      const result = validateAnswer(args.answer, { projects, sources });
      await ctx.db.patch(job._id, {
        status: "complete",
        answer: result,
        error: undefined,
        leaseToken: undefined,
        leaseUntil: undefined,
        workerId: undefined,
      });
    }
    return true;
  },
});
export const heartbeat = mutation({
  args: { secret: v.string(), workerId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query("worker")
      .withIndex("by_key", (q) => q.eq("key", "active"))
      .unique();
    const value = {
      key: "active",
      workerId: args.workerId,
      seenAt: Date.now(),
    };
    if (row) await ctx.db.replace(row._id, value);
    else await ctx.db.insert("worker", value);
  },
});
export const workerStatus = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("worker")
      .withIndex("by_key", (q) => q.eq("key", "active"))
      .unique();
    return {
      online: !!row && Date.now() - row.seenAt < 90_000,
      lastSeenAt: row?.seenAt ?? null,
    };
  },
});
