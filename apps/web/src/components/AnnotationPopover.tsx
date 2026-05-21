import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { text } from "../i18n/zh-CN";
import type { ApiItem } from "../types";

export type AnnotationDraft = {
  name: string;
  interaction: string;
  api: string;
  note: string;
  linkTag: string;
};

export const emptyAnnotationDraft: AnnotationDraft = {
  name: "",
  interaction: "",
  api: "",
  note: "",
  linkTag: "",
};

type AnnotationPopoverProps = {
  visible: boolean;
  style: CSSProperties;
  draft: AnnotationDraft;
  apis: ApiItem[];
  onClose: () => void;
  onChange: (patch: Partial<AnnotationDraft>) => void;
  onDelete: () => void;
  onSave: () => void;
};

export function AnnotationPopover({
  visible,
  style,
  draft,
  apis,
  onClose,
  onChange,
  onDelete,
  onSave,
}: AnnotationPopoverProps) {
  if (!visible) return null;

  return (
    <div className="annotation-popover" style={style}>
      <div className="popover-head">
        <strong>标注</strong>
        <button className="mini-button" type="button" data-tip="关闭" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <label>
        <span>{text.annotationName}</span>
        <input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
      </label>
      <label>
        <span>{text.interaction}</span>
        <textarea rows={2} value={draft.interaction} onChange={(event) => onChange({ interaction: event.target.value })} />
      </label>
      <label>
        <span>{text.api}</span>
        <select value={draft.api} onChange={(event) => onChange({ api: event.target.value })}>
          <option value="">暂不选择接口</option>
          {apis.map((api) => (
            <option key={api.id} value={api.id}>
              {api.title} - {api.method} {api.path}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.note}</span>
        <textarea rows={2} value={draft.note} onChange={(event) => onChange({ note: event.target.value })} />
      </label>
      <label>
        <span>{text.relationTag}</span>
        <input value={draft.linkTag} onChange={(event) => onChange({ linkTag: event.target.value })} />
      </label>
      <div className="popover-actions">
        <button className="danger-action" type="button" onClick={onDelete}>
          {text.delete}
        </button>
        <button className="primary-action small" type="button" onClick={onSave}>
          {text.save}
        </button>
      </div>
    </div>
  );
}