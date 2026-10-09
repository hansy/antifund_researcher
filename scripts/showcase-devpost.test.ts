import { expect, test } from "bun:test";
import { htmlText } from "./intake/network";
import {
  extractDevpostGallery,
  extractDevpostProject,
} from "./showcase-devpost";

const galleryUrl = "https://treehacks-2026.devpost.com/project-gallery";
const projectUrl = "https://devpost.com/software/real-project";
const story = `<p>We built a sensor &amp; a dashboard.</p><h2>How we built it</h2><p>${"Actual development detail. ".repeat(70)}</p><p>Future work remains untested.</p>`;
function project(
  options: { story?: string; event?: string; extra?: string } = {},
) {
  return `<nav><h1>Explore projects</h1><h2>Fake card title</h2></nav>
  <header id="software-header"><h1 id="app-title">Real &amp; precise</h1></header>
  <article id="app-details"><div id="app-details-left">
  <div id="app-gallery"><p>Screenshot caption</p></div>
  <div>${options.story ?? story}</div>
  <div id="built-with"><h2>Built With</h2><a href="/software/built-with/python">python</a></div>
  <nav><h2>Try it out</h2></nav></div>
  <aside><div id="submissions"><a href="https://treehacks-2026.devpost.com/"><img alt="Invented event" /></a>
  ${options.event ?? '<a href="https://treehacks-2026.devpost.com/">TreeHacks 2026</a>'}</div>
  <section id="app-team"><a class="user-profile-link" href="/ada"><img alt="Wrong guessed name"></a><a class="user-profile-link" href="/ada">Ada Example</a><a class="user-profile-link" href="/ada">Ada Example</a></section></aside></article>
  <footer>Copyright 2025. 200 projects.</footer>${options.extra ?? ""}`;
}

test("gallery uses actual submission links, structured count and pagination", () => {
  const html = `<nav><a href="https://devpost.com/software/not-a-submission">Navigation</a>999 projects</nav>
  <div id="submission-gallery"><h2>1,234 submissions</h2>
  <a href="https://devpost.com/software/real-project?ref=gallery">Title</a>
  <a href="https://www.devpost.com/software/real-project/">Duplicate</a>
  <a href="https://devpost.com/software/second">Second</a>
  <a href="https://devpost.com/software/built-with/python">Tag</a>
  <a href="https://devpost.com.evil.example/software/evil">Bad host</a>
  <h3>9 projects</h3>
  <ul class="pagination"><li><a href="?page=1">1</a></li><li><a href="?page=52&amp;sort=popular">Last</a></li><li><a href="https://other.devpost.com/project-gallery?page=100">Other</a></li></ul></div>`;
  // Conflicting direct gallery counts are withheld, never guessed.
  expect(extractDevpostGallery(html, galleryUrl)).toEqual({
    projectUrls: [projectUrl, "https://devpost.com/software/second"],
    totalProjects: null,
    lastPage: 52,
  });
  expect(
    extractDevpostGallery(html.replace("<h3>9 projects</h3>", ""), galleryUrl)
      .totalProjects,
  ).toBe(1234);
});

test("gallery supports the observed items_info range and ignores scripts", () => {
  expect(
    extractDevpostGallery(
      `<script>"<a class='link-to-software' href='https://devpost.com/software/fake'>Fake</a>"</script><div id="submission-gallery"><a href="${projectUrl}">Real</a><div class="pagination-info"><span class="items_info"><p><b>1&nbsp;&ndash;&nbsp;24</b> of <b>378</b></p></span></div></div>`,
      galleryUrl,
    ),
  ).toEqual({ projectUrls: [projectUrl], totalProjects: 378, lastPage: null });
  expect(
    extractDevpostGallery(
      '<h1>403 denied</h1><a href="/software">Projects</a>',
      galleryUrl,
    ),
  ).toEqual({ projectUrls: [], totalProjects: null, lastPage: null });
});

test("project retains the complete story and a contiguous source quote", () => {
  const html = project();
  const result = extractDevpostProject(html, projectUrl);
  expect(result).not.toBeNull();
  expect(result?.title).toBe("Real & precise");
  expect(result?.authors).toEqual(["Ada Example"]);
  expect(result?.story).toBe(htmlText(story));
  expect(result?.story.length).toBeGreaterThan(1500);
  expect(result?.story.endsWith("Future work remains untested.")).toBe(true);
  expect(htmlText(html).includes(result!.storyQuote)).toBe(true);
  expect(result?.eventUrls).toEqual(["https://treehacks-2026.devpost.com/"]);
  expect(result?.year).toBe(2026);
  expect(result?.story).not.toContain("Screenshot caption");
});

test("year requires explicit submitted event evidence, not story, copyright or URL alone", () => {
  expect(
    extractDevpostProject(
      project({ event: "", story: "<p>Built in 2024 for 2025 trials.</p>" }),
      projectUrl,
    )?.year,
  ).toBeNull();
  expect(
    extractDevpostProject(
      project({
        event:
          '<a href="https://treehacks-2026.devpost.com/">TreeHacks 2025</a>',
      }),
      projectUrl,
    )?.year,
  ).toBeNull();
  expect(
    extractDevpostProject(
      project({
        event:
          '<a href="https://treehacks-2026.devpost.com/">TreeHacks 2026</a><a href="https://treehacks-2025.devpost.com/">TreeHacks 2025</a>',
      }),
      projectUrl,
    )?.year,
  ).toBeNull();
});

test("untrusted title/story structure returns null for coordinator fallback", () => {
  expect(
    extractDevpostProject(
      "<h1>Navigation</h1><h2>Card</h2><p>Card excerpt</p>",
      projectUrl,
    ),
  ).toBeNull();
  expect(
    extractDevpostProject(
      project().replace('id="app-title"', 'id="card-title"'),
      projectUrl,
    ),
  ).toBeNull();
  expect(
    extractDevpostProject(
      project({ story: '<img alt="Only a screenshot">' }),
      projectUrl,
    ),
  ).toBeNull();
  expect(
    extractDevpostProject(
      project(),
      "https://devpost.com/software/built-with/python",
    ),
  ).toBeNull();
  expect(
    extractDevpostProject(
      project().replace(
        '<div id="built-with">',
        '<div><p>Ambiguous second narrative</p></div><div id="built-with">',
      ),
      projectUrl,
    ),
  ).toBeNull();
});
