import { htmlText } from "./intake/network";
/** Official Fung showcase cards include full descriptions even when visually collapsed. */
export function extractBerkeleyProjects(html: string) {
  const headings = [
    ...html.matchAll(
      /<h4\b[^>]*class=["'][^"']*cc-highlights__section__post__title[^"']*["'][^>]*>([\s\S]*?)<\/h4>/gi,
    ),
  ];
  return headings.map((heading, index) => {
    const start = heading.index!;
    const block = html.slice(start, headings[index + 1]?.index ?? html.length);
    const opening =
      /<div\b[^>]*class=["'][^"']*cc-highlights__section__post__content[^"']*["'][^>]*>/i.exec(
        block,
      );
    if (!opening)
      throw new Error("Fung project card missing its description container");
    const tokens = /<\/?div\b[^>]*>/gi;
    tokens.lastIndex = opening.index + opening[0].length;
    let depth = 1,
      end = 0;
    for (let token; (token = tokens.exec(block));) {
      depth += token[0].startsWith("</") ? -1 : 1;
      if (!depth) {
        end = tokens.lastIndex;
        break;
      }
    }
    if (!end) throw new Error("Fung project description is truncated");
    const title = htmlText(heading[1]!);
    const story = htmlText(block.slice(0, end));
    return { title, story, authors: [] as string[] };
  });
}
