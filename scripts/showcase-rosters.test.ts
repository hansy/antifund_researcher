import { test, expect } from "bun:test";
import { extractWaterlooProjects } from "./showcase-rosters";
test("numbered abstract headings exclude navigation/TOC and preserve numbering gaps", () => {
  const projects = extractWaterlooProjects(
    '<h1>2026 Projects</h1><h2>Participants</h2><a href="#1">1. Alpha</a><a href="#3">3. Beta</a><h2>1. Alpha</h2><p>Ada, Sam</p><p>A robot for field inspection.</p><h2>3. Beta</h2><p>A cheaper actuator.</p><h2>Contact us</h2><p>Footer</p>',
  );
  expect(projects.map((p) => p.number)).toEqual([1, 3]);
  expect(projects[0]!.story).toContain("A robot for field inspection.");
  expect(projects[1]!.story).not.toContain("Footer");
});
test("an unnumbered or empty page is not certified as a complete roster", () => {
  expect(
    extractWaterlooProjects("<h2>Welcome</h2><p>Projects coming soon</p>"),
  ).toHaveLength(0);
});
