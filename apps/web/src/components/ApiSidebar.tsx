import { FileJson, Search } from "lucide-react";
import type { RefObject } from "react";
import { text } from "../i18n/zh-CN";
import type { ApiField, ApiItem, Project } from "../types";

type ApiSidebarProps = {
  jsonInputRef: RefObject<HTMLInputElement | null>;
  activeProject: Project | null;
  apiSearchQuery: string;
  filteredApis: ApiItem[];
  onImportJson: (file: File | null) => void;
  onApiSearchQueryChange: (value: string) => void;
};

export function ApiSidebar({
  jsonInputRef,
  activeProject,
  apiSearchQuery,
  filteredApis,
  onImportJson,
  onApiSearchQueryChange,
}: ApiSidebarProps) {
  return (
    <aside className="sidebar api-sidebar">
      <div className="sidebar-head side-head-grid api-head">
        <h2>{text.interfaces}</h2>
        <button className="mini-button head-import right" type="button" aria-label={text.importJson} data-tip={text.importJson} onClick={() => jsonInputRef.current?.click()}>
          <FileJson size={16} />
        </button>
      </div>
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          onImportJson(event.target.files?.[0] || null);
          event.currentTarget.value = "";
        }}
      />
      <label className="api-search-field">
        <Search size={15} />
        <input
          type="search"
          value={apiSearchQuery}
          placeholder={text.apiSearch}
          aria-label={text.apiSearch}
          onChange={(event) => onApiSearchQueryChange(event.target.value)}
        />
      </label>
      <div className="api-list" aria-live="polite">
        {!activeProject?.apis.length && <p className="muted">暂无接口</p>}
        {Boolean(activeProject?.apis.length && !filteredApis.length) && <p className="muted">{text.noMatchedInterfaces}</p>}
        {filteredApis.map((api) => (
          <details key={api.id} className="api-item">
            <summary>
              <span className="api-title">{api.title}</span>
              <span className="api-path">
                {api.method} {api.path}
              </span>
            </summary>
            <div className="api-detail">
              {api.description && <p>{api.description}</p>}
              {Boolean(api.tags.length) && <small>{api.tags.join(" / ")}</small>}
              <ApiFieldSection title="参数" fields={api.parameters} />
              <ApiFieldSection title="请求字段" fields={api.requestFields} />
              <ApiFieldSection title="响应字段" fields={api.responseFields} />
              {!api.description && !api.tags.length && !api.parameters.length && !api.requestFields.length && !api.responseFields.length && <p>暂无字段信息</p>}
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}

function ApiFieldSection({ title, fields }: { title: string; fields: ApiField[] }) {
  if (!fields.length) return null;

  return (
    <section className="api-field-section">
      <h4>{title}</h4>
      <div className="api-field-list">
        {fields.map((field, index) => (
          <article key={`${field.source || title}-${field.name}-${field.type}-${index}`} className="api-field">
            <div className="api-field-main">
              <strong>{field.name}</strong>
              <span>{field.type}</span>
            </div>
            <div className="api-field-meta">
              {field.required && <em>必填</em>}
              {field.description && <p>{field.description}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}