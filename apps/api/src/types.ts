export type PermissionKey =
  | "admin"
  | "editProject"
  | "editImage"
  | "editInterface"
  | "editContent";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Annotation = {
  id: string;
  name?: string;
  rect: Rect;
  interaction: string;
  api: string;
  note: string;
  linkTag?: string;
};

export type TextItem = {
  id: string;
  x: number;
  y: number;
  content: string;
  color: string;
  size: number;
  bold: boolean;
  italic: boolean;
};

export type DesignImage = {
  id: string;
  name: string;
  src: string;
  annotations: Annotation[];
  texts: TextItem[];
};

export type ApiField = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  source?: string;
};

export type ApiItem = {
  id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  tags: string[];
  parameters: ApiField[];
  requestFields: ApiField[];
  responseFields: ApiField[];
};

export type DataFlowEndpoint = {
  id: string;
  type: string;
  name: string;
  detail: string;
};

export type DataFlowFieldMap = {
  id: string;
  sourceField: string;
  targetField: string;
  type: string;
  required: boolean;
  transform: string;
  note: string;
};

export type DataFlow = {
  id: string;
  name: string;
  imageId: string;
  annotationId: string;
  apiIds: string[];
  sources: DataFlowEndpoint[];
  targets: DataFlowEndpoint[];
  fields: DataFlowFieldMap[];
  condition: string;
  transform: string;
  note: string;
};

export type LogEntry = {
  id: string;
  time: string;
  username: string;
  action: string;
};

export type Project = {
  id: string;
  name: string;
  locked?: boolean;
  owner?: string;
  defaultImageId: string | null;
  images: DesignImage[];
  apis: ApiItem[];
  dataFlows: DataFlow[];
  permissions: Record<string, PermissionKey[]>;
  logs: LogEntry[];
};

export type Account = {
  username: string;
  passwordHash: string;
  isRoot?: boolean;
};

export type PublicAccount = {
  username: string;
  passwordHash: "";
  isRoot?: boolean;
};
