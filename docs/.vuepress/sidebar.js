import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toDocLink } from "./doc-links.js";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hiddenDocs = ["README.md"];
const coreDocs = ["GETTING-STARTED.md", "FEATURES.md", "WORKS-WITH.md", "CONTRIBUTING.md", "SECURITY.md"];

export function createDocsSidebar() {
  const markdownFiles = fs
    .readdirSync(docsRoot)
    .filter((file) => file.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  const remainingDocs = markdownFiles.filter((file) => !hiddenDocs.includes(file) && !coreDocs.includes(file));

  return [
    {
      text: "Project documentation",
      collapsible: true,
      children: coreDocs.filter((file) => markdownFiles.includes(file)).map(toSidebarItem),
    },
    ...(remainingDocs.length
      ? [
          {
            text: "Additional docs",
            collapsible: true,
            children: remainingDocs.map(toSidebarItem),
          },
        ]
      : []),
  ];
}

function toSidebarItem(file) {
  return {
    text: readTitle(file),
    link: toDocLink(file),
  };
}

function readTitle(file) {
  const content = fs.readFileSync(path.join(docsRoot, file), "utf8");
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : file.replace(/\.md$/, "").replaceAll("-", " ");
}
