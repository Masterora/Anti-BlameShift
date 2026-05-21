import { Eye, EyeOff, LogOut, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { emptyAnnotationDraft, type AnnotationDraft } from "./components/AnnotationPopover";
import { DataFlowPanel } from "./components/DataFlowPanel";
import { PermissionPage } from "./components/PermissionPage";
import { ProjectPage } from "./components/ProjectPage";
import { WorkspacePage } from "./components/WorkspacePage";
import { shortcuts } from "./config/shortcuts";
import { useHistory } from "./hooks/useHistory";
import { apiRequest, type BootstrapPayload, useProjects } from "./hooks/useProjects";
import { text } from "./i18n/zh-CN";
import { hashPassword, isPasswordValid } from "./utils/security";
import type {
  ApiField,
  Annotation,
  ApiItem,
  DataFlow,
  DataFlowEndpoint,
  DataFlowFieldMap,
  DesignImage,
  PermissionKey,
  Project,
  Rect,
  Snapshot,
  TextItem,
  TextStyle,
  ToolName,
  ViewName,
} from "./types";

type ProjectDraft = {
  id: string;
  isNew: boolean;
  name: string;
  defaultImageId: string | null;
  images: DesignImage[];
};

const emptyTextStyle: TextStyle = {
  color: "#34d399",
  size: 16,
  bold: false,
  italic: false,
};

type AnnotationJumpTarget = {
  imageId: string;
  imageName: string;
  annotation: Annotation;
  apiTitle: string;
  tag: string;
};

const endpointTypes = [
  "页面输入",
  "页面展示",
  "前端状态",
  "后端接口",
  "数据库表",
  "第三方系统",
  "缓存",
  "日志/埋点",
  "消息队列",
  "文件/附件",
  "其他",
];

type AuthMode = "login" | "register";

type PasswordFields = {
  oldPassword: boolean;
  password: boolean;
  newPassword: boolean;
  confirmPassword: boolean;
};

type DrawingState = {
  pointerId: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
};

function createDataFlowEndpoint(type = ""): DataFlowEndpoint {
  return {
    id: crypto.randomUUID(),
    type,
    name: "",
    detail: "",
  };
}

function createDataFlowField(): DataFlowFieldMap {
  return {
    id: crypto.randomUUID(),
    sourceField: "",
    targetField: "",
    type: "",
    required: false,
    transform: "",
    note: "",
  };
}

function getImageDisplayName(name: string) {
  return name.replace(/\.[^./\\]+$/, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function readImages(files: File[]) {
  return Promise.all(
    files
      .filter((file) => file.type.startsWith("image/"))
      .map(
        (file) =>
          new Promise<DesignImage>((resolve) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              resolve({
                id: crypto.randomUUID(),
                name: getImageDisplayName(file.name),
                src: String(reader.result),
                annotations: [],
                texts: [],
              });
            });
            reader.readAsDataURL(file);
          }),
      ),
  );
}

function parseSwagger(swagger: unknown): ApiItem[] {
  if (!swagger || typeof swagger !== "object") return [];
  const root = swagger as { paths?: unknown; components?: unknown; definitions?: unknown };
  if (!root.paths || typeof root.paths !== "object") return [];
  const paths = root.paths as Record<string, Record<string, unknown>>;
  const methods = ["get", "post", "put", "patch", "delete", "options", "head"];
  return Object.entries(paths).flatMap(([path, config]) =>
    methods
      .filter((method) => config?.[method] && typeof config[method] === "object")
      .map((method) => {
        const detail = config[method] as {
          summary?: string;
          operationId?: string;
          description?: string;
          tags?: string[];
          parameters?: unknown;
          requestBody?: unknown;
          responses?: unknown;
        };
        const allParameters = [...(Array.isArray(config.parameters) ? config.parameters : []), ...(Array.isArray(detail.parameters) ? detail.parameters : [])];
        return {
          id: `${method.toUpperCase()} ${path}`,
          method: method.toUpperCase(),
          path,
          title: detail.summary || detail.operationId || "未命名接口",
          description: detail.description || "",
          tags: detail.tags || [],
          parameters: parseParameters(allParameters, root),
          requestFields: dedupeApiFields([...parseBodyParameterFields(allParameters, root), ...parseBodyFields(detail.requestBody, root)]),
          responseFields: parseResponseFields(detail.responses, root),
        };
      }),
  );
}

function parseParameters(parameters: unknown, root: object): ApiField[] {
  if (!Array.isArray(parameters)) return [];
  return parameters.flatMap((parameter) => {
    const item = (resolveRef(parameter, root) || {}) as {
      name?: string;
      in?: string;
      required?: boolean;
      description?: string;
      schema?: unknown;
      type?: string;
    };
    if (item.in === "body") return [];
    const schema = resolveRef(item.schema, root);
    return [{
      name: item.in ? `${item.in}.${item.name || "未命名参数"}` : item.name || "未命名参数",
      type: getSchemaType(schema || item),
      required: Boolean(item.required),
      description: item.description || "",
      source: "parameter",
    }];
  });
}

function parseBodyParameterFields(parameters: unknown, root: object): ApiField[] {
  if (!Array.isArray(parameters)) return [];
  return parameters.flatMap((parameter) => {
    const item = (resolveRef(parameter, root) || {}) as {
      name?: string;
      in?: string;
      required?: boolean;
      description?: string;
      schema?: unknown;
    };
    if (item.in !== "body" || !item.schema) return [];
    const fields = flattenSchema(item.schema, root).map((field) => ({
      ...field,
      required: field.required || Boolean(item.required),
      source: "body",
    }));
    if (fields.length) return fields;
    return [{
      name: item.name || "body",
      type: getSchemaType(resolveRef(item.schema, root)),
      required: Boolean(item.required),
      description: item.description || "",
      source: "body",
    }];
  });
}

function parseBodyFields(body: unknown, root: object): ApiField[] {
  const resolved = resolveRef(body, root) as { content?: Record<string, { schema?: unknown }>; schema?: unknown; required?: boolean } | null;
  const schema = resolved?.content ? pickJsonSchema(resolved.content) : resolved?.schema;
  return flattenSchema(schema, root);
}

function parseResponseFields(responses: unknown, root: object): ApiField[] {
  if (!responses || typeof responses !== "object") return [];
  const map = responses as Record<string, { content?: Record<string, { schema?: unknown }>; schema?: unknown }>;
  const status = ["200", "201", "default", ...Object.keys(map)].find((key) => map[key]);
  if (!status) return [];
  const response = resolveRef(map[status], root) as { content?: Record<string, { schema?: unknown }>; schema?: unknown } | null;
  const schema = response?.content ? pickJsonSchema(response.content) : response?.schema;
  return flattenSchema(schema, root);
}

function pickJsonSchema(content: Record<string, { schema?: unknown }>) {
  return (
    content["application/json"]?.schema ||
    content["application/*+json"]?.schema ||
    Object.entries(content).find(([type]) => type.includes("json"))?.[1].schema ||
    Object.values(content)[0]?.schema
  );
}

