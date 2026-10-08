import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

// All visitor text and source excerpts are untrusted. Never grant this child tools.
// Codex 0.157.1: `features shell_tool` gates exec; apply_patch is gated by
// model_info.apply_patch_tool_type separately (official tools/spec_plan.rs).
export const NO_TOOL_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "in_app_browser",
  "multi_agent",
  "multi_agent_v2",
  "view_image",
  "workspace_dependencies",
  "code_mode",
  "code_mode_host",
  "goals",
  "tool_suggest",
  "skill_search",
  "memories",
  "sleep_tool",
  "request_permissions_tool",
  "remote_control",
  "remote_plugin",
  "daemon_auto_start",
];
export function safeCatalog(
  catalog: { models: Record<string, unknown>[] },
  model: string,
) {
  const info = catalog.models.find((m) => m.slug === model);
  if (!info)
    throw new Error(
      `Model ${model} is unavailable in the installed Codex catalog. Set RESEARCH_MODEL to an available subscription model.`,
    );
  return {
    models: [
      {
        ...info,
        shell_type: "disabled",
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
      },
    ],
  };
}
export function safeChildEnv(scratch: string) {
  // A whitelist is essential: RESEARCH_WRITE_SECRET and Convex credentials never
  // enter the model process. Only CODEX_HOME preserves subscription authentication.
  const node = Bun.which("node");
  const commandPath = [
    node ? dirname(node) : "",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
    .filter(Boolean)
    .join(":");
  return {
    HOME: scratch,
    CODEX_HOME:
      process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex"),
    PATH: commandPath,
    TMPDIR: scratch,
    LANG: "en_US.UTF-8",
  };
}
export function strictSchema(node: any): any {
  if (!node || typeof node !== "object") return node;
  const copy: any = Array.isArray(node)
    ? node.map(strictSchema)
    : Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, strictSchema(value)]),
      );
  // Zod still validates URLs locally; the strict output API does not accept URI format.
  if (copy.format === "uri") delete copy.format;
  if (copy.type === "object" && copy.properties) {
    const required = new Set(copy.required ?? []);
    for (const key of Object.keys(copy.properties))
      if (!required.has(key))
        copy.properties[key] = {
          anyOf: [copy.properties[key], { type: "null" }],
        };
    copy.required = Object.keys(copy.properties);
    copy.additionalProperties = false;
  }
  return copy;
}
function omitNulls(value: any): any {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, omitNulls(item)]),
    );
  return value;
}
export async function runCodex<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: { discovery?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const executable = Bun.which(process.env.RESEARCH_CODEX_COMMAND || "codex");
  if (!executable)
    throw new Error("Install the subscription-authenticated Codex CLI first.");
  const scratch = await mkdtemp(join(tmpdir(), "antifund-codex-"));
  const model = process.env.RESEARCH_MODEL ?? "gpt-6.1-sol";
  try {
    const catalogProcess = Bun.spawn([executable, "debug", "models"], {
      cwd: scratch,
      env: safeChildEnv(scratch),
      stdout: "pipe",
      stderr: "ignore",
      timeout: 15_000,
    });
    const catalogText = await new Response(catalogProcess.stdout).text();
    if ((await catalogProcess.exited) !== 0)
      throw new Error("Could not inspect Codex model catalog");
    const catalog = JSON.parse(catalogText);
    const catalogFile = join(scratch, "models.json");
    await writeFile(catalogFile, JSON.stringify(safeCatalog(catalog, model)));
    const schemaFile = join(scratch, "schema.json");
    const outputFile = join(scratch, "answer.json");
    // OpenAI strict structured output requires required nullable optional fields.
    await writeFile(
      schemaFile,
      JSON.stringify(
        strictSchema(z.toJSONSchema(schema, { target: "draft-7" })),
      ),
    );
    const argv = [
      executable,
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "-C",
      scratch,
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "-m",
      model,
      "-c",
      'model_reasoning_effort="medium"',
      "-c",
      'web_search="disabled"',
      "-c",
      `model_catalog_json=${JSON.stringify(catalogFile)}`,
      "--output-schema",
      schemaFile,
      "-o",
      outputFile,
    ];
    for (const feature of NO_TOOL_FEATURES) {
      if (
        options.discovery &&
        ["code_mode", "code_mode_host"].includes(feature)
      )
        continue;
      argv.push("--disable", feature);
    }
    argv.push("--enable", "skip_host_skill_discovery");
    // Discovery uses only hosted web search, still no shell/files/plugins or apps.
    // The operator supplies fixed official university URLs; visitors never enter it.
    if (options.discovery)
      argv.push(
        "--enable",
        "code_mode",
        "--enable",
        "code_mode_host",
        "-c",
        'web_search="live"',
      );
    argv.push("-");
    const child = Bun.spawn(argv, {
      cwd: scratch,
      env: safeChildEnv(scratch),
      stdin: new TextEncoder().encode(prompt),
      stdout: "ignore",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 180_000);
    // Drain diagnostics, but never print them (may contain visitor data).
    const diagnostics = new Response(child.stderr).text();
    const code = await child.exited;
    clearTimeout(timer);
    const diagnosticText = await diagnostics;
    if (timedOut) throw new Error("Codex execution timed out");
    if (code !== 0) {
      const log = join(
        process.cwd(),
        ".research-cache",
        "last-codex-error.log",
      );
      await mkdir(dirname(log), { recursive: true });
      await writeFile(log, diagnosticText, { mode: 0o600 });
      throw new Error(
        `Codex failed (${code}); operator diagnostics: .research-cache/last-codex-error.log`,
      );
    }
    return schema.parse(
      omitNulls(JSON.parse(await readFile(outputFile, "utf8"))),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
