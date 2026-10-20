import type { SourceFile } from "@overleaf-pro/contracts";

type Node = { folders: Map<string, Node>; files: SourceFile[] };
export function FileTree({
  files,
  active,
  dirty,
  onOpen,
}: {
  files: SourceFile[];
  active: string;
  dirty: (id: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const root: Node = { folders: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const folder of file.path.split("/").slice(0, -1)) {
      let child = node.folders.get(folder);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(folder, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  function render(node: Node, path = "") {
    return (
      <>
        {node.files.map((file) => (
          <button
            key={file.id}
            type="button"
            aria-label={`Open ${file.path}`}
            className={file.id === active ? "selected" : ""}
            aria-current={file.id === active ? "true" : undefined}
            onClick={() => onOpen(file.id)}
          >
            <span className="file-symbol" aria-hidden="true">
              {file.path.endsWith(".tex") ? "TₑX" : "≡"}
            </span>
            <span title={file.path}>{file.path.split("/").pop()}</span>
            {dirty(file.id) && (
              <span className="file-dirty" role="img" aria-label="Unsaved">
                ●
              </span>
            )}
          </button>
        ))}
        {[...node.folders].map(([folder, child]) => (
          <details className="file-folder" key={`${path}${folder}`} open>
            <summary>
              <span className="folder-icon" aria-hidden="true">
                ▱
              </span>{" "}
              {folder}
            </summary>
            <div className="folder-children">
              {render(child, `${path}${folder}/`)}
            </div>
          </details>
        ))}
      </>
    );
  }
  return render(root);
}
