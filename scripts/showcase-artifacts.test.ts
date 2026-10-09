import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, preserveCandidate, hash } from "./intake/model";
import { importShowcaseArtifacts } from "./showcase-artifacts";
test("retained large PDF resolves download failure and remains queued for page parsing", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcase-artifact-"));
  try {
    const source = {
      schoolId: "mit",
      year: 2025 as const,
      category: "capstone" as const,
      title: "HeartBridge",
      url: "https://www.009cycles.com/products/green-product-sheet.pdf",
    };
    const state = emptyState([]);
    const c = preserveCandidate(state, source.url, {
      ...source,
      discoveredAt: "2026-10-09",
    });
    c.status = "failed";
    c.failures.push({
      at: "2026-10-09",
      stage: "collect",
      message: "Byte limit",
      retryAfter: "2099-01-01",
    });
    const bytes = Buffer.from("%PDF-1.7 retained test bytes");
    await writeFile(join(root, "mit-2025-green-product-sheet.pdf"), bytes);
    await importShowcaseArtifacts(state, [source], root, root);
    expect(state.candidates[0]?.status).toBe("pending");
    expect(c.revisions[0]?.hash).toBe(hash(bytes));
    expect(c.revisions[0]?.kind).toBe("pdf");
    expect(c.revisions[0]?.parseStatus).toBe("pending");
    expect(c.failures[0]?.resolvedAt).toBeTruthy();
    await importShowcaseArtifacts(state, [source], root, root);
    expect(c.revisions).toHaveLength(1);
    const imagePath = join(root, "page.png");
    await writeFile(imagePath, "rendered page");
    await writeFile(
      join(root, "mit-2025-green-visual-transcription.json"),
      JSON.stringify({
        sourceHash: hash(bytes),
        imagePath,
        imageHash: hash("rendered page"),
        page: 1,
        text: "Visually checked product description.",
      }),
    );
    await importShowcaseArtifacts(state, [source], root, root);
    expect(state.candidates[0]?.status).toBe("downloaded");
    expect(c.revisions[0]?.pages).toBe(1);
    expect(c.revisions[0]?.parseStatus).toBe("done");
    expect(c.revisions[0]?.hash).toBe(hash(bytes));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("visual roster import refuses changed original evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "showcase-artifact-"));
  try {
    const source = {
      schoolId: "stanford",
      year: 2026 as const,
      category: "capstone" as const,
      title: "ME170",
      url: "https://me170.stanford.edu/class-projects/2026-class",
    };
    const imagePath = join(root, "image.png");
    await writeFile(imagePath, "changed");
    await writeFile(
      join(root, "stanford-me170-2026-roster.json"),
      JSON.stringify({
        sourceUrl: source.url,
        accessedAt: "2026-10-09",
        artifacts: [
          {
            url: "https://example.edu/image.png",
            rawPath: imagePath,
            sha256: hash("original"),
          },
        ],
        projects: Array.from({ length: 14 }, () => ({
          title: "Team",
          authors: [],
          visibleText: "Brief",
          imageUrl: "https://example.edu/image.png",
        })),
        unresolved: [],
      }),
    );
    expect(
      importShowcaseArtifacts(emptyState([]), [source], root, root),
    ).rejects.toThrow("artifact hash mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
