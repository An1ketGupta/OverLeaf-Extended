/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: CodeMirror snippet placeholders are intentionally literal. */
import {
  type CompletionContext,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";

export const latexLanguage = StreamLanguage.define(stex);

export function latexCompletions(context: CompletionContext) {
  const command = context.matchBefore(/\\[a-zA-Z]*/);
  if (!command || (!context.explicit && command.text.length < 2)) return null;
  return {
    from: command.from,
    options: [
      snippetCompletion(
        "\\begin{${environment}}\n\t${}\n\\end{${environment}}",
        { label: "\\begin", detail: "environment", type: "keyword" },
      ),
      snippetCompletion("\\section{${title}}", {
        label: "\\section",
        type: "keyword",
      }),
      snippetCompletion("\\subsection{${title}}", {
        label: "\\subsection",
        type: "keyword",
      }),
      snippetCompletion("\\textbf{${text}}", {
        label: "\\textbf",
        type: "keyword",
      }),
      snippetCompletion("\\textit{${text}}", {
        label: "\\textit",
        type: "keyword",
      }),
      snippetCompletion("\\input{${path}}", {
        label: "\\input",
        type: "keyword",
      }),
      snippetCompletion("\\label{${key}}", {
        label: "\\label",
        type: "keyword",
      }),
      snippetCompletion("\\ref{${key}}", { label: "\\ref", type: "keyword" }),
      snippetCompletion("\\usepackage{${package}}", {
        label: "\\usepackage",
        type: "keyword",
      }),
      { label: "\\item", type: "keyword" },
      { label: "\\documentclass", type: "keyword" },
    ],
  };
}
