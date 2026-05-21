import {
  Bold,
  GitBranch,
  History,
  ImagePlus,
  Italic,
  Link2,
  Menu,
  MousePointer2,
  Square,
  Trash2,
  Type as TypeIcon,
  Eye,
  EyeOff,
} from "lucide-react";
import type {
  CSSProperties,
  PointerEventHandler,
  RefObject,
  WheelEventHandler,
} from "react";
import { text } from "../i18n/zh-CN";
import type {
  Annotation,
  ApiItem,
  DesignImage,
  Project,
  Rect,
  TextItem,
  TextStyle,
  ToolName,
} from "../types";
import { AnnotationPopover, type AnnotationDraft } from "./AnnotationPopover";
import { ApiSidebar } from "./ApiSidebar";

type WorkspacePageProps = {
  pagesCollapsed: boolean;
  apisCollapsed: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  jsonInputRef: RefObject<HTMLInputElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  imageFrameRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  activeProject: Project | null;
  activeImage: DesignImage | null;
  activeImageId: string | null;
  renamingImageId: string | null;
  imageNameDraft: string;
  imageFrameStyle?: CSSProperties;
  tool: ToolName;
  textStyle: TextStyle;
  overlayVisible: boolean;
  draftRect: Rect | null;
  selectedAnnotationId: string | null;
  selectedTextId: string | null;
  relationJumpActive: boolean;
  annotationDraft: AnnotationDraft;
  annotationPopoverStyle: CSSProperties;
  canEditImage: boolean;
  canEditContent: boolean;
  apiSearchQuery: string;
  filteredApis: ApiItem[];
  getImageDisplayName: (name: string) => string;
  onImageLoad: () => void;
  onImportImages: (files: FileList | null) => void;
  onSelectImage: (imageId: string) => void;
  onDeleteImage: (imageId: string) => void;
  onStartRenameImage: (image: DesignImage) => void;
  onImageNameDraftChange: (value: string) => void;
  onSaveImageName: (image: DesignImage) => void;
  onCancelRenameImage: () => void;
  onTogglePagesCollapsed: () => void;
  onBack: () => void;
  onToggleApisCollapsed: () => void;
  onToolChange: (tool: ToolName) => void;
  onDeleteSelectedContent: () => void;
  onOpenRelationJump: () => void;
  onTextStyleChange: (patch: Partial<TextStyle>) => void;
  onToggleOverlayVisible: () => void;
  onOpenDataFlows: () => void;
  onOpenLogs: () => void;
  onStageWheel: WheelEventHandler<HTMLDivElement>;
  onStagePointerDown: PointerEventHandler<HTMLDivElement>;
  onStagePointerMove: PointerEventHandler<HTMLDivElement>;
  onFinishStagePan: PointerEventHandler<HTMLDivElement>;
  onOverlayPointerDown: PointerEventHandler<HTMLDivElement>;
  onOverlayPointerMove: PointerEventHandler<HTMLDivElement>;
  onOverlayPointerUp: PointerEventHandler<HTMLDivElement>;
  rectStyle: (rect: Rect) => CSSProperties;
  onOpenAnnotation: (annotation: Annotation) => void;
  onBeginTextEdit: (item: TextItem) => void;
  onFinishTextEdit: (textId: string, content: string) => void;
  onCloseAnnotation: () => void;
  onAnnotationDraftChange: (patch: Partial<AnnotationDraft>) => void;
  onSaveAnnotation: () => void;
  onImportJson: (file: File | null) => void;
  onApiSearchQueryChange: (value: string) => void;
};

