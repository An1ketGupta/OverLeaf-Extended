import type { Project } from "@overleaf-pro/contracts";
import { projectApi } from "./api.js";
import type { WorkspaceModel } from "./model.js";

export async function mutateSavedProject(
  model: WorkspaceModel,
  operation: (project: Project) => Promise<Project | null>,
  discardIds = new Set<string>(),
) {
  if (!model.isActive)
    throw new Error(
      "This project is unavailable. Download your drafts before leaving.",
    );
  model.pause();
  try {
    await model.settle();
    for (const [id] of model.buffers)
      if (!discardIds.has(id) && !(await model.save(id)))
        throw new Error(
          "Save or resolve every draft first. Your work has been kept.",
        );
    const project = await projectApi.get(model.project.id);
    if (
      !model.isActive ||
      project.name !== model.project.name ||
      project.files.length !== model.buffers.size ||
      project.files.some((file) => {
        const local = model.buffers.get(file.id);
        return (
          !local ||
          local.base.version !== file.version ||
          local.base.path !== file.path ||
          local.base.content !== file.content ||
          (!discardIds.has(file.id) &&
            (local.status !== "saved" || local.recovery))
        );
      }) ||
      project.mainFile !== model.project.mainFile ||
      JSON.stringify(project.assets ?? []) !==
        JSON.stringify(model.project.assets ?? [])
    )
      throw new Error(
        "Saved files changed in another tab. Download drafts, then reload and review before continuing.",
      );
    const result = await operation(project);
    if (!model.isActive) return null;
    if (result) model.acceptProject(result);
    else {
      model.discardAll();
      model.stop();
    }
    return result;
  } finally {
    model.resume();
  }
}