function flattenSchema(schema: unknown, root: object, prefix = "", depth = 0, parentRequired: string[] = []): ApiField[] {
  const resolved = resolveRef(schema, root) as {
    type?: string;
    format?: string;
    description?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    allOf?: unknown[];
    oneOf?: unknown[];
    anyOf?: unknown[];
  } | null;
  if (!resolved || depth > 4) return [];
  const combined = [...(resolved.allOf || []), ...(resolved.oneOf || []), ...(resolved.anyOf || [])];
  if (combined.length) {
    return combined.flatMap((item) => flattenSchema(item, root, prefix, depth + 1, parentRequired));
  }
  if (resolved.type === "array" && resolved.items) {
    return flattenSchema(resolved.items, root, prefix, depth + 1, parentRequired).map((field) => ({
      ...field,
      type: field.type.endsWith("[]") ? field.type : `${field.type}[]`,
    }));
  }
  if (!resolved.properties || typeof resolved.properties !== "object") {
    if (!prefix) return [];
    return [
      {
        name: prefix,
        type: getSchemaType(resolved),
        required: parentRequired.includes(prefix.split(".").at(-1) || prefix),
        description: resolved.description || "",
      },
    ];
  }
  const required = resolved.required || [];
  return Object.entries(resolved.properties).flatMap(([name, property]) => {
    const fieldName = prefix ? `${prefix}.${name}` : name;
    const propertySchema = resolveRef(property, root) as { description?: string; properties?: Record<string, unknown>; type?: string; items?: unknown } | null;
    const field: ApiField = {
      name: fieldName,
      type: getSchemaType(propertySchema),
      required: required.includes(name),
      description: propertySchema?.description || "",
    };
    const children =
      propertySchema?.properties || propertySchema?.items
        ? flattenSchema(propertySchema.type === "array" ? propertySchema.items : propertySchema, root, fieldName, depth + 1, required)
        : [];
    return children.length ? [field, ...children] : [field];
  });
}

