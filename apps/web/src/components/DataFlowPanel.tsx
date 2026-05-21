import { Search, Trash2, X } from "lucide-react";
import type { FormEvent } from "react";
import { text } from "../i18n/zh-CN";
import type {
  Annotation,
  ApiItem,
  DataFlow,
  DataFlowEndpoint,
  DataFlowFieldMap,
  Project,
} from "../types";

type EndpointGroup = "sources" | "targets";

type DataFlowPanelProps = {
  activeProject: Project;
  dataFlowDraft: DataFlow;
  dataFlowApiQuery: string;
  endpointTypes: string[];
  selectedApis: ApiItem[];
  filteredApis: ApiItem[];
  summary: string;
  checks: string[];
  getImageDisplayName: (name: string) => string;
  annotationLabel: (annotation: Annotation) => string;
  onStartNew: () => void;
  onSelectFlow: (flow: DataFlow) => void;
  onDeleteFlow: (flowId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (patch: Partial<DataFlow>) => void;
  onDataFlowApiQueryChange: (value: string) => void;
  onUpdateEndpoint: (group: EndpointGroup, endpointId: string, patch: Partial<DataFlowEndpoint>) => void;
  onAddEndpoint: (group: EndpointGroup, type: string) => void;
  onRemoveEndpoint: (group: EndpointGroup, endpointId: string) => void;
  onToggleApi: (apiId: string) => void;
  onImportApiFields: () => void;
  onAddField: () => void;
  onUpdateField: (fieldId: string, patch: Partial<DataFlowFieldMap>) => void;
  onRemoveField: (fieldId: string) => void;
};

export function DataFlowPanel({
  activeProject,
  dataFlowDraft,
  dataFlowApiQuery,
  endpointTypes,
  selectedApis,
  filteredApis,
  summary,
  checks,
  getImageDisplayName,
  annotationLabel,
  onStartNew,
  onSelectFlow,
  onDeleteFlow,
  onSubmit,
  onDraftChange,
  onDataFlowApiQueryChange,
  onUpdateEndpoint,
  onAddEndpoint,
  onRemoveEndpoint,
  onToggleApi,
  onImportApiFields,
  onAddField,
  onUpdateField,
  onRemoveField,
}: DataFlowPanelProps) {
  return (
    <div className="data-flow-panel">
      <aside className="data-flow-list">
        <button className="mini-text-button" type="button" onClick={onStartNew}>
          {text.addDataFlow}
        </button>
        {!activeProject.dataFlows.length && <p className="muted">{text.noDataFlows}</p>}
        {activeProject.dataFlows.map((flow) => (
          <article key={flow.id} className={`data-flow-item${dataFlowDraft.id === flow.id ? " is-active" : ""}`}>
            <button type="button" onClick={() => onSelectFlow(flow)}>
              <strong>{flow.name}</strong>
              <span>
                {flow.sources.length} 来源 / {flow.targets.length} 去向 / {flow.fields.length} 字段
              </span>
            </button>
            <button className="mini-button" type="button" aria-label={text.delete} onClick={() => onDeleteFlow(flow.id)}>
              <Trash2 size={15} />
            </button>
          </article>
        ))}
      </aside>

      <form className="data-flow-editor" onSubmit={onSubmit}>
        <label>
          <span>{text.dataFlowName}</span>
          <input value={dataFlowDraft.name} onChange={(event) => onDraftChange({ name: event.target.value })} />
        </label>

        <section className="data-flow-summary">
          <strong>{text.flowSummary}</strong>
          <p>{summary}</p>
        </section>

        <section className={`data-flow-checks${checks.length ? " has-issues" : ""}`}>
          <strong>{text.flowChecks}</strong>
          {checks.length ? (
            <ul>
              {checks.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p>{text.checksPassed}</p>
          )}
        </section>

        <section className="data-flow-section">
          <header>
            <strong>{text.dataFlowBinding}</strong>
          </header>
          <div className="data-flow-binding">
            <label>
              <span>{text.images}</span>
              <select value={dataFlowDraft.imageId} onChange={(event) => onDraftChange({ imageId: event.target.value, annotationId: "" })}>
                <option value="">{text.noBoundImage}</option>
                {activeProject.images.map((image) => (
                  <option key={image.id} value={image.id}>
                    {getImageDisplayName(image.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.annotationFallback}</span>
              <select value={dataFlowDraft.annotationId} onChange={(event) => onDraftChange({ annotationId: event.target.value })}>
                <option value="">{text.noBoundAnnotation}</option>
                {(activeProject.images.find((image) => image.id === dataFlowDraft.imageId)?.annotations || []).map((annotation) => (
                  <option key={annotation.id} value={annotation.id}>
                    {annotationLabel(annotation)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="data-flow-section">
          <header>
            <strong>{text.dataFlowSources}</strong>
            <button className="mini-text-button" type="button" onClick={() => onAddEndpoint("sources", "页面输入")}>
              {text.add}
            </button>
          </header>
          {!dataFlowDraft.sources.length && <p className="muted">暂无来源</p>}
          {dataFlowDraft.sources.map((source) => (
            <div key={source.id} className="endpoint-row">
              <select value={source.type} onChange={(event) => onUpdateEndpoint("sources", source.id, { type: event.target.value })}>
                <option value="">{text.endpointType}</option>
                {endpointTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input placeholder={text.endpointName} value={source.name} onChange={(event) => onUpdateEndpoint("sources", source.id, { name: event.target.value })} />
              <input placeholder={text.endpointDetail} value={source.detail} onChange={(event) => onUpdateEndpoint("sources", source.id, { detail: event.target.value })} />
              <button className="mini-button" type="button" aria-label={text.delete} onClick={() => onRemoveEndpoint("sources", source.id)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </section>

        <section className="data-flow-section">
          <header>
            <strong>{text.dataFlowTargets}</strong>
            <button className="mini-text-button" type="button" onClick={() => onAddEndpoint("targets", "后端接口")}>
              {text.add}
            </button>
          </header>
          {!dataFlowDraft.targets.length && <p className="muted">暂无去向</p>}
          {dataFlowDraft.targets.map((target) => (
            <div key={target.id} className="endpoint-row">
              <select value={target.type} onChange={(event) => onUpdateEndpoint("targets", target.id, { type: event.target.value })}>
                <option value="">{text.endpointType}</option>
                {endpointTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input placeholder={text.endpointName} value={target.name} onChange={(event) => onUpdateEndpoint("targets", target.id, { name: event.target.value })} />
              <input placeholder={text.endpointDetail} value={target.detail} onChange={(event) => onUpdateEndpoint("targets", target.id, { detail: event.target.value })} />
              <button className="mini-button" type="button" aria-label={text.delete} onClick={() => onRemoveEndpoint("targets", target.id)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </section>

        <section className="data-flow-section">
          <header>
            <strong>{text.relatedApis}</strong>
          </header>
          <div className="data-flow-api-tools">
            <label className="api-search-field">
              <Search size={15} />
              <input value={dataFlowApiQuery} onChange={(event) => onDataFlowApiQueryChange(event.target.value)} placeholder={text.apiSearch} />
            </label>
            <div className="selected-api-strip" aria-label={text.selectedApis}>
              <span>{text.selectedApis}</span>
              {selectedApis.length ? (
                selectedApis.map((api) => (
                  <button key={api.id} type="button" onClick={() => onToggleApi(api.id)}>
                    {api.title || api.path}
                    <X size={13} />
                  </button>
                ))
              ) : (
                <em>暂无</em>
              )}
            </div>
          </div>
          <div className="data-flow-api-list">
            {!activeProject.apis.length && <p className="muted">暂无接口</p>}
            {Boolean(activeProject.apis.length && !filteredApis.length) && <p className="muted">{text.noMatchedInterfaces}</p>}
            {filteredApis.map((api) => (
              <label key={api.id} className="data-flow-api-option">
                <input type="checkbox" checked={dataFlowDraft.apiIds.includes(api.id)} onChange={() => onToggleApi(api.id)} />
                <span>{api.title || api.path}</span>
                <small>
                  {api.method} {api.path}
                </small>
              </label>
            ))}
          </div>
        </section>

        <section className="data-flow-section">
          <header>
            <strong>{text.fieldMapping}</strong>
            <div className="data-flow-header-actions">
              <button className="mini-text-button" type="button" onClick={onImportApiFields}>
                {text.importApiFields}
              </button>
              <button className="mini-text-button" type="button" onClick={onAddField}>
                {text.add}
              </button>
            </div>
          </header>
          {!dataFlowDraft.fields.length && <p className="muted">暂无字段映射</p>}
          {dataFlowDraft.fields.map((field) => (
            <div key={field.id} className="field-map-row">
              <input placeholder={text.sourceField} value={field.sourceField} onChange={(event) => onUpdateField(field.id, { sourceField: event.target.value })} />
              <input placeholder={text.targetField} value={field.targetField} onChange={(event) => onUpdateField(field.id, { targetField: event.target.value })} />
              <input placeholder={text.fieldType} value={field.type} onChange={(event) => onUpdateField(field.id, { type: event.target.value })} />
              <label className="check-field compact">
                <input type="checkbox" checked={field.required} onChange={(event) => onUpdateField(field.id, { required: event.target.checked })} />
                <span>{text.required}</span>
              </label>
              <input placeholder={text.transform} value={field.transform} onChange={(event) => onUpdateField(field.id, { transform: event.target.value })} />
              <input placeholder={text.note} value={field.note} onChange={(event) => onUpdateField(field.id, { note: event.target.value })} />
              <button className="mini-button" type="button" aria-label={text.delete} onClick={() => onRemoveField(field.id)}>
                <X size={15} />
              </button>
            </div>
          ))}
        </section>

        <div className="data-flow-text-grid">
          <label>
            <span>{text.condition}</span>
            <textarea rows={3} value={dataFlowDraft.condition} onChange={(event) => onDraftChange({ condition: event.target.value })} />
          </label>
          <label>
            <span>{text.transform}</span>
            <textarea rows={3} value={dataFlowDraft.transform} onChange={(event) => onDraftChange({ transform: event.target.value })} />
          </label>
          <label>
            <span>{text.note}</span>
            <textarea rows={3} value={dataFlowDraft.note} onChange={(event) => onDraftChange({ note: event.target.value })} />
          </label>
        </div>

        <footer>
          {activeProject.dataFlows.some((flow) => flow.id === dataFlowDraft.id) ? (
            <button className="danger-action" type="button" onClick={() => onDeleteFlow(dataFlowDraft.id)}>
              {text.delete}
            </button>
          ) : (
            <span />
          )}
          <button className="primary-action small" type="submit">
            {text.save}
          </button>
        </footer>
      </form>
    </div>
  );
}