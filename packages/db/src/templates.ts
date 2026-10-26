import { readFile } from "node:fs/promises";
import { templateCatalog, templateIdSchema } from "@overleaf-pro/contracts";

export async function templateFiles(input: string) {
  const id = templateIdSchema.parse(input);
  const entry = templateCatalog.find((item) => item.id === id);
  if (!entry) throw new Error("Unknown template");
  const root = new URL("../../../templates/", import.meta.url);
  return Promise.all([
    ...entry.files.map(async (path) => ({
      path,
      content: await readFile(new URL(`${id}/${path}`, root), "utf8"),
    })),
    readFile(new URL("LICENSE", root), "utf8").then((content) => ({
      path: "LICENSE.txt",
      content,
    })),
  ]);
}