function resolveRef(value: unknown, root: object): unknown {
  if (!value || typeof value !== "object" || !("$ref" in value)) return value;
  const ref = String((value as { $ref: string }).$ref);
  if (!ref.startsWith("#/")) return value;
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((target, segment) => {
      if (!target || typeof target !== "object") return undefined;
      return (target as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
    }, root);
}

function getSchemaType(schema: unknown): string {
  const resolved = schema as { type?: string; format?: string; enum?: unknown[]; items?: unknown; properties?: unknown; $ref?: string } | null;
  if (!resolved || typeof resolved !== "object") return "unknown";
  if (resolved.enum) return "enum";
  if (resolved.$ref) return resolved.$ref.split("/").at(-1) || "object";
  if (resolved.type === "array") return `${getSchemaType(resolved.items)}[]`;
  if (resolved.type) return resolved.format ? `${resolved.type}<${resolved.format}>` : resolved.type;
  if (resolved.properties) return "object";
  return "unknown";
}

function dedupeApiFields(fields: ApiField[]): ApiField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.source || ""}:${field.name}:${field.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeApiSearchText(value: string) {
  const trimmed = value.trim();
  let text = trimmed;
  try {
    const url = new URL(trimmed);
    text = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    text = trimmed.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "");
  }
  try {
    text = decodeURIComponent(text);
  } catch {
    text = text.replace(/%[0-9a-f]{0,2}/gi, "");
  }
  return text.toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function apiSearchNeedles(term: string) {
  const values = new Set<string>();
  const normalized = normalizeApiSearchText(term);
  const withoutQuery = normalized.split(/[?#]/)[0];
  const withoutTrailingSlash = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
  [normalized, withoutQuery, withoutTrailingSlash].forEach((item) => {
    if (item) values.add(item);
  });
  return [...values];
}

function apiSearchHaystack(api: ApiItem) {
  const fields = [...api.parameters, ...api.requestFields, ...api.responseFields];
  return normalizeApiSearchText(
    [
      api.method,
      api.path,
      api.title,
      api.description,
      ...api.tags,
      ...fields.flatMap((field) => [field.name, field.type, field.description, field.source || ""]),
    ].join(" "),
  );
}

function matchesApiSearch(api: ApiItem, query: string) {
  const terms = normalizeApiSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const haystack = apiSearchHaystack(api);
  return terms.every((term) => apiSearchNeedles(term).some((needle) => haystack.includes(needle)));
}

function normalizeFieldName(value: string) {
  return value.trim().toLowerCase();
}

function loadView(): ViewName {
  const saved = localStorage.getItem("abs.view");
  return saved === "projects" || saved === "workspace" || saved === "permissions" || saved === "logs" ? saved : "home";
}

function loadStoredId(key: string) {
  return localStorage.getItem(key) || null;
}

export default function App() {
  const [view, setView] = useState<ViewName>(loadView);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadStoredId("abs.activeProjectId"));
  const [activeImageId, setActiveImageId] = useState<string | null>(() => loadStoredId("abs.activeImageId"));
  const [permissionProjectId, setPermissionProjectId] = useState<string | null>(() => loadStoredId("abs.permissionProjectId"));
  const [tool, setTool] = useState<ToolName>("select");
  const [textStyle, setTextStyle] = useState<TextStyle>(emptyTextStyle);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [pagesCollapsed, setPagesCollapsed] = useState(false);
  const [apisCollapsed, setApisCollapsed] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [toast, setToast] = useState("");
  const [showPassword, setShowPassword] = useState<PasswordFields>({
    oldPassword: false,
    password: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [renamingImageId, setRenamingImageId] = useState<string | null>(null);
  const [imageNameDraft, setImageNameDraft] = useState("");
  const [imageZoom, setImageZoom] = useState(1);
  const [imageBaseSize, setImageBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [apiSearchQuery, setApiSearchQuery] = useState("");
  const [dataFlowApiQuery, setDataFlowApiQuery] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>(emptyAnnotationDraft);
  const [jumpTargets, setJumpTargets] = useState<AnnotationJumpTarget[] | null>(null);
  const [dataFlowOpen, setDataFlowOpen] = useState(false);
  const [dataFlowDraft, setDataFlowDraft] = useState<DataFlow | null>(null);
  const [popoverStyle, setPopoverStyle] = useState({ left: 0, top: 0 });
  const [overlayRect, setOverlayRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [draftRect, setDraftRect] = useState<Rect | null>(null);

  const { accounts, currentUser, projects, bootstrapped, setProjects, applyBootstrap } = useProjects({ notify });
  const { pushHistory, popHistory } = useHistory<Snapshot>();

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const projectImageInputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef<DrawingState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const textEditRef = useRef<{ id: string; content: string } | null>(null);
  const pendingJumpAnnotationRef = useRef<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects],
  );
  const activeImage = useMemo(
    () => activeProject?.images.find((image) => image.id === activeImageId) || null,
    [activeImageId, activeProject],
  );
  const selectedAnnotation = useMemo(
    () => activeImage?.annotations.find((annotation) => annotation.id === selectedAnnotationId) || null,
    [activeImage, selectedAnnotationId],
  );
  const filteredApis = useMemo(
    () => (activeProject?.apis || []).filter((api) => matchesApiSearch(api, apiSearchQuery)),
    [activeProject, apiSearchQuery],
  );
  const permissionProject = useMemo(
    () => projects.find((project) => project.id === permissionProjectId) || projects[0] || null,
    [permissionProjectId, projects],
  );
  const permissionDisplayProject = useMemo<Project>(
    () =>
      permissionProject || {
        id: "permission-placeholder",
        name: "默认权限状态",
        defaultImageId: null,
        images: [],
        apis: [],
        permissions: {},
        logs: [],
      },
    [permissionProject],
  );
  const currentAccount = accounts.find((account) => account.username === currentUser) || null;
  const isRoot = Boolean(currentAccount?.isRoot);

  useEffect(() => {
    localStorage.setItem("abs.view", view);
  }, [view]);

  useEffect(() => {
    if (activeProjectId) localStorage.setItem("abs.activeProjectId", activeProjectId);
    else localStorage.removeItem("abs.activeProjectId");
  }, [activeProjectId]);

  useEffect(() => {
    if (activeImageId) localStorage.setItem("abs.activeImageId", activeImageId);
    else localStorage.removeItem("abs.activeImageId");
  }, [activeImageId]);

  useEffect(() => {
    if (permissionProjectId) localStorage.setItem("abs.permissionProjectId", permissionProjectId);
    else localStorage.removeItem("abs.permissionProjectId");
  }, [permissionProjectId]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (!activeProjectId && (view === "workspace" || view === "logs")) {
      setView("projects");
      return;
    }
    if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
      setActiveProjectId(null);
      setActiveImageId(null);
      if (view === "workspace" || view === "logs") setView("projects");
    }
  }, [activeProjectId, bootstrapped, projects, view]);

  useEffect(() => {
    if (!activeProject) return;
    if (!activeImageId || !activeProject.images.some((image) => image.id === activeImageId)) {
      setActiveImageId(activeProject.defaultImageId || activeProject.images[0]?.id || null);
    }
  }, [activeImageId, activeProject]);

  useEffect(() => {
    setImageZoom(1);
    setImageBaseSize(null);
    const pendingAnnotationId = pendingJumpAnnotationRef.current;
    pendingJumpAnnotationRef.current = null;
    setSelectedAnnotationId(pendingAnnotationId);
    setSelectedTextId(null);
    setDraftRect(null);
    setRenamingImageId(null);
    setImageNameDraft("");
  }, [activeImageId]);

  useEffect(() => {
    updateImageBaseSize();
    if (!stageRef.current) return;
    const observer = new ResizeObserver(updateImageBaseSize);
    observer.observe(stageRef.current);
    window.addEventListener("resize", updateImageBaseSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateImageBaseSize);
    };
  }, [activeImageId, view]);

  useEffect(() => {
    syncOverlay();
    const annotation = activeImage?.annotations.find((item) => item.id === selectedAnnotationId);
    if (annotation) positionAnnotationPopover(annotation);
  }, [activeImage, imageBaseSize, imageZoom, selectedAnnotationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormInput =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const isUndo = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey);
      if (isUndo) {
        event.preventDefault();
        undo();
        return;
      }
      if (!shortcuts.deleteSelected.includes(event.key)) return;
      if (isFormInput || target?.isContentEditable) return;
      deleteSelectedContent();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function rememberHistory() {
    pushHistory({
      projects,
      activeProjectId,
      activeImageId,
    });
  }

  function undo() {
    const snapshot = popHistory();
    if (!snapshot) return;
    setProjects(snapshot.projects);
    setActiveProjectId(snapshot.activeProjectId);
    setActiveImageId(snapshot.activeImageId);
    setSelectedAnnotationId(null);
    setSelectedTextId(null);
  }

  function addProjectLog(project: Project, action: string): Project {
    return {
      ...project,
      logs: [
        ...project.logs,
        {
          id: crypto.randomUUID(),
          time: new Date().toISOString(),
          username: currentUser || "游客",
          action,
        },
      ],
    };
  }

  function updateProject(projectId: string, action: string, updater: (project: Project) => Project) {
    rememberHistory();
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) return project;
        return addProjectLog(updater(project), action);
      }),
    );
  }

  function hasPermission(project: Project | null, permission: PermissionKey) {
    if (!currentUser || !project) return false;
    if (isRoot) return true;
    const userPermissions = project.permissions[currentUser] || [];
    return userPermissions.includes("admin") || userPermissions.includes(permission);
  }

  function canEdit(project: Project | null, permission: PermissionKey) {
    if (!currentUser) return false;
    return hasPermission(project, permission);
  }

  function ensureEdit(project: Project | null, permission: PermissionKey) {
    if (!currentUser) {
      notify(text.loginRequired);
      return false;
    }
    if (!canEdit(project, permission)) {
      notify(text.noPermission);
      return false;
    }
    return true;
  }

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setShowPassword((value) => ({ ...value, password: false }));
    setAuthOpen(true);
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const formData = new FormData(event.currentTarget);
      const username = String(formData.get("username") || "").trim();
      const password = String(formData.get("password") || "");
      if (!username || !isPasswordValid(password)) {
        notify(text.passwordRule);
        return;
      }
      const passwordHash = await hashPassword(password);
      if (authMode === "register") {
        const authData = await apiRequest<BootstrapPayload>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ username, passwordHash }),
        });
        applyBootstrap(authData);
        setAuthOpen(false);
        notify("注册成功，已登录");
        return;
      }
      const authData = await apiRequest<BootstrapPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, passwordHash }),
      });
      applyBootstrap(authData);
      setAuthOpen(false);
      notify("登录成功");
    } catch (error) {
      notify(error instanceof Error ? error.message : "认证失败，请重试");
    }
  }

  async function submitPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentAccount) return;
    try {
      const formData = new FormData(event.currentTarget);
      const oldPassword = String(formData.get("oldPassword") || "");
      const newPassword = String(formData.get("newPassword") || "");
      const confirmPassword = String(formData.get("confirmPassword") || "");
      if (!isPasswordValid(newPassword)) {
        notify(text.passwordRule);
        return;
      }
      if (newPassword !== confirmPassword) {
        notify("两次输入的新密码不一致");
        return;
      }
      const oldPasswordHash = await hashPassword(oldPassword);
      const newPasswordHash = await hashPassword(newPassword);
      const authData = await apiRequest<BootstrapPayload>("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ oldPasswordHash, newPasswordHash }),
      });
      applyBootstrap(authData);
      setAccountOpen(false);
      notify("密码已修改");
    } catch (error) {
      notify(error instanceof Error ? error.message : "密码修改失败，请重试");
    }
  }

  async function logout() {
    try {
      const data = await apiRequest<BootstrapPayload>("/api/auth/logout", { method: "POST" });
      applyBootstrap(data);
      notify("已退出");
    } catch (error) {
      notify(error instanceof Error ? error.message : "退出失败");
    }
  }

  function openProjectDraft(project?: Project) {
    if (!currentUser) {
      notify(text.loginRequired);
      return;
    }
    if (project && !hasPermission(project, "editProject")) {
      notify(text.noPermission);
      return;
    }
    setProjectDraft({
      id: project?.id || crypto.randomUUID(),
      isNew: !project,
      name: project?.name || "未命名项目",
      defaultImageId: project?.defaultImageId || null,
      images: project ? structuredClone(project.images) : [],
    });
  }

  function openNewProjectDraft() {
    if (!currentUser) {
      notify(text.loginRequired);
      return;
    }
    setProjectDraft({
      id: crypto.randomUUID(),
      isNew: true,
      name: "未命名项目",
      defaultImageId: null,
      images: [],
    });
  }

  async function addImagesToProjectDraft(files: FileList | null) {
    if (!projectDraft || !files) return;
    const images = await readImages([...files]);
    setProjectDraft((draft) => {
      if (!draft) return draft;
      return {
        ...draft,
        images: [...draft.images, ...images],
        defaultImageId: draft.defaultImageId || images[0]?.id || null,
      };
    });
  }

  function saveProjectDraft() {
    if (!projectDraft || !currentUser) return;
    rememberHistory();
    if (projectDraft.isNew) {
      const project: Project = {
        id: projectDraft.id,
        name: projectDraft.name.trim() || "未命名项目",
        owner: currentUser,
        defaultImageId: projectDraft.defaultImageId || projectDraft.images[0]?.id || null,
        images: projectDraft.images,
        apis: [],
        dataFlows: [],
        permissions: {
          [currentUser]: ["admin"],
        },
        logs: [],
      };
      setProjects((current) => [...current, addProjectLog(project, "创建项目")]);
      setProjectDraft(null);
      return;
    }
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectDraft.id) return project;
        return addProjectLog(
          {
            ...project,
            name: projectDraft.name.trim() || "未命名项目",
            defaultImageId: projectDraft.defaultImageId || projectDraft.images[0]?.id || null,
            images: projectDraft.images,
          },
          "编辑项目",
        );
      }),
    );
    setProjectDraft(null);
  }

  function deleteProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project || !ensureEdit(project, "admin")) return;
    rememberHistory();
    setProjects((current) => current.filter((item) => item.id !== projectId));
    setProjectDraft(null);
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setActiveImageId(null);
    }
  }

  function enterProject(project: Project) {
    setActiveProjectId(project.id);
    setActiveImageId(project.defaultImageId || project.images[0]?.id || null);
    setSelectedAnnotationId(null);
    setSelectedTextId(null);
    setJumpTargets(null);
    setView("workspace");
  }

  async function importImages(files: FileList | null) {
    if (!activeProject || !ensureEdit(activeProject, "editImage") || !files) return;
    const images = await readImages([...files]);
    if (!images.length) return;
    updateProject(activeProject.id, `导入图片：${images.map((image) => image.name).join("、")}`, (project) => ({
      ...project,
      images: [...project.images, ...images],
      defaultImageId: project.defaultImageId || images[0].id,
    }));
    setActiveImageId(images[0].id);
  }

  function deleteImage(imageId: string) {
    if (!activeProject || !ensureEdit(activeProject, "editImage")) return;
    updateProject(activeProject.id, "删除图片", (project) => {
      const images = project.images.filter((image) => image.id !== imageId);
      return {
        ...project,
        images,
        defaultImageId: project.defaultImageId === imageId ? images[0]?.id || null : project.defaultImageId,
      };
    });
    if (activeImageId === imageId) {
      const next = activeProject.images.find((image) => image.id !== imageId);
      setActiveImageId(next?.id || null);
    }
  }

  function startRenameImage(image: DesignImage) {
    if (!activeProject || !ensureEdit(activeProject, "editImage")) return;
    setRenamingImageId(image.id);
    setImageNameDraft(getImageDisplayName(image.name));
  }

  function saveImageName(image: DesignImage) {
    if (renamingImageId !== image.id) return;
    const nextName = imageNameDraft.trim();
    setRenamingImageId(null);
    if (!nextName) {
      notify("图片名称不能为空");
      return;
    }
    if (nextName === getImageDisplayName(image.name)) return;
    updateImage(image.id, `修改图片名：${nextName}`, (item) => ({ ...item, name: nextName }));
  }

  function cancelRenameImage() {
    setRenamingImageId(null);
    setImageNameDraft("");
  }

  async function importJson(file: File | null) {
    if (!file) return;
    if (!activeProject) {
      notify("请先进入项目后再导入接口");
      return;
    }
    if (!ensureEdit(activeProject, "editInterface")) return;
    try {
      const raw = await file.text();
      if (!raw.trim()) {
        notify("JSON 文件为空");
        return;
      }
      if (/^\s*(openapi|swagger|paths)\s*:/m.test(raw)) {
        notify("当前文件看起来是 YAML，请导出 JSON 格式后再导入");
        return;
      }
      const apis = parseSwagger(JSON.parse(raw));
      if (!apis.length) {
        notify("未解析到接口：请确认 JSON 包含 paths 和 HTTP 方法");
        return;
      }
      updateProject(activeProject.id, `更新接口：${file.name}`, (project) => ({ ...project, apis }));
      notify(`已导入 ${apis.length} 个接口`);
    } catch {
      notify("JSON 解析失败，请检查文件格式");
    }
  }

  function updateImageBaseSize() {
    if (!stageRef.current || !imageRef.current || !activeImage) return;
    const naturalWidth = imageRef.current.naturalWidth;
    const naturalHeight = imageRef.current.naturalHeight;
    if (!naturalWidth || !naturalHeight) return;
    const availableWidth = Math.max(stageRef.current.clientWidth - 44, 120);
    const availableHeight = Math.max(stageRef.current.clientHeight - 44, 120);
    const fit = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1);
    setImageBaseSize({
      width: Math.max(1, Math.round(naturalWidth * fit)),
      height: Math.max(1, Math.round(naturalHeight * fit)),
    });
    window.requestAnimationFrame(syncOverlay);
  }

  function getOverlayStageRect() {
    if (!stageRef.current || !overlayRef.current) return null;
    const overlayBox = overlayRef.current.getBoundingClientRect();
    const stageBox = stageRef.current.getBoundingClientRect();
    return {
      left: overlayBox.left - stageBox.left + stageRef.current.scrollLeft,
      top: overlayBox.top - stageBox.top + stageRef.current.scrollTop,
      width: overlayBox.width,
      height: overlayBox.height,
    };
  }

  function syncOverlay() {
    if (!activeImage) return;
    const rect = getOverlayStageRect();
    if (rect) setOverlayRect(rect);
  }

  function onStageWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!activeImage || !stageRef.current || !imageFrameRef.current) return;
    if ((event.target as HTMLElement | null)?.closest(".annotation-popover")) return;
    event.preventDefault();
    const stage = stageRef.current;
    const frame = imageFrameRef.current;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const frameBox = frame.getBoundingClientRect();
    const anchorX = clamp((clientX - frameBox.left) / frameBox.width, 0, 1);
    const anchorY = clamp((clientY - frameBox.top) / frameBox.height, 0, 1);
    const nextZoom = Number(clamp(imageZoom * (event.deltaY < 0 ? 1.12 : 0.88), 0.3, 5).toFixed(3));
    if (nextZoom === imageZoom) return;
    flushSync(() => setImageZoom(nextZoom));
    const nextBox = imageFrameRef.current?.getBoundingClientRect();
    if (!nextBox) return;
    stage.scrollLeft += nextBox.left + nextBox.width * anchorX - clientX;
    stage.scrollTop += nextBox.top + nextBox.height * anchorY - clientY;
    syncOverlay();
  }

  function canStartStagePan(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (tool !== "select") return false;
    if (target.closest(".annotation-popover, .annotation-box, .text-label, .draft-box")) return false;
    if (target === overlayRef.current) return true;
    if (target.closest(".image-stage-frame")) return overlayRef.current?.classList.contains("is-hidden-layer") || false;
    return Boolean(target.closest(".stage"));
  }

  function onStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeImage || !stageRef.current || event.button !== 0 || !canStartStagePan(event.target)) return;
    event.preventDefault();
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stageRef.current.scrollLeft,
      scrollTop: stageRef.current.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("is-panning");
  }

  function onStagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !stageRef.current) return;
    stageRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    stageRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    syncOverlay();
  }

  function finishStagePan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.classList.remove("is-panning");
    syncOverlay();
  }

  function getOverlayPoint(event: React.PointerEvent) {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  function normalizeRect(drawing: DrawingState): Rect {
    const left = Math.min(drawing.startX, drawing.endX);
    const top = Math.min(drawing.startY, drawing.endY);
    const right = Math.max(drawing.startX, drawing.endX);
    const bottom = Math.max(drawing.startY, drawing.endY);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function onOverlayPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!activeProject || !activeImage || event.target !== overlayRef.current) return;
    setSelectedAnnotationId(null);
    setSelectedTextId(null);
    if (tool === "select") return;
    if (!ensureEdit(activeProject, "editContent")) return;
    const point = getOverlayPoint(event);
    if (tool === "text") {
      const id = crypto.randomUUID();
      updateImage(activeImage.id, "添加文本", (image) => ({
        ...image,
        texts: [...image.texts, { id, x: point.x, y: point.y, content: "", ...textStyle }],
      }));
      setSelectedTextId(id);
      return;
    }
    if (tool !== "box") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    setDraftRect(normalizeRect(drawingRef.current));
  }

  function onOverlayPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawingRef.current || drawingRef.current.pointerId !== event.pointerId) return;
    const point = getOverlayPoint(event);
    drawingRef.current.endX = point.x;
    drawingRef.current.endY = point.y;
    setDraftRect(normalizeRect(drawingRef.current));
  }

  function onOverlayPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drawing = drawingRef.current;
    if (!drawing || drawing.pointerId !== event.pointerId || !activeImage) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drawingRef.current = null;
    setDraftRect(null);
    const rect = normalizeRect(drawing);
    if (rect.width < 0.015 || rect.height < 0.015) return;
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      name: "",
      rect,
      interaction: "",
      api: "",
      note: "",
      linkTag: "",
    };
    updateImage(activeImage.id, "添加标注", (image) => ({
      ...image,
      annotations: [...image.annotations, annotation],
    }));
    setAnnotationDraft(emptyAnnotationDraft);
    setSelectedAnnotationId(annotation.id);
  }

  function updateImage(imageId: string, action: string, updater: (image: DesignImage) => DesignImage) {
    if (!activeProject) return;
    updateProject(activeProject.id, action, (project) => ({
      ...project,
      images: project.images.map((image) => (image.id === imageId ? updater(image) : image)),
    }));
  }

  function positionAnnotationPopover(annotation: Annotation) {
    const rect = getOverlayStageRect() || overlayRect;
    const left = rect.left + rect.width * (annotation.rect.x + annotation.rect.width) + 10;
    const top = rect.top + rect.height * annotation.rect.y;
    setPopoverStyle({
      left: Math.min(left, (stageRef.current?.clientWidth || 0) - 290),
      top: Math.max(12, Math.min(top, (stageRef.current?.clientHeight || 0) - 360)),
    });
    if (rect) setOverlayRect(rect);
  }

  function openAnnotation(annotation: Annotation) {
    setSelectedAnnotationId(annotation.id);
    setSelectedTextId(null);
    setAnnotationDraft({
      name: annotation.name || "",
      interaction: annotation.interaction,
      api: annotation.api,
      note: annotation.note,
      linkTag: annotation.linkTag || "",
    });
    positionAnnotationPopover(annotation);
  }

  function buildJumpTargets(annotation: Annotation) {
    if (!activeProject) return [];
    const tag = annotation.linkTag?.trim();
    if (!tag) return [];
    return activeProject.images.flatMap((image) =>
      image.annotations
        .filter((candidate) => candidate.id !== annotation.id && candidate.linkTag?.trim() === tag)
        .map((candidate) => {
          const apiTitle = activeProject.apis.find((api) => api.id === candidate.api)?.title || "";
          return {
            imageId: image.id,
            imageName: image.name,
            annotation: candidate,
            apiTitle,
            tag,
          };
        }),
    );
  }

  function applyAnnotationDraft(annotation: Annotation) {
    setAnnotationDraft({
      name: annotation.name || "",
      interaction: annotation.interaction,
      api: annotation.api,
      note: annotation.note,
      linkTag: annotation.linkTag || "",
    });
  }

  function jumpToAnnotation(target: AnnotationJumpTarget) {
    setJumpTargets(null);
    setView("workspace");
    setSelectedTextId(null);
    applyAnnotationDraft(target.annotation);
    if (target.imageId === activeImageId) {
      setSelectedAnnotationId(target.annotation.id);
      return;
    }
    pendingJumpAnnotationRef.current = target.annotation.id;
    setActiveImageId(target.imageId);
  }

  function openRelationJump() {
    if (!selectedAnnotation) {
      notify(text.selectAnnotationFirst);
      return;
    }
    if (!selectedAnnotation.linkTag?.trim()) {
      notify(text.relationTagRequired);
      return;
    }
    const targets = buildJumpTargets(selectedAnnotation);
    if (!targets.length) {
      notify(text.noRelationTarget);
      return;
    }
    if (targets.length === 1) {
      jumpToAnnotation(targets[0]);
      return;
    }
    setJumpTargets(targets);
  }

  function saveAnnotation() {
    if (!activeImage || !selectedAnnotationId) return;
    const nextDraft = {
      ...annotationDraft,
      name: annotationDraft.name.trim(),
      linkTag: annotationDraft.linkTag.trim(),
    };
    updateImage(activeImage.id, "编辑标注内容", (image) => ({
      ...image,
      annotations: image.annotations.map((annotation) =>
        annotation.id === selectedAnnotationId ? { ...annotation, ...nextDraft } : annotation,
      ),
    }));
    setSelectedAnnotationId(null);
  }

  function annotationLabel(annotation: Annotation) {
    return annotation.name || annotation.interaction || annotation.note || text.annotationFallback;
  }

  function createDataFlowDraft(): DataFlow {
    return {
      id: crypto.randomUUID(),
      name: selectedAnnotation?.name || (activeImage ? `${getImageDisplayName(activeImage.name)} 数据流` : "数据流"),
      imageId: activeImageId || "",
      annotationId: selectedAnnotationId || "",
      apiIds: selectedAnnotation?.api ? [selectedAnnotation.api] : [],
      sources: [createDataFlowEndpoint("页面输入")],
      targets: [createDataFlowEndpoint("后端接口")],
      fields: [createDataFlowField()],
      condition: "",
      transform: "",
      note: "",
    };
  }

  function cleanDataFlow(flow: DataFlow): DataFlow {
    const endpoints = (items: DataFlowEndpoint[]) =>
      items
        .map((item) => ({
          ...item,
          type: item.type.trim(),
          name: item.name.trim(),
          detail: item.detail.trim(),
        }))
        .filter((item) => item.type || item.name || item.detail);
    const fields = flow.fields
      .map((field) => ({
        ...field,
        sourceField: field.sourceField.trim(),
        targetField: field.targetField.trim(),
        type: field.type.trim(),
        transform: field.transform.trim(),
        note: field.note.trim(),
      }))
      .filter((field) => field.sourceField || field.targetField || field.type || field.transform || field.note);
    return {
      ...flow,
      name: flow.name.trim() || "数据流",
      imageId: flow.imageId,
      annotationId: flow.annotationId,
      apiIds: Array.from(new Set(flow.apiIds.filter(Boolean))),
      sources: endpoints(flow.sources),
      targets: endpoints(flow.targets),
      fields,
      condition: flow.condition.trim(),
      transform: flow.transform.trim(),
      note: flow.note.trim(),
    };
  }

  function openDataFlows() {
    if (!activeProject) return;
    const preferred = selectedAnnotationId
      ? activeProject.dataFlows.find((flow) => flow.annotationId === selectedAnnotationId)
      : null;
    setDataFlowDraft(structuredClone(preferred || activeProject.dataFlows[0] || createDataFlowDraft()));
    setDataFlowOpen(true);
  }

  function startNewDataFlow() {
    setDataFlowDraft(createDataFlowDraft());
  }

  function saveDataFlowDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProject || !dataFlowDraft || !ensureEdit(activeProject, "editContent")) return;
    const next = cleanDataFlow(dataFlowDraft);
    const exists = activeProject.dataFlows.some((flow) => flow.id === next.id);
    updateProject(activeProject.id, `${exists ? "更新" : "新增"}数据流：${next.name}`, (project) => ({
      ...project,
      dataFlows: exists
        ? project.dataFlows.map((flow) => (flow.id === next.id ? next : flow))
        : [...project.dataFlows, next],
    }));
    setDataFlowDraft(next);
  }

  function deleteDataFlow(flowId: string) {
    if (!activeProject || !ensureEdit(activeProject, "editContent")) return;
    const flow = activeProject.dataFlows.find((item) => item.id === flowId);
    const remaining = activeProject.dataFlows.filter((item) => item.id !== flowId);
    updateProject(activeProject.id, `删除数据流：${flow?.name || "数据流"}`, (project) => ({
      ...project,
      dataFlows: project.dataFlows.filter((item) => item.id !== flowId),
    }));
    setDataFlowDraft(remaining[0] ? structuredClone(remaining[0]) : createDataFlowDraft());
  }

  function updateDataFlowEndpoint(group: "sources" | "targets", endpointId: string, patch: Partial<DataFlowEndpoint>) {
    setDataFlowDraft((draft) =>
      draft
        ? {
            ...draft,
            [group]: draft[group].map((endpoint) => (endpoint.id === endpointId ? { ...endpoint, ...patch } : endpoint)),
          }
        : draft,
    );
  }

  function addDataFlowEndpoint(group: "sources" | "targets", type: string) {
    setDataFlowDraft((draft) =>
      draft
        ? {
            ...draft,
            [group]: [...draft[group], createDataFlowEndpoint(type)],
          }
        : draft,
    );
  }

  function removeDataFlowEndpoint(group: "sources" | "targets", endpointId: string) {
    setDataFlowDraft((draft) =>
      draft
        ? {
            ...draft,
            [group]: draft[group].filter((endpoint) => endpoint.id !== endpointId),
          }
        : draft,
    );
  }

  function updateDataFlowField(fieldId: string, patch: Partial<DataFlowFieldMap>) {
    setDataFlowDraft((draft) =>
      draft
        ? {
            ...draft,
            fields: draft.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
          }
        : draft,
    );
  }

  function addDataFlowField() {
    setDataFlowDraft((draft) => (draft ? { ...draft, fields: [...draft.fields, createDataFlowField()] } : draft));
  }

  function selectedDataFlowApis(flow: DataFlow) {
    if (!activeProject) return [];
    return activeProject.apis.filter((api) => flow.apiIds.includes(api.id));
  }

  function filteredDataFlowApis(flow: DataFlow) {
    if (!activeProject) return [];
    return activeProject.apis.filter((api) => flow.apiIds.includes(api.id) || matchesApiSearch(api, dataFlowApiQuery));
  }

  function apiFlowFields(api: ApiItem) {
    return [...api.parameters, ...api.requestFields, ...api.responseFields];
  }

  function importApiFieldsToDataFlow() {
    if (!dataFlowDraft || !activeProject) return;
    const apis = selectedDataFlowApis(dataFlowDraft);
    if (!apis.length) {
      notify("请先选择关联接口");
      return;
    }
    setDataFlowDraft((draft) => {
      if (!draft) return draft;
      const existing = new Set(
        draft.fields.map((field) => `${normalizeFieldName(field.sourceField)}::${normalizeFieldName(field.targetField)}`),
      );
      const imported = apis.flatMap((api) =>
        apiFlowFields(api).map((field) => {
          const fieldName = field.name || "";
          return {
            id: crypto.randomUUID(),
            sourceField: fieldName,
            targetField: fieldName,
            type: field.type || "",
            required: Boolean(field.required),
            transform: "",
            note: field.description || `${api.method} ${api.path}`,
          };
        }),
      );
      const nextFields = imported.filter((field) => {
        const key = `${normalizeFieldName(field.sourceField)}::${normalizeFieldName(field.targetField)}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return Boolean(field.sourceField || field.targetField);
      });
      if (!nextFields.length) {
        return draft;
      }
      return {
        ...draft,
        fields: [
          ...draft.fields.filter((field) => field.sourceField || field.targetField || field.type || field.transform || field.note),
          ...nextFields,
        ],
      };
    });
  }

  function dataFlowSummary(flow: DataFlow) {
    const sourceText = flow.sources.map((source) => source.name || source.type).filter(Boolean).join("、") || "未设置来源";
    const targetText = flow.targets.map((target) => target.name || target.type).filter(Boolean).join("、") || "未设置去向";
    const apiCount = flow.apiIds.length;
    return `${sourceText} -> ${targetText} / ${flow.fields.length} 字段 / ${apiCount} 接口`;
  }

  function dataFlowChecks(flow: DataFlow) {
    const issues: string[] = [];
    if (!flow.sources.length) issues.push("缺少数据来源");
    if (!flow.targets.length) issues.push("缺少数据去向");
    if (!flow.fields.length) issues.push("缺少字段映射");

    const mappedNames = new Set(
      flow.fields.flatMap((field) => [normalizeFieldName(field.sourceField), normalizeFieldName(field.targetField)]).filter(Boolean),
    );
    selectedDataFlowApis(flow).forEach((api) => {
      apiFlowFields(api)
        .filter((field) => field.required)
        .forEach((field) => {
          if (!mappedNames.has(normalizeFieldName(field.name))) {
            issues.push(`必填字段未映射：${field.name}`);
          }
        });
    });

    return Array.from(new Set(issues));
  }

  function removeDataFlowField(fieldId: string) {
    setDataFlowDraft((draft) =>
      draft ? { ...draft, fields: draft.fields.filter((field) => field.id !== fieldId) } : draft,
    );
  }

  function toggleDataFlowApi(apiId: string) {
    setDataFlowDraft((draft) => {
      if (!draft) return draft;
      const values = new Set(draft.apiIds);
      if (values.has(apiId)) values.delete(apiId);
      else values.add(apiId);
      return { ...draft, apiIds: [...values] };
    });
  }

  function deleteSelectedContent() {
    if (!activeProject || !activeImage || !ensureEdit(activeProject, "editContent")) return;
    if (selectedAnnotationId) {
      updateImage(activeImage.id, "删除标注", (image) => ({
        ...image,
        annotations: image.annotations.filter((annotation) => annotation.id !== selectedAnnotationId),
      }));
      setSelectedAnnotationId(null);
      return;
    }
    if (selectedTextId) {
      updateImage(activeImage.id, "删除文本", (image) => ({
        ...image,
        texts: image.texts.filter((item) => item.id !== selectedTextId),
      }));
      setSelectedTextId(null);
    }
  }

  function beginTextEdit(textItem: TextItem) {
    if (!activeProject || !ensureEdit(activeProject, "editContent")) return;
    setSelectedTextId(textItem.id);
    setSelectedAnnotationId(null);
    if (textEditRef.current?.id !== textItem.id) {
      rememberHistory();
      textEditRef.current = { id: textItem.id, content: textItem.content };
    }
  }

  function finishTextEdit(textId: string, content: string) {
    if (!activeProject || !activeImage) return;
    const before = textEditRef.current;
    textEditRef.current = null;
    if (!before || before.content === content) return;
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== activeProject.id) return project;
        return addProjectLog(
          {
            ...project,
            images: project.images.map((image) =>
              image.id === activeImage.id
                ? {
                    ...image,
                    texts: image.texts.map((item) => (item.id === textId ? { ...item, content } : item)),
                  }
                : image,
            ),
          },
          "编辑文本",
        );
      }),
    );
  }

  async function togglePermission(username: string, permission: PermissionKey) {
    if (!permissionProject) return;
    const canManage = isRoot || hasPermission(permissionProject, "admin");
    if (!canManage) return;
    try {
      const authData = await apiRequest<BootstrapPayload>(`/api/projects/${permissionProject.id}/permissions/toggle`, {
        method: "POST",
        body: JSON.stringify({ username, permission }),
      });
      applyBootstrap(authData);
      notify(`已更新 ${username} 的权限`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "权限更新失败");
    }
  }

  async function transferAdmin(username: string) {
    if (!permissionProject) return;
    const canManage = isRoot || hasPermission(permissionProject, "admin");
    if (!canManage) return;
    try {
      const authData = await apiRequest<BootstrapPayload>(`/api/projects/${permissionProject.id}/admin/transfer`, {
        method: "POST",
        body: JSON.stringify({ username }),
      });
      applyBootstrap(authData);
      notify(`已转让管理者给 ${username}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "管理者转让失败");
    }
  }

  function openPermissions() {
    setPermissionProjectId(activeProjectId || projects[0]?.id || null);
    setView("permissions");
  }

  function rectStyle(rect: Rect) {
    return {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.width * 100}%`,
      height: `${rect.height * 100}%`,
    };
  }

  function renderAuthActions() {
    if (!currentUser) {
      return (
        <div className="auth-actions">
          <button className="ghost-action" type="button" onClick={() => openAuth("login")}>
            {text.login}
          </button>
          <button className="primary-action" type="button" onClick={() => openAuth("register")}>
            {text.register}
          </button>
        </div>
      );
    }
    return (
      <div className="auth-actions user-actions">
        <button className="user-name-button" type="button" onClick={() => setAccountOpen(true)}>
          {currentUser}
        </button>
        <button className="mini-button user-icon-action" type="button" aria-label={text.logout} onClick={logout}>
          <LogOut size={16} />
        </button>
      </div>
    );
  }

  function selectImage(imageId: string) {
    setActiveImageId(imageId);
    setSelectedAnnotationId(null);
    setSelectedTextId(null);
  }

  function updateAnnotationDraft(patch: Partial<AnnotationDraft>) {
    setAnnotationDraft((draft) => ({ ...draft, ...patch }));
  }

  function updateTextStyle(patch: Partial<TextStyle>) {
    setTextStyle((style) => ({ ...style, ...patch }));
  }

  function updateDataFlowDraft(patch: Partial<DataFlow>) {
    setDataFlowDraft((draft) => (draft ? { ...draft, ...patch } : draft));
  }

  function selectDataFlow(flow: DataFlow) {
    setDataFlowDraft(structuredClone(flow));
  }

  const authActions = renderAuthActions();
  const canManagePermission = Boolean(permissionProject && (isRoot || hasPermission(permissionProject, "admin")));
  const projectDraftSource = projectDraft?.isNew ? null : projects.find((project) => project.id === projectDraft?.id) || null;
  const canDeleteProjectDraft = Boolean(projectDraftSource && hasPermission(projectDraftSource, "admin"));

  const imageFrameStyle = imageBaseSize
    ? {
        width: `${Math.round(imageBaseSize.width * imageZoom)}px`,
        height: `${Math.round(imageBaseSize.height * imageZoom)}px`,
      }
    : undefined;

  return (
    <main className="app-shell">
      {view === "home" && (
        <section className="home-page" aria-labelledby="homeTitle">
          {authActions}
          <h1 id="homeTitle">{text.appTitle}</h1>
          <button className="primary-action" type="button" onClick={() => setView("projects")}>
            {text.enterProject}
          </button>
        </section>
      )}

      {view === "projects" && (
        <ProjectPage
          currentUser={currentUser}
          projects={projects}
          authActions={authActions}
          onOpenNewProject={openNewProjectDraft}
          onOpenPermissions={openPermissions}
          onEnterProject={enterProject}
          onOpenProject={openProjectDraft}
          canEditProject={(project) => hasPermission(project, "editProject")}
        />
      )}

      {view === "workspace" && (
        <WorkspacePage
          pagesCollapsed={pagesCollapsed}
          apisCollapsed={apisCollapsed}
          imageInputRef={imageInputRef}
          jsonInputRef={jsonInputRef}
          stageRef={stageRef}
          imageRef={imageRef}
          imageFrameRef={imageFrameRef}
          overlayRef={overlayRef}
          activeProject={activeProject}
          activeImage={activeImage}
          activeImageId={activeImageId}
          renamingImageId={renamingImageId}
          imageNameDraft={imageNameDraft}
          imageFrameStyle={imageFrameStyle}
          tool={tool}
          textStyle={textStyle}
          overlayVisible={overlayVisible}
          draftRect={draftRect}
          selectedAnnotationId={selectedAnnotationId}
          selectedTextId={selectedTextId}
          relationJumpActive={Boolean(selectedAnnotation?.linkTag)}
          annotationDraft={annotationDraft}
          annotationPopoverStyle={popoverStyle}
          canEditImage={canEdit(activeProject, "editImage")}
          canEditContent={canEdit(activeProject, "editContent")}
          apiSearchQuery={apiSearchQuery}
          filteredApis={filteredApis}
          getImageDisplayName={getImageDisplayName}
          onImageLoad={updateImageBaseSize}
          onImportImages={importImages}
          onSelectImage={selectImage}
          onDeleteImage={deleteImage}
          onStartRenameImage={startRenameImage}
          onImageNameDraftChange={(value) => setImageNameDraft(value)}
          onSaveImageName={saveImageName}
          onCancelRenameImage={cancelRenameImage}
          onTogglePagesCollapsed={() => setPagesCollapsed((collapsed) => !collapsed)}
          onBack={() => setView("projects")}
          onToggleApisCollapsed={() => setApisCollapsed((collapsed) => !collapsed)}
          onToolChange={(nextTool) => setTool(nextTool)}
          onDeleteSelectedContent={deleteSelectedContent}
          onOpenRelationJump={openRelationJump}
          onTextStyleChange={updateTextStyle}
          onToggleOverlayVisible={() => setOverlayVisible((visible) => !visible)}
          onOpenDataFlows={openDataFlows}
          onOpenLogs={() => setView("logs")}
          onStageWheel={onStageWheel}
          onStagePointerDown={onStagePointerDown}
          onStagePointerMove={onStagePointerMove}
          onFinishStagePan={finishStagePan}
          onOverlayPointerDown={onOverlayPointerDown}
          onOverlayPointerMove={onOverlayPointerMove}
          onOverlayPointerUp={onOverlayPointerUp}
          rectStyle={rectStyle}
          onOpenAnnotation={openAnnotation}
          onBeginTextEdit={beginTextEdit}
          onFinishTextEdit={finishTextEdit}
          onCloseAnnotation={() => setSelectedAnnotationId(null)}
          onAnnotationDraftChange={updateAnnotationDraft}
          onSaveAnnotation={saveAnnotation}
          onImportJson={importJson}
          onApiSearchQueryChange={(value) => setApiSearchQuery(value)}
        />
      )}

      {view === "permissions" && (
        <PermissionPage
          accounts={accounts}
          projects={projects}
          permissionProject={permissionProject}
          permissionDisplayProject={permissionDisplayProject}
          currentUser={currentUser}
          isRoot={isRoot}
          canManage={canManagePermission}
          authActions={authActions}
          onBack={() => setView("projects")}
          onProjectChange={(projectId) => setPermissionProjectId(projectId)}
          onTogglePermission={togglePermission}
          onTransferAdmin={transferAdmin}
        />
      )}

      {view === "logs" && (
        <section className="content-page">
          <header className="content-header">
            <button className="secondary-action" type="button" onClick={() => setView("workspace")}>
              {text.back}
            </button>
            <h1>{activeProject?.name || text.logs}</h1>
            {authActions}
          </header>
          <div className="log-list">
            {!activeProject?.logs.length && <p className="muted">暂无日志</p>}
            {activeProject?.logs
              .slice()
              .reverse()
              .map((entry) => (
                <article key={entry.id} className="log-item">
                  <time>{formatTime(entry.time)}</time>
                  <strong>{entry.username}</strong>
                  <span>{entry.action}</span>
                </article>
              ))}
          </div>
        </section>
      )}

      {authOpen && (
        <Modal title={authMode === "login" ? text.login : text.register} onClose={() => setAuthOpen(false)}>
          <form className="dialog-form" onSubmit={submitAuth}>
            <label>
              <span>{text.username}</span>
              <input name="username" type="text" autoComplete="username" />
            </label>
            <PasswordField name="password" label={text.password} shown={showPassword.password} onToggle={() => setShowPassword((value) => ({ ...value, password: !value.password }))} />
            <footer>
              <button className="ghost-action" type="button" onClick={() => setAuthOpen(false)}>
                {text.cancel}
              </button>
              <button className="primary-action" type="submit">
                {authMode === "login" ? text.login : text.register}
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {accountOpen && (
        <Modal title={`${currentUser || ""} · ${text.changePassword}`} onClose={() => setAccountOpen(false)}>
          <form className="dialog-form" onSubmit={submitPasswordChange}>
            <PasswordField name="oldPassword" label={text.originalPassword} shown={showPassword.oldPassword} onToggle={() => setShowPassword((value) => ({ ...value, oldPassword: !value.oldPassword }))} />
            <PasswordField name="newPassword" label={text.newPassword} shown={showPassword.newPassword} onToggle={() => setShowPassword((value) => ({ ...value, newPassword: !value.newPassword }))} />
            <PasswordField name="confirmPassword" label={text.confirmPassword} shown={showPassword.confirmPassword} onToggle={() => setShowPassword((value) => ({ ...value, confirmPassword: !value.confirmPassword }))} />
            <footer>
              <button className="ghost-action" type="button" onClick={() => setAccountOpen(false)}>
                {text.cancel}
              </button>
              <button className="primary-action" type="submit">
                {text.save}
              </button>
            </footer>
          </form>
        </Modal>
      )}

      {projectDraft && (
        <Modal title="编辑项目" onClose={() => setProjectDraft(null)}>
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveProjectDraft();
            }}
          >
            <label>
              <span>{text.projectName}</span>
              <input value={projectDraft.name} onChange={(event) => setProjectDraft((draft) => (draft ? { ...draft, name: event.target.value } : draft))} />
            </label>
            <button className="dialog-drop-zone" type="button" onClick={() => projectImageInputRef.current?.click()}>
              <input ref={projectImageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => addImagesToProjectDraft(event.target.files)} />
              <span className="plus-mark">+</span>
              <span>{text.importImage}</span>
            </button>
            <div className="project-image-list">
              {!projectDraft.images.length && <p className="muted">暂未导入图片</p>}
              {projectDraft.images.map((image) => (
                <button
                  key={image.id}
                  className="project-image-option"
                  type="button"
                  onClick={() => setProjectDraft((draft) => (draft ? { ...draft, defaultImageId: image.id } : draft))}
                >
                  <img src={image.src} alt="" />
                  <span>{image.name}</span>
                  {projectDraft.defaultImageId === image.id && <b className="default-check">✓</b>}
                </button>
              ))}
            </div>
            <footer className="project-dialog-actions">
              <button className="ghost-action" type="button" onClick={() => setProjectDraft(null)}>
                {text.cancel}
              </button>
              <div className="project-dialog-save-actions">
                {canDeleteProjectDraft && (
                  <button className="danger-action" type="button" onClick={() => deleteProject(projectDraft.id)}>
                    {text.delete}
                  </button>
                )}
                <button className="primary-action" type="submit">
                  {text.save}
                </button>
              </div>
            </footer>
          </form>
        </Modal>
      )}

      {dataFlowOpen && activeProject && dataFlowDraft && (
        <Modal title={text.dataFlows} wide onClose={() => setDataFlowOpen(false)}>
          <DataFlowPanel
            activeProject={activeProject}
            dataFlowDraft={dataFlowDraft}
            dataFlowApiQuery={dataFlowApiQuery}
            endpointTypes={endpointTypes}
            selectedApis={selectedDataFlowApis(dataFlowDraft)}
            filteredApis={filteredDataFlowApis(dataFlowDraft)}
            summary={dataFlowSummary(dataFlowDraft)}
            checks={dataFlowChecks(dataFlowDraft)}
            getImageDisplayName={getImageDisplayName}
            annotationLabel={annotationLabel}
            onStartNew={startNewDataFlow}
            onSelectFlow={selectDataFlow}
            onDeleteFlow={deleteDataFlow}
            onSubmit={saveDataFlowDraft}
            onDraftChange={updateDataFlowDraft}
            onDataFlowApiQueryChange={(value) => setDataFlowApiQuery(value)}
            onUpdateEndpoint={updateDataFlowEndpoint}
            onAddEndpoint={addDataFlowEndpoint}
            onRemoveEndpoint={removeDataFlowEndpoint}
            onToggleApi={toggleDataFlowApi}
            onImportApiFields={importApiFieldsToDataFlow}
            onAddField={addDataFlowField}
            onUpdateField={updateDataFlowField}
            onRemoveField={removeDataFlowField}
          />
        </Modal>
      )}

      {jumpTargets && (
        <Modal title={text.jumpList} onClose={() => setJumpTargets(null)}>
          <div className="jump-list">
            <p className="muted">
              {text.relationTag}: {jumpTargets[0]?.tag}
            </p>
            {jumpTargets.map((target) => (
              <button key={`${target.imageId}-${target.annotation.id}`} className="jump-target" type="button" onClick={() => jumpToAnnotation(target)}>
                <strong>{getImageDisplayName(target.imageName)}</strong>
                <span>{target.annotation.name || target.annotation.interaction || target.annotation.note || target.apiTitle || text.annotationFallback}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function PasswordField({
  name,
  label,
  shown,
  onToggle,
}: {
  name: string;
  label: string;
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div className="password-row">
        <input name={name} type={shown ? "text" : "password"} autoComplete="current-password" />
        <button className="mini-button password-toggle" type="button" aria-label={shown ? "隐藏密码" : "显示密码"} data-tip={shown ? "隐藏密码" : "显示密码"} onClick={onToggle}>
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`modal-panel${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="mini-button" type="button" aria-label="关闭" data-tip="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
