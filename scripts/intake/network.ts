import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import type { Candidate, School } from "./model";
export const externalShowcaseDomains = ["devpost.com"];
export const within = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);
export function safeUrl(
  raw: string,
  schools: School[],
  proof?: Candidate["externalProof"],
): URL {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    isIP(u.hostname) ||
    u.hostname.endsWith(".localhost")
  )
    throw new Error(
      "Only public approved HTTPS hosts without credentials/ports are allowed",
    );
  const official = schools.some((s) => within(u.hostname, s.domain));
  if (!official) {
    const school = schools.find((s) => s.id === proof?.schoolId);
    const p = proof ? new URL(proof.officialUrl) : null;
    if (
      !(
        externalShowcaseDomains.some((d) => within(u.hostname, d)) ||
        (proof?.linkedHost && within(u.hostname, proof.linkedHost))
      ) ||
      !school ||
      !p ||
      p.protocol !== "https:" ||
      !within(p.hostname, school.domain)
    )
      throw new Error(
        "External showcase needs a preserved link from an official school source",
      );
  }
  return u;
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a! >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 192 && b === 2) ||
      (a === 203 && b === 0)
    );
  }
  const a = address.toLowerCase();
  return (
    isIP(a) === 6 &&
    /^[23]/.test(a) &&
    !a.startsWith("2001:db8:") &&
    !a.startsWith("2002:")
  );
}
export async function download(
  raw: string,
  schools: School[],
  proof?: Candidate["externalProof"],
  maxBytes = 25_000_000,
): Promise<{ bytes: Buffer; finalUrl: string; contentType: string }> {
  let u = safeUrl(raw, schools, proof);
  for (let redirect = 0; redirect <= 4; redirect++) {
    const addresses = await lookup(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("Host resolves to a private or reserved address");
    const address = addresses.find((a) => a.family === 4) ?? addresses[0]!;
    // Pin the validated address and prefer IPv4 on networks with broken IPv6.
    const response = await new Promise<Response>((resolve, reject) => {
      const req = request(
        u,
        {
          family: address.family,
          lookup: (_host, options, callback: (...args: any[]) => void) =>
            options.all
              ? callback(null, [address])
              : callback(null, address.address, address.family),
          signal: AbortSignal.timeout(30_000),
          headers: {
            "User-Agent":
              "AntifundResearcher/0.2 (public university research intake)",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes)
              req.destroy(new Error("Download exceeds byte budget"));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers.set(
                  name,
                  Array.isArray(value) ? value.join(", ") : value,
                );
            const status = res.statusCode ?? 502;
            resolve(
              new Response(
                [204, 304].includes(status) ? null : Buffer.concat(chunks),
                { status, headers },
              ),
            );
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirect === 4)
        throw new Error("Redirect limit or missing location");
      u = safeUrl(new URL(location, u).href, schools, proof);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("Download exceeds byte budget");
    }
    if (!response.body) throw new Error("Empty response body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Download exceeds byte budget");
      }
      chunks.push(chunk.value);
    }
    return {
      bytes: Buffer.concat(chunks),
      finalUrl: u.href,
      contentType: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error("Redirect limit");
}
export function htmlText(html: string) {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff)),
    )
    .replace(/[ \t]+/g, " ")
    .trim();
}
/** Archive pagination and project links are enumerated without a topical/domain prefilter. */
export function pageLinks(
  html: string,
  base: string,
): { url: string; title: string }[] {
  const output = new Map<string, { url: string; title: string }>();
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const url = new URL(
        (match[1] ?? match[2] ?? match[3]!).replace(/&amp;/g, "&"),
        base,
      );
      url.hash = "";
      if (
        url.protocol !== "https:" ||
        /\.(?:png|jpe?g|gif|svg|css|js|zip|mp4|mp3|woff2?)(?:$|\?)/i.test(
          url.pathname,
        )
      )
        continue;
      output.set(url.href, { url: url.href, title: htmlText(match[4]!) });
    } catch {
      /* malformed href */
    }
  }
  return [...output.values()];
}
