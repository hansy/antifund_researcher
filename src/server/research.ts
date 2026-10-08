import { env } from "cloudflare:workers";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { corpusSchema } from "../lib/contracts";

type Bindings = { CONVEX_URL?: string; RESEARCH_WRITE_SECRET?: string };

function settings() {
  const values = env as Bindings;
  if (!values.CONVEX_URL || !values.RESEARCH_WRITE_SECRET)
    throw new Error("Research service is not configured.");
  return {
    client: new ConvexHttpClient(values.CONVEX_URL, {
      // Bun's ambient types add fetch.preconnect; Convex only calls the function.
      fetch: ((input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.timeout(15_000),
        })) as typeof fetch,
    }),
    secret: values.RESEARCH_WRITE_SECRET,
  };
}

export async function corpus() {
  const { client } = settings();
  return corpusSchema.parse(await client.query(api.corpus.get, {}));
}

export async function enqueue(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Expected a question." }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return Response.json({ error: "Question is too long." }, { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return Response.json(
          { error: "Question is too long." },
          { status: 413 },
        );
      }
      chunks.push(chunk.value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid question." }, { status: 400 });
  }
  const text =
    body && typeof body === "object" && "text" in body ? body.text : null;
  if (
    typeof text !== "string" ||
    text.trim().length < 8 ||
    text.trim().length > 1200
  )
    return Response.json({ error: "Use 8–1,200 characters." }, { status: 400 });
  const { client, secret } = settings();
  const ip = request.headers.get("cf-connecting-ip") || "local-preview";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${ip}`),
  );
  const clientKey = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const result = await client.mutation(api.questions.enqueue, {
    secret,
    clientKey,
    text: text.trim(),
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function question(id: string) {
  const { client } = settings();
  return client.query(api.questions.get, {
    id: id as import("../../convex/_generated/dataModel").Id<"questions">,
  });
}

export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const publicMessages = [
    "Live research is offline. You can still explore the index.",
    "Question limit reached. Try again later.",
    "Daily question capacity reached.",
    "Question queue is full. Try again later.",
  ];
  const publicMessage = publicMessages.find((value) => message.includes(value));
  if (publicMessage)
    return Response.json(
      { error: publicMessage },
      {
        status: publicMessage.startsWith("Live") ? 503 : 429,
        headers: { "Cache-Control": "no-store" },
      },
    );
  console.error("Research request failed");
  return Response.json(
    { error: "Research is temporarily unavailable. Please try again shortly." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
