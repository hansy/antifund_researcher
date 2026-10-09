import { htmlText } from "./intake/network";

type Element = {
  tag: string;
  attrs: Map<string, string>;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  parent: Element | null;
  children: Element[];
};

// A small structural index, not a browser DOM. Offsets preserve the source verbatim.
function elements(html: string): Element[] {
  const result: Element[] = [];
  const stack: Element[] = [];
  const tokens =
    /<!--[\s\S]*?-->|<(script|style|noscript)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<\/?[a-z][a-z0-9:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
  const voids = new Set(
    "area base br col embed hr img input link meta param source track wbr".split(
      " ",
    ),
  );
  for (const match of html.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith("<!--") || match[1]) continue;
    const tag = /^<\/?([\w:-]+)/.exec(token)?.[1]?.toLowerCase();
    if (!tag) continue;
    const start = match.index;
    if (token.startsWith("</")) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index]?.tag !== tag) index--;
      if (index < 0) continue;
      for (const node of stack.splice(index)) {
        node.contentEnd = start;
        node.end = start + token.length;
      }
      continue;
    }
    const attrs = new Map<string, string>();
    const attributeText = token.slice(tag.length + 1, -1);
    for (const attr of attributeText.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const parent = stack.at(-1) ?? null;
    const node: Element = {
      tag,
      attrs,
      start,
      contentStart: start + token.length,
      contentEnd: start + token.length,
      end: start + token.length,
      parent,
      children: [],
    };
    parent?.children.push(node);
    result.push(node);
    if (!voids.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  return result;
}

function inside(node: Element, ancestor: Element): boolean {
  return node.start > ancestor.start && node.end <= ancestor.end;
}
function hasClass(node: Element, value: string): boolean {
  return (node.attrs.get("class") ?? "").split(/\s+/).includes(value);
}
function inPagination(node: Element): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      hasClass(parent, "pagination") ||
      parent.attrs.get("aria-label")?.toLowerCase() === "pagination"
    )
      return true;
  }
  return false;
}
function contents(html: string, node: Element): string {
  return html.slice(node.contentStart, node.contentEnd);
}
function href(node: Element, base: string): URL | null {
  try {
    const raw = node.attrs.get("href");
    if (!raw) return null;
    const url = new URL(htmlText(raw), base);
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function projectUrl(url: URL): string | null {
  if (
    !["devpost.com", "www.devpost.com"].includes(url.hostname) ||
    !/^\/software\/[a-z0-9][a-z0-9_-]*\/?$/i.test(url.pathname)
  )
    return null;
  return `https://devpost.com${url.pathname.replace(/\/$/, "")}`;
}

export function extractDevpostGallery(
  html: string,
  pageUrl: string,
): {
  projectUrls: string[];
  totalProjects: number | null;
  lastPage: number | null;
} {
  const nodes = elements(html);
  const gallery = nodes.find(
    (node) => node.attrs.get("id") === "submission-gallery",
  );
  const projectUrls = new Set<string>();
  const totals = new Set<number>();
  let lastPage: number | null = null;
  for (const node of nodes) {
    if (node.tag === "a" && (!gallery || inside(node, gallery))) {
      const url = href(node, pageUrl);
      const project = url && projectUrl(url);
      if (project && (gallery || hasClass(node, "link-to-software")))
        projectUrls.add(project);
    }
    if (
      gallery &&
      inside(node, gallery) &&
      (hasClass(node, "items_info") ||
        hasClass(node, "submission-count") ||
        hasClass(node, "projects-count") ||
        (node.parent === gallery && /^h[1-6]$/.test(node.tag)))
    ) {
      const text = htmlText(contents(html, node));
      const count =
        /^\s*([\d,]+)\s+(?:submissions|projects)\s*$/i.exec(text)?.[1] ??
        /\bof\s+([\d,]+)\s*$/i.exec(text)?.[1];
      if (count) totals.add(Number(count.replaceAll(",", "")));
    }
    if (node.tag === "a" && inPagination(node)) {
      const url = href(node, pageUrl);
      if (
        !url ||
        url.origin !== new URL(pageUrl).origin ||
        url.pathname !== new URL(pageUrl).pathname
      )
        continue;
      const page = url.searchParams.get("page");
      if (page && /^[1-9]\d*$/.test(page))
        lastPage = Math.max(lastPage ?? 1, Number(page));
    }
  }
  return {
    projectUrls: [...projectUrls],
    totalProjects: totals.size === 1 ? [...totals][0]! : null,
    lastPage,
  };
}

export function extractDevpostProject(
  html: string,
  url: string,
): {
  title: string;
  authors: string[];
  story: string;
  storyQuote: string;
  eventUrls: string[];
  year: number | null;
} | null {
  try {
    if (!projectUrl(new URL(url))) return null;
  } catch {
    return null;
  }
  const nodes = elements(html);
  const header = nodes.find(
    (node) => node.attrs.get("id") === "software-header",
  );
  const titles = nodes.filter(
    (node) =>
      node.tag === "h1" &&
      node.attrs.get("id") === "app-title" &&
      header &&
      inside(node, header),
  );
  const article = nodes.find(
    (node) => node.tag === "article" && node.attrs.get("id") === "app-details",
  );
  const left = nodes.find(
    (node) =>
      node.attrs.get("id") === "app-details-left" &&
      article &&
      inside(node, article),
  );
  if (titles.length !== 1 || !left) return null;
  // Devpost's rendered story is the unlabelled direct div before Built With.
  // Restrict this to known structure; cards, screenshot captions and nav are not stories.
  const stories = left.children.filter(
    (node) =>
      node.tag === "div" &&
      !node.attrs.has("id") &&
      !node.attrs.has("class") &&
      node.children.some((child) => child.tag === "p"),
  );
  if (stories.length !== 1) return null;
  const title = htmlText(contents(html, titles[0]!));
  const story = htmlText(contents(html, stories[0]!));
  const retained = htmlText(html);
  if (!title || !story || !retained.includes(story)) return null;
  const storyQuote = story.slice(0, 600);
  const team = nodes.find(
    (node) =>
      node.attrs.get("id") === "app-team" && article && inside(node, article),
  );
  const submissions = nodes.find(
    (node) =>
      node.attrs.get("id") === "submissions" &&
      article &&
      inside(node, article),
  );
  const authors = new Set<string>();
  const eventUrls = new Set<string>();
  const years = new Set<number>();
  let conflictingYear = false;
  for (const node of nodes) {
    if (node.tag !== "a") continue;
    if (team && inside(node, team) && hasClass(node, "user-profile-link")) {
      const name = htmlText(contents(html, node));
      if (name) authors.add(name);
    }
    if (!submissions || !inside(node, submissions)) continue;
    const event = href(node, url);
    if (
      !event ||
      !/^[a-z0-9-]+\.devpost\.com$/i.test(event.hostname) ||
      event.pathname !== "/"
    )
      continue;
    eventUrls.add(`https://${event.hostname}/`);
    const labelYears = [
      ...htmlText(contents(html, node)).matchAll(/\b(20\d{2})\b/g),
    ].map((match) => Number(match[1]));
    const slugYears = [...event.hostname.matchAll(/\b(20\d{2})\b/g)].map(
      (match) => Number(match[1]),
    );
    for (const year of labelYears) {
      if (slugYears.length && !slugYears.includes(year)) conflictingYear = true;
      years.add(year);
    }
  }
  return {
    title,
    authors: [...authors],
    story,
    storyQuote,
    eventUrls: [...eventUrls],
    year: !conflictingYear && years.size === 1 ? [...years][0]! : null,
  };
}
