import { expect, test, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkpoint,
  classify,
  emptyState,
  intakeMain,
  preserveCandidate,
} from "./intake";
import type { runCodex } from "./codex";

test("intake CLI reads the requested archive instead of canonical state", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-cli-"));
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const state = emptyState([]);
    preserveCandidate(state, "https://example.edu/projects/isolated", {
      schoolId: "test",
      category: "capstone",
      year: 2026,
      discoveredAt: "2026-10-08",
      title: "Isolated archive",
    });
    await checkpoint(state, { root });
    const loaded = await intakeMain(["status", "--root", root]);
    expect(loaded.candidates.map((candidate) => candidate.url)).toEqual([
      "https://example.edu/projects/isolated",
    ]);
  } finally {
    log.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("missing archive path cannot silently select canonical intake", async () => {
  await expect(intakeMain(["status", "--root"])).rejects.toThrow(
    "--root requires an archive directory",
  );
  await expect(
    intakeMain(["status", "--root", "--budget", "2"]),
  ).rejects.toThrow("--root requires an archive directory");
});

test("smaller classification chunks retain the source tail and existing chunk positions", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-chunks-"));
  try {
    const state = emptyState([]);
    const candidate = preserveCandidate(
      state,
      "https://example.edu/projects/dense",
      {
        schoolId: "test",
        category: "research",
        year: 2026,
        discoveredAt: "2026-10-08",
        title: "Dense archive",
      },
    );
    const textPath = join(root, "source.txt");
    const text = "x".repeat(8990) + "SOURCE TAIL";
    await writeFile(textPath, text);
    candidate.revisions.push({
      hash: "retained",
      requestedUrl: candidate.url,
      finalUrl: candidate.url,
      accessedAt: "2026-10-08",
      kind: "html",
      rawPath: textPath,
      textPath,
      parseStatus: "done",
    });
    const key = `${candidate.id}:retained`;
    state.classification[key] = {
      nextChunk: 0,
      done: false,
      failures: [],
      chunkSize: 8000,
    };
    const chunks: string[] = [];
    const agent: typeof runCodex = async (prompt, schema) => {
      chunks.push(prompt.split("UNTRUSTED EVIDENCE:\n")[1]!);
      return schema.parse({ items: [], ambiguity: "No identifiable project" });
    };
    await classify(state, { root, agent, budget: 10 });
    expect(state.classification[key]!.chunkSize).toBe(4000);
    expect(state.classification[key]!.done).toBe(true);
    expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
    expect(chunks.at(-1)).toContain("SOURCE TAIL");
    chunks.length = 0;
    state.classification[key] = {
      nextChunk: 1,
      done: false,
      failures: [],
      chunkSize: 8000,
    };
    await classify(state, { root, agent, budget: 10 });
    expect(state.classification[key]!.chunkSize).toBe(8000);
    expect(chunks[0]).toBe(text.slice(7000, 15000));
    expect(chunks.at(-1)).toContain("SOURCE TAIL");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
