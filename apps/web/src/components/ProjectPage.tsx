import { Pencil, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { text } from "../i18n/zh-CN";
import type { Project } from "../types";

type ProjectPageProps = {
  currentUser: string | null;
  projects: Project[];
  authActions: ReactNode;
  onOpenNewProject: () => void;
  onOpenPermissions: () => void;
  onEnterProject: (project: Project) => void;
  onOpenProject: (project: Project) => void;
  canEditProject: (project: Project) => boolean;
};

export function ProjectPage({
  currentUser,
  projects,
  authActions,
  onOpenNewProject,
  onOpenPermissions,
  onEnterProject,
  onOpenProject,
  canEditProject,
}: ProjectPageProps) {
  return (
    <section className="project-page" aria-labelledby="projectTitle">
      <header className="project-header">
        <div className="project-title-row">
          <h1 id="projectTitle">{text.projects}</h1>
          <button
            className={`header-icon-button${currentUser ? "" : " is-disabled"}`}
            type="button"
            aria-label={text.addProject}
            onClick={onOpenNewProject}
          >
            <Plus size={24} />
          </button>
        </div>
        <div className="project-header-actions">
          <button className="plain-action" type="button" onClick={onOpenPermissions}>
            {text.permissions}
          </button>
          {authActions}
        </div>
      </header>
      <div className="project-grid" aria-live="polite">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onEnter={onEnterProject}
            onEdit={() => onOpenProject(project)}
            canEdit={canEditProject(project)}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({
  project,
  canEdit,
  onEnter,
  onEdit,
}: {
  project: Project;
  canEdit?: boolean;
  onEnter: (project: Project) => void;
  onEdit?: () => void;
}) {
  const defaultImage = project.images.find((image) => image.id === project.defaultImageId) || project.images[0] || null;

  return (
    <article className="project-card">
      <button className="project-cover" type="button" aria-label={`进入 ${project.name}`} onClick={() => onEnter(project)}>
        {defaultImage ? <img src={defaultImage.src} alt="" /> : <span className="no-image">{text.noContent}</span>}
      </button>
      <div className="project-card-footer">
        <strong>{project.name}</strong>
        {canEdit && (
          <button className="mini-button" type="button" aria-label="编辑项目" data-tip="编辑项目" onClick={onEdit}>
            <Pencil size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
