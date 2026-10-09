import { htmlText } from "./intake/network";

/** These galleries have one numbered h2/h3 per abstract, separate from their TOC. */
export function extractWaterlooProjects(html: string) {
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  return headings.flatMap((heading, index) => {
    const title = htmlText(heading[2]!).replace(/\s+/g, " ").trim();
    if (!/^\d+[.)]\s*\S/.test(title)) return [];
    const end = headings[index + 1]?.index ?? html.length;
    const block = htmlText(html.slice(heading.index, end)).trim();
    // Footer material after the last project is not part of its abstract.
    const story = block
      .split(
        /\n\s*(?:Contact us|Contact information|Share this page|University of Waterloo)\s*\n/i,
      )[0]!
      .trim();
    return [{ title, story, number: Number(/^\d+/.exec(title)![0]) }];
  });
}