export function WorkspacePage({
  pagesCollapsed,
  apisCollapsed,
  imageInputRef,
  jsonInputRef,
  stageRef,
  imageRef,
  imageFrameRef,
  overlayRef,
  activeProject,
  activeImage,
  activeImageId,
  renamingImageId,
  imageNameDraft,
  imageFrameStyle,
  tool,
  textStyle,
  overlayVisible,
  draftRect,
  selectedAnnotationId,
  selectedTextId,
  relationJumpActive,
  annotationDraft,
  annotationPopoverStyle,
  canEditImage,
  canEditContent,
  apiSearchQuery,
  filteredApis,
  getImageDisplayName,
  onImageLoad,
  onImportImages,
  onSelectImage,
  onDeleteImage,
  onStartRenameImage,
  onImageNameDraftChange,
  onSaveImageName,
  onCancelRenameImage,
  onTogglePagesCollapsed,
  onBack,
  onToggleApisCollapsed,
  onToolChange,
  onDeleteSelectedContent,
  onOpenRelationJump,
  onTextStyleChange,
  onToggleOverlayVisible,
  onOpenDataFlows,
  onOpenLogs,
  onStageWheel,
  onStagePointerDown,
  onStagePointerMove,
  onFinishStagePan,
  onOverlayPointerDown,
  onOverlayPointerMove,
  onOverlayPointerUp,
  rectStyle,
  onOpenAnnotation,
  onBeginTextEdit,
  onFinishTextEdit,
  onCloseAnnotation,
  onAnnotationDraftChange,
  onSaveAnnotation,
  onImportJson,
  onApiSearchQueryChange,
}: WorkspacePageProps) {
  return (
    <section
      className={`workspace-page${pagesCollapsed ? " pages-collapsed" : ""}${apisCollapsed ? " apis-collapsed" : ""}`}
      aria-label="图片标注工作台"
    >
      <aside className="sidebar page-sidebar">
        <div className="sidebar-head side-head-grid">
          <button
            className="mini-button head-import"
            type="button"
            aria-label={text.importImage}
            data-tip={text.importImage}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus size={16} />
          </button>
          <h2>{text.images}</h2>
        </div>
        <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => onImportImages(event.target.files)} />
        <div className="page-list" aria-live="polite">
          {!activeProject?.images.length && <p className="muted side-empty">暂无图片</p>}
          {activeProject?.images.map((image) => (
            <div key={image.id} className={`page-item${image.id === activeImageId ? " is-active" : ""}`}>
              <div className="page-entry">
                <button className="page-thumb" type="button" aria-label={getImageDisplayName(image.name)} onClick={() => onSelectImage(image.id)}>
                  <img src={image.src} alt="" />
                </button>
                {renamingImageId === image.id ? (
                  <input
                    className="image-name-input"
                    value={imageNameDraft}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => onImageNameDraftChange(event.target.value)}
                    onBlur={() => onSaveImageName(image)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") onCancelRenameImage();
                    }}
                  />
                ) : canEditImage ? (
                  <button className="image-name-button" type="button" onClick={() => onStartRenameImage(image)}>
                    {getImageDisplayName(image.name)}
                  </button>
                ) : (
                  <span className="image-name-static">{getImageDisplayName(image.name)}</span>
                )}
              </div>
              <button className="delete-image" type="button" data-tip="删除图片" onClick={() => onDeleteImage(image.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="canvas-area">
        <div className="workspace-top-row">
          <button className="icon-button" type="button" aria-label="折叠图片栏" data-tip="折叠图片栏" onClick={onTogglePagesCollapsed}>
            <Menu size={17} />
          </button>
          <strong className="current-project-name">{activeProject?.name || text.projects}</strong>
          <div className="top-right-actions">
            <button className="secondary-action" type="button" onClick={onBack}>
              {text.back}
            </button>
            <button className="icon-button" type="button" aria-label="折叠接口栏" data-tip="折叠接口栏" onClick={onToggleApisCollapsed}>
              <Menu size={17} />
            </button>
          </div>
        </div>

        <div className="operation-row" role="toolbar" aria-label="编辑工具">
          <div className="tool-cluster">
            <button className={`tool-button${tool === "select" ? " is-active" : ""}`} type="button" data-tip={text.select} onClick={() => onToolChange("select")}>
              <MousePointer2 size={16} />
            </button>
            <button className={`tool-button${tool === "box" ? " is-active" : ""}`} type="button" data-tip={text.drawBox} onClick={() => onToolChange("box")}>
              <Square size={16} />
            </button>
            <button className={`tool-button${tool === "text" ? " is-active" : ""}`} type="button" data-tip={text.textTool} onClick={() => onToolChange("text")}>
              <TypeIcon size={16} />
            </button>
            <button className="tool-button" type="button" data-tip={text.delete} onClick={onDeleteSelectedContent}>
              <Trash2 size={16} />
            </button>
            <button className={`tool-button${relationJumpActive ? " is-active" : ""}`} type="button" data-tip={text.relationJump} onClick={onOpenRelationJump}>
              <Link2 size={16} />
            </button>
            <input className="color-input" type="color" value={textStyle.color} title="文字颜色" onChange={(event) => onTextStyleChange({ color: event.target.value })} />
            <select value={textStyle.size} title="字号" onChange={(event) => onTextStyleChange({ size: Number(event.target.value) })}>
              {[14, 16, 20, 24, 32].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <button className={`tool-button${textStyle.bold ? " is-active" : ""}`} type="button" data-tip="加粗" onClick={() => onTextStyleChange({ bold: !textStyle.bold })}>
              <Bold size={16} />
            </button>
            <button className={`tool-button${textStyle.italic ? " is-active" : ""}`} type="button" data-tip="斜体" onClick={() => onTextStyleChange({ italic: !textStyle.italic })}>
              <Italic size={16} />
            </button>
          </div>
          <div className="view-cluster">
            <button className="tool-button" type="button" data-tip={overlayVisible ? text.hideAll : text.showAll} onClick={onToggleOverlayVisible}>
              {overlayVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button className="tool-button" type="button" data-tip={text.dataFlows} onClick={onOpenDataFlows}>
              <GitBranch size={16} />
            </button>
            <button className="tool-button" type="button" data-tip={text.logs} onClick={onOpenLogs}>
              <History size={16} />
            </button>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`stage${activeImage ? "" : " is-empty"}${activeImage && tool === "select" ? " is-pan-ready" : ""}`}
          onWheel={onStageWheel}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onFinishStagePan}
          onPointerCancel={onFinishStagePan}
        >
          {!activeImage && <p className="empty-stage-text">{text.noImage}</p>}
          {activeImage && (
            <div className="stage-content">
              <div ref={imageFrameRef} className={`image-stage-frame${imageFrameStyle ? "" : " is-measuring"}`} style={imageFrameStyle}>
                <img ref={imageRef} src={activeImage.src} alt="当前设计图" onLoad={onImageLoad} />
                <div
                  ref={overlayRef}
                  className={`overlay-layer${overlayVisible ? "" : " is-hidden-layer"}`}
                  onPointerDown={onOverlayPointerDown}
                  onPointerMove={onOverlayPointerMove}
                  onPointerUp={onOverlayPointerUp}
                >
                  {activeImage.annotations.map((annotation) => (
                    <button
                      key={annotation.id}
                      className={`annotation-box${selectedAnnotationId === annotation.id ? " is-selected" : ""}`}
                      type="button"
                      style={rectStyle(annotation.rect)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAnnotation(annotation);
                      }}
                    />
                  ))}
                  {activeImage.texts.map((item) => (
                    <div
                      key={item.id}
                      className={`text-label${selectedTextId === item.id ? " is-selected" : ""}`}
                      contentEditable={canEditContent}
                      suppressContentEditableWarning
                      style={{
                        left: `${item.x * 100}%`,
                        top: `${item.y * 100}%`,
                        color: item.color,
                        fontSize: item.size,
                        fontWeight: item.bold ? 800 : 500,
                        fontStyle: item.italic ? "italic" : "normal",
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        onBeginTextEdit(item);
                      }}
                      onBlur={(event) => onFinishTextEdit(item.id, event.currentTarget.textContent || "")}
                    >
                      {item.content}
                    </div>
                  ))}
                  {draftRect && <div className="draft-box" style={rectStyle(draftRect)} />}
                </div>
              </div>
            </div>
          )}

          <AnnotationPopover
            visible={Boolean(selectedAnnotationId && activeImage)}
            style={annotationPopoverStyle}
            draft={annotationDraft}
            apis={activeProject?.apis || []}
            onClose={onCloseAnnotation}
            onChange={onAnnotationDraftChange}
            onDelete={onDeleteSelectedContent}
            onSave={onSaveAnnotation}
          />
        </div>
      </section>

      <ApiSidebar
        jsonInputRef={jsonInputRef}
        activeProject={activeProject}
        apiSearchQuery={apiSearchQuery}
        filteredApis={filteredApis}
        onImportJson={onImportJson}
        onApiSearchQueryChange={onApiSearchQueryChange}
      />
    </section>
  );
}