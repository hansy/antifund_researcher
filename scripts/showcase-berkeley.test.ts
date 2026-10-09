import { test, expect } from "bun:test";
import { extractBerkeleyProjects } from "./showcase-berkeley";
test("collapsed official cards retain full descriptions and duplicate project IDs", () => {
  const card = (title: string) =>
    `<h4 class="cc-highlights__section__post__title">${title}</h4><p>Project ID:90</p><div class="cc-highlights__section__post__content" hidden><p>Complete abstract <div>including nested details.</div> Last sentence.</p></div>`;
  const projects = extractBerkeleyProjects(
    card("Robot hand") + card("Ocean drone"),
  );
  expect(projects).toHaveLength(2);
  expect(projects[0]?.story).toContain("Last sentence.");
  expect(projects[0]?.story).not.toContain("Ocean drone");
  expect(projects[1]?.title).toBe("Ocean drone");
});
