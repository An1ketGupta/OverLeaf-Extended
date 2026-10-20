import { CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { latexCompletions, latexLanguage } from "./latex.js";

it("tokenizes LaTeX commands, comments and math and offers command snippets", () => {
  const doc = "\\section{Hello}\n% private note\n$x + 1$\n\\sec";
  const state = EditorState.create({ doc, extensions: [latexLanguage] });
  const nodes: string[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push(node.name);
    },
  });
  expect(nodes).toContain("tagName");
  expect(nodes).toContain("comment");
  expect(nodes).toContain("keyword");
  const completions = latexCompletions(
    new CompletionContext(state, doc.length, true),
  );
  expect(
    completions?.options.some((option) => option.label === "\\section"),
  ).toBe(true);
  expect(latexCompletions(new CompletionContext(state, 15, false))).toBeNull();
});
