import type { ReactNode } from "react";
import { ALL_PERMISSIONS } from "../constants/permissions";
import { permissionLabels, text } from "../i18n/zh-CN";
import type { Account, PermissionKey, Project } from "../types";

type PermissionPageProps = {
  accounts: Account[];
  projects: Project[];
  permissionProject: Project | null;
  permissionDisplayProject: Project;
  currentUser: string | null;
  isRoot: boolean;
  canManage: boolean;
  authActions: ReactNode;
  onBack: () => void;
  onProjectChange: (projectId: string) => void;
  onTogglePermission: (username: string, permission: PermissionKey) => void;
  onTransferAdmin: (username: string) => void;
};

export function PermissionPage({
  accounts,
  projects,
  permissionProject,
  permissionDisplayProject,
  currentUser,
  isRoot,
  canManage,
  authActions,
  onBack,
  onProjectChange,
  onTogglePermission,
  onTransferAdmin,
}: PermissionPageProps) {
  return (
    <section className="content-page">
      <header className="content-header">
        <button className="secondary-action" type="button" onClick={onBack}>
          {text.back}
        </button>
        <h1>{text.permissions}</h1>
        {authActions}
      </header>
      <div className="permission-layout">
        <label className="field">
          <span>项目</span>
          <select value={permissionProject?.id || ""} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {!permissionProject && <p className="muted">暂无可配置项目，以下为默认只读权限状态</p>}
        <PermissionPanel
          accounts={accounts}
          project={permissionDisplayProject}
          currentUser={currentUser}
          isRoot={isRoot}
          canManage={canManage}
          onToggle={onTogglePermission}
          onTransferAdmin={onTransferAdmin}
        />
      </div>
    </section>
  );
}

function PermissionPanel({
  accounts,
  project,
  currentUser,
  isRoot,
  canManage,
  onToggle,
  onTransferAdmin,
}: {
  accounts: Account[];
  project: Project;
  currentUser: string | null;
  isRoot: boolean;
  canManage: boolean;
  onToggle: (username: string, permission: PermissionKey) => void;
  onTransferAdmin: (username: string) => void;
}) {
  const currentValues = new Set(!currentUser ? [] : isRoot ? ALL_PERMISSIONS : project.permissions[currentUser] || []);
  const editableAccounts = accounts.filter((account) => !account.isRoot);
  const currentAdmin = editableAccounts.find((account) => project.permissions[account.username]?.includes("admin"))?.username || project.owner || "";

  return (
    <div className="permission-stack">
      <section className="permission-summary">
        <header>
          <span>{text.currentPermissions}</span>
          <strong>{currentUser || text.readonlyGuest}</strong>
        </header>
        <div className="permission-chips">
          {ALL_PERMISSIONS.map((permission) => (
            <span key={permission} className={currentValues.has(permission) ? "is-on" : ""}>
              {permissionLabels[permission]}
            </span>
          ))}
        </div>
      </section>

      {canManage && (
        <section className="permission-table" aria-label={text.memberPermissions}>
          <header className="permission-section-header">
            <span>{text.memberPermissions}</span>
            {currentAdmin && (
              <small>
                {text.currentAdmin}: {currentAdmin}
              </small>
            )}
          </header>
          {editableAccounts.map((account) => {
            const values = new Set(account.isRoot ? ALL_PERMISSIONS : project.permissions[account.username] || []);
            return (
              <article key={account.username} className="permission-row">
                <div className="permission-row-head">
                  <strong>{account.username}</strong>
                  {values.has("admin") ? (
                    <span className="permission-admin-badge">{text.currentAdmin}</span>
                  ) : (
                    <button className="plain-action permission-transfer" type="button" onClick={() => onTransferAdmin(account.username)}>
                      {text.transferAdmin}
                    </button>
                  )}
                </div>
                <div className="permission-checks">
                  {ALL_PERMISSIONS.map((permission) => (
                    <label key={permission} className="check-field">
                      <input
                        type="checkbox"
                        checked={values.has(permission)}
                        disabled={permission === "admin"}
                        onChange={() => onToggle(account.username, permission)}
                      />
                      <span>{permissionLabels[permission]}</span>
                    </label>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}