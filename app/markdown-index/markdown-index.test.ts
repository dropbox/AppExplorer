import type { MarkdownData } from ".";
import { generateMarkdown, readMarkdown } from ".";

const roundTrip = (input: MarkdownData) => {
  const md = generateMarkdown(input);
  const output = readMarkdown(md);
  // expect(input).toMatchObject(output);
  expect(JSON.stringify(input, null, 2)).toBe(JSON.stringify(output, null, 2));
};

describe("Markdown Index", () => {
  it("should be able to parse a file it creates", () => {
    roundTrip({
      files: [
        {
          filename: "src/hello-world.tsx",
          items: [
            { name: "HelloWorld", location: "src/hello-world.tsx#L6" },
            { name: "example", location: "src/hello-world.tsx#L45" },
          ],
        },
      ],
      projects: [
        {
          name: "Example Sub-project",
          location: "example/README.AppExplorer.md",
        },
      ],
    });
  });
});
