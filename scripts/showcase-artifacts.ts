import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash, preserveCandidate, type State } from "./intake/model";
import { retainProject } from "./showcase-seeding";
import type { ShowcaseSource } from "./showcase-intake";

/** Reuse verified research-worker downloads. Their original bytes remain the evidence. */
export async function importShowcaseArtifacts(
  state: State,
  sources: ShowcaseSource[],
  discoveryRoot: string,
  root: string,
) {
  for (const source of sources) {
    const match =
      /^https:\/\/www\.009cycles\.com\/products\/(green|purple|red|blue|yellow|pink)-product-sheet\.pdf$/.exec(
        source.url,
      );
    if (!match) continue;
    const rawPath = resolve(
      discoveryRoot,
      `mit-2025-${match[1]}-product-sheet.pdf`,
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(rawPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new Error(`Invalid retained PDF: ${source.url}`);
    const accessedAt = (await stat(rawPath)).mtime.toISOString();
    const candidate = preserveCandidate(
      state,
      source.url,
      {
        schoolId: source.schoolId,
        category: source.category,
        year: source.year,
        title: source.title,
        discoveredAt: accessedAt,
        discoveryRationale:
          "Previously downloaded source; snapshot filesystem timestamp retained. Parse the original PDF with page markers.",
      },
      0,
    );
    candidate.externalProof = source.externalProof;
    const digest = hash(bytes);
    if (!candidate.revisions.some((r) => r.hash === digest)) {
      candidate.revisions.push({
        hash: digest,
        requestedUrl: source.url,
        finalUrl: source.url,
        accessedAt,
        kind: "pdf",
        rawPath,
        parseStatus: "pending",
      });
      candidate.status = "pending";
      // Download failures are resolved by the retained copy, not discarded.
      for (const failure of candidate.failures)
        if (!failure.resolvedAt) failure.resolvedAt = new Date().toISOString();
    }
    // A reviewed transcription repairs scanned text while retaining PDF identity.
    const transcriptionPath = join(
      discoveryRoot,
      `mit-2025-${match[1]}-visual-transcription.json`,
    );
    let transcription: {
      sourceHash: string;
      imagePath: string;
      imageHash: string;
      page: number;
      text: string;
    };
    try {
      transcription = JSON.parse(await readFile(transcriptionPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      transcription.sourceHash !== digest ||
      transcription.page !== 1 ||
      hash(await readFile(transcription.imagePath)) !== transcription.imageHash
    )
      throw new Error("Reviewed PDF transcription evidence mismatch");
    const revision = candidate.revisions.find((r) => r.hash === digest)!;
    const textPath = rawPath + ".visual.txt";
    await writeFile(
      textPath,
      `[PDF PAGE 1]\n[Visual transcription; original PDF/image retained. Student specifications and proposed prices are unverified claims.]\n${transcription.text}`,
      { mode: 0o600 },
    );
    revision.textPath = textPath;
    revision.pages = 1;
    revision.parseStatus = "done";
    delete revision.failure;
    candidate.status = "downloaded";
    for (const failure of candidate.failures)
      if (!failure.resolvedAt) failure.resolvedAt = new Date().toISOString();
  }

  const source = sources.find(
    (s) => s.url === "https://me170.stanford.edu/class-projects/2026-class",
  );
  if (!source) return;
  const rawPath = resolve(discoveryRoot, "stanford-me170-2026-roster.json");
  let bytes: Buffer;
  try {
    bytes = await readFile(rawPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const roster = JSON.parse(bytes.toString()) as {
    sourceUrl: string;
    accessedAt: string;
    artifacts: { url: string; rawPath: string; sha256: string }[];
    projects: {
      title: string;
      authors: string[];
      visibleText: string;
      imageUrl: string;
    }[];
    unresolved: string[];
  };
  if (roster.sourceUrl !== source.url || roster.projects.length !== 14)
    throw new Error("Stanford transcription roster mismatch");
  for (const artifact of roster.artifacts)
    if (hash(await readFile(artifact.rawPath)) !== artifact.sha256)
      throw new Error("Stanford transcription artifact hash mismatch");
  if (
    roster.projects.some(
      (p) => !roster.artifacts.some((a) => a.url === p.imageUrl),
    )
  )
    throw new Error("Stanford transcription image missing");
  const candidate = preserveCandidate(
    state,
    source.url,
    {
      schoolId: source.schoolId,
      category: source.category,
      year: source.year,
      title: source.title,
      discoveredAt: roster.accessedAt,
      discoveryRationale:
        "Visually transcribed official roster images; original HTML/images and hashes retained. Design briefs are goals, not demonstrated results.",
    },
    0,
  );
  const digest = hash(bytes);
  const directory = resolve(root, "transcriptions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const textPath = join(directory, `${digest}.txt`);
  const text = [
    "Stanford ME170 2026 — visual transcription of official roster images.",
    "The following are design briefs, not demonstrated outcomes. Individual authors were not listed.",
    ...roster.projects.map(
      (p) => `${p.title}\n${p.visibleText}\nIMAGE SOURCE ${p.imageUrl}`,
    ),
    ...roster.unresolved,
  ].join("\n\n");
  await writeFile(textPath, text, { mode: 0o600 });
  let revision = candidate.revisions.find((r) => r.hash === digest);
  if (!revision) {
    revision = {
      hash: digest,
      requestedUrl: source.url,
      finalUrl: source.url,
      accessedAt: roster.accessedAt,
      kind: "html",
      rawPath,
      textPath,
      parseStatus: "done",
    };
    candidate.revisions.push(revision);
  }
  candidate.status = "downloaded";
  for (const project of roster.projects)
    retainProject(state, candidate, revision, {
      title: project.title,
      story: project.visibleText,
      authors: project.authors,
    });
  state.classification[`${candidate.id}:${digest}`] = {
    nextChunk: 1,
    done: true,
    failures: [],
    method: "structured-v1",
  };
}
