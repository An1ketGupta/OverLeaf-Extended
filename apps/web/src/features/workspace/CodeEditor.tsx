import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { latexCompletions, latexLanguage } from "./latex.js";

export function CodeEditor({
  fileId,
  path,
  content,
  onChange,
  onSave,
  onView,
}: {
  fileId: string;
  path: string;
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
  onView: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave, onView });
  callbacks.current = { onChange, onSave, onView };
  // Each open file is kept mounted to preserve selection, scroll position and undo history.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Initial document belongs to this file; subsequent content is synchronized below.
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          latexLanguage,
          syntaxHighlighting(defaultHighlightStyle),
          autocompletion({ override: [latexCompletions] }),
          search({ top: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": `Source editor: ${path}`,
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                view.contentDOM.blur();
                return true;
              },
            },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "Consolas, 'SFMono-Regular', monospace",
              lineHeight: "1.85",
            },
            ".cm-content": { padding: "20px 0" },
            ".cm-line": { padding: "0 20px" },
            ".cm-gutters": {
              background: "#fafbf7",
              color: "#96a08d",
              borderRight: "1px solid #edf0e7",
              paddingRight: "8px",
            },
            ".cm-activeLine, .cm-activeLineGutter": { background: "#f1f5e9" },
            "&.cm-focused": { outline: "none" },
            ".cm-search": {
              fontFamily: "Inter, 'Segoe UI', sans-serif",
              fontSize: "12px",
            },
          }),
        ],
      }),
    });
    callbacks.current.onView(view);
    return () => {
      callbacks.current.onView(null);
      view.destroy();
    };
  }, [fileId, path]);
  useEffect(() => {
    const view = host.current?.querySelector(".cm-editor");
    const editor = view ? EditorView.findFromDOM(view as HTMLElement) : null;
    if (editor && editor.state.doc.toString() !== content) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
      });
    }
  }, [content]);
  return <div className="code-editor" ref={host} />;
}
