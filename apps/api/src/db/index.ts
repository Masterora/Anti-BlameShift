import Database from "better-sqlite3";
import { eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sessions, users } from "./schema.js";
import type { PermissionKey, Project, PublicAccount } from "../types.js";

const ROOT_PASSWORD_HASH =
  "e6f458074668ad5d8f55d414bbe2b908fbb46909ea36b19c8548045bbeeb164e";

type LegacyProjectRow = {
  data: string;
  updated_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  locked: number | null;
  owner: string | null;
  default_image_id: string | null;
};

type ImageRow = {
  id: string;
  project_id: string;
  name: string;
  src: string;
};

type AnnotationRow = {
  id: string;
  image_id: string;
  name: string | null;
  rect_x: number;
  rect_y: number;
  rect_width: number;
  rect_height: number;
  interaction: string;
  api: string;
  note: string;
  link_tag: string;
};

type ImageTextRow = {
  id: string;
  image_id: string;
  x: number;
  y: number;
  content: string;
  color: string;
  size: number;
  bold: number;
  italic: number;
};

type ApiRow = {
  id: string;
  project_id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  tags: string;
  parameters: string;
  request_fields: string;
  response_fields: string;
};

type DataFlowRow = {
  id: string;
  project_id: string;
  name: string;
  image_id: string | null;
  annotation_id: string | null;
  api_ids: string;
  sources: string;
  targets: string;
  fields: string;
  condition: string;
  transform: string;
  note: string;
};

type PermissionRow = {
  project_id: string;
  username: string;
  permission: string;
};

type LogRow = {
  id: string;
  project_id: string;
  time: string;
  username: string;
  action: string;
};

const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "app.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

ensureAuthTables();
migrateLegacyProjectsTable();
ensureNormalizedProjectTables();
migrateLegacyProjects();

export const db = drizzle(sqlite);

function ensureAuthTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      is_root INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
  `);
}

function ensureNormalizedProjectTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      locked INTEGER,
      owner TEXT,
      default_image_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      src TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      name TEXT,
      rect_x REAL NOT NULL,
      rect_y REAL NOT NULL,
      rect_width REAL NOT NULL,
      rect_height REAL NOT NULL,
      interaction TEXT NOT NULL,
      api TEXT NOT NULL,
      note TEXT NOT NULL,
      link_tag TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS image_texts (
      id TEXT PRIMARY KEY,
      image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      content TEXT NOT NULL,
      color TEXT NOT NULL,
      size INTEGER NOT NULL,
      bold INTEGER NOT NULL DEFAULT 0,
      italic INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS apis (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT NOT NULL,
      parameters TEXT NOT NULL,
      request_fields TEXT NOT NULL,
      response_fields TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS data_flows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      image_id TEXT,
      annotation_id TEXT,
      api_ids TEXT NOT NULL,
      sources TEXT NOT NULL,
      targets TEXT NOT NULL,
      fields TEXT NOT NULL,
      condition TEXT NOT NULL,
      transform TEXT NOT NULL,
      note TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      permission TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS projects_sort_order_idx ON projects (sort_order);
    CREATE INDEX IF NOT EXISTS images_project_sort_idx ON images (project_id, sort_order);
    CREATE INDEX IF NOT EXISTS annotations_image_sort_idx ON annotations (image_id, sort_order);
    CREATE INDEX IF NOT EXISTS image_texts_image_sort_idx ON image_texts (image_id, sort_order);
    CREATE INDEX IF NOT EXISTS apis_project_sort_idx ON apis (project_id, sort_order);
    CREATE INDEX IF NOT EXISTS data_flows_project_sort_idx ON data_flows (project_id, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS permissions_identity_idx ON permissions (project_id, username, permission);
    CREATE INDEX IF NOT EXISTS logs_project_sort_idx ON logs (project_id, sort_order);
  `);
}

function hasTable(tableName: string) {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function tableColumns(tableName: string) {
  return (sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function tableRowCount(tableName: string) {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count;
}

function migrateLegacyProjectsTable() {
  if (!hasTable("projects")) return;
  if (!tableColumns("projects").includes("data")) return;
  sqlite.exec("ALTER TABLE projects RENAME TO projects_legacy");
}

function readJson<T>(value: string) {
  return JSON.parse(value) as T;
}

function replaceNormalizedProjects(nextProjects: Project[], updatedAtByProjectId = new Map<string, string>()) {
  const now = new Date().toISOString();
  const write = sqlite.transaction((items: Project[]) => {
    sqlite.prepare("DELETE FROM projects").run();

    const insertProject = sqlite.prepare(
      "INSERT INTO projects (id, name, locked, owner, default_image_id, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertImage = sqlite.prepare(
      "INSERT INTO images (id, project_id, name, src, sort_order) VALUES (?, ?, ?, ?, ?)",
    );
    const insertAnnotation = sqlite.prepare(
      "INSERT INTO annotations (id, image_id, name, rect_x, rect_y, rect_width, rect_height, interaction, api, note, link_tag, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertImageText = sqlite.prepare(
      "INSERT INTO image_texts (id, image_id, x, y, content, color, size, bold, italic, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertApi = sqlite.prepare(
      "INSERT INTO apis (id, project_id, method, path, title, description, tags, parameters, request_fields, response_fields, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertDataFlow = sqlite.prepare(
      "INSERT INTO data_flows (id, project_id, name, image_id, annotation_id, api_ids, sources, targets, fields, condition, transform, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertPermission = sqlite.prepare(
      "INSERT INTO permissions (id, project_id, username, permission) VALUES (?, ?, ?, ?)",
    );
    const insertLog = sqlite.prepare(
      "INSERT INTO logs (id, project_id, time, username, action, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    );

    items.forEach((project, projectIndex) => {
      insertProject.run(
        project.id,
        project.name,
        project.locked == null ? null : project.locked ? 1 : 0,
        project.owner ?? null,
        project.defaultImageId,
        projectIndex,
        updatedAtByProjectId.get(project.id) ?? now,
      );

      project.images.forEach((image, imageIndex) => {
        insertImage.run(image.id, project.id, image.name, image.src, imageIndex);

        image.annotations.forEach((annotation, annotationIndex) => {
          insertAnnotation.run(
            annotation.id,
            image.id,
            annotation.name ?? null,
            annotation.rect.x,
            annotation.rect.y,
            annotation.rect.width,
            annotation.rect.height,
            annotation.interaction,
            annotation.api,
            annotation.note,
            annotation.linkTag ?? null,
            annotationIndex,
          );
        });

        image.texts.forEach((textItem, textIndex) => {
          insertImageText.run(
            textItem.id,
            image.id,
            textItem.x,
            textItem.y,
            textItem.content,
            textItem.color,
            textItem.size,
            textItem.bold ? 1 : 0,
            textItem.italic ? 1 : 0,
            textIndex,
          );
        });
      });

      project.apis.forEach((api, apiIndex) => {
        insertApi.run(
          api.id,
          project.id,
          api.method,
          api.path,
          api.title,
          api.description,
          JSON.stringify(api.tags),
          JSON.stringify(api.parameters),
          JSON.stringify(api.requestFields),
          JSON.stringify(api.responseFields),
          apiIndex,
        );
      });

      project.dataFlows.forEach((flow, flowIndex) => {
        insertDataFlow.run(
          flow.id,
          project.id,
          flow.name,
          flow.imageId || null,
          flow.annotationId || null,
          JSON.stringify(flow.apiIds),
          JSON.stringify(flow.sources),
          JSON.stringify(flow.targets),
          JSON.stringify(flow.fields),
          flow.condition,
          flow.transform,
          flow.note,
          flowIndex,
        );
      });

      Object.entries(project.permissions).forEach(([username, permissionValues]) => {
        permissionValues.forEach((permission) => {
          insertPermission.run(`${project.id}:${username}:${permission}`, project.id, username, permission);
        });
      });

      project.logs.forEach((entry, logIndex) => {
        insertLog.run(entry.id, project.id, entry.time, entry.username, entry.action, logIndex);
      });
    });
  });

  write(nextProjects);
}

function migrateLegacyProjects() {
  if (!hasTable("projects_legacy")) return;
  if (tableRowCount("projects") > 0) return;
  const rows = sqlite
    .prepare("SELECT data, updated_at FROM projects_legacy ORDER BY rowid")
    .all() as LegacyProjectRow[];
  if (!rows.length) return;
  const updatedAtByProjectId = new Map<string, string>();
  const projects = rows.map((row) => {
    const project = JSON.parse(row.data) as Project;
    updatedAtByProjectId.set(project.id, row.updated_at);
    return project;
  });
  replaceNormalizedProjects(projects, updatedAtByProjectId);
}

export function seedRootUser() {
  const now = new Date().toISOString();
  db.insert(users)
    .values({
      username: "root",
      passwordHash: ROOT_PASSWORD_HASH,
      isRoot: true,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
}

export function listPublicAccounts(): PublicAccount[] {
  return db
    .select({
      username: users.username,
      isRoot: users.isRoot,
    })
    .from(users)
    .all()
    .map((account) => ({
      username: account.username,
      passwordHash: "",
      isRoot: account.isRoot || undefined,
    }));
}

export function getUser(username: string) {
  return db.select().from(users).where(eq(users.username, username)).get();
}

export function createUser(username: string, passwordHash: string) {
  db.insert(users)
    .values({
      username,
      passwordHash,
      isRoot: false,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function updatePassword(username: string, passwordHash: string) {
  db.update(users).set({ passwordHash }).where(eq(users.username, username)).run();
}

export function createSession(username: string) {
  const id = randomUUID();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db.insert(sessions).values({ id, username, expiresAt }).run();
  return { id, expiresAt };
}

export function deleteSession(id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export function cleanupSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
}

export function getSessionUser(sessionId: string | undefined) {
  if (!sessionId) return null;
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    deleteSession(session.id);
    return null;
  }
  return getUser(session.username) ?? null;
}

export function listProjects(): Project[] {
  const projectRows = sqlite
    .prepare("SELECT id, name, locked, owner, default_image_id FROM projects ORDER BY sort_order ASC")
    .all() as ProjectRow[];
  const imageRows = sqlite
    .prepare("SELECT id, project_id, name, src FROM images ORDER BY project_id ASC, sort_order ASC")
    .all() as ImageRow[];
  const annotationRows = sqlite
    .prepare("SELECT id, image_id, name, rect_x, rect_y, rect_width, rect_height, interaction, api, note, link_tag FROM annotations ORDER BY image_id ASC, sort_order ASC")
    .all() as AnnotationRow[];
  const imageTextRows = sqlite
    .prepare("SELECT id, image_id, x, y, content, color, size, bold, italic FROM image_texts ORDER BY image_id ASC, sort_order ASC")
    .all() as ImageTextRow[];
  const apiRows = sqlite
    .prepare("SELECT id, project_id, method, path, title, description, tags, parameters, request_fields, response_fields FROM apis ORDER BY project_id ASC, sort_order ASC")
    .all() as ApiRow[];
  const dataFlowRows = sqlite
    .prepare("SELECT id, project_id, name, image_id, annotation_id, api_ids, sources, targets, fields, condition, transform, note FROM data_flows ORDER BY project_id ASC, sort_order ASC")
    .all() as DataFlowRow[];
  const permissionRows = sqlite
    .prepare("SELECT project_id, username, permission FROM permissions ORDER BY project_id ASC, username ASC, permission ASC")
    .all() as PermissionRow[];
  const logRows = sqlite
    .prepare("SELECT id, project_id, time, username, action FROM logs ORDER BY project_id ASC, sort_order ASC")
    .all() as LogRow[];

  const annotationsByImage = new Map<string, Project["images"][number]["annotations"]>();
  annotationRows.forEach((row) => {
    const list = annotationsByImage.get(row.image_id) || [];
    list.push({
      id: row.id,
      name: row.name ?? undefined,
      rect: {
        x: row.rect_x,
        y: row.rect_y,
        width: row.rect_width,
        height: row.rect_height,
      },
      interaction: row.interaction,
      api: row.api,
      note: row.note,
      linkTag: row.link_tag ?? undefined,
    });
    annotationsByImage.set(row.image_id, list);
  });

  const textsByImage = new Map<string, Project["images"][number]["texts"]>();
  imageTextRows.forEach((row) => {
    const list = textsByImage.get(row.image_id) || [];
    list.push({
      id: row.id,
      x: row.x,
      y: row.y,
      content: row.content,
      color: row.color,
      size: row.size,
      bold: Boolean(row.bold),
      italic: Boolean(row.italic),
    });
    textsByImage.set(row.image_id, list);
  });

  const imagesByProject = new Map<string, Project["images"]>();
  imageRows.forEach((row) => {
    const list = imagesByProject.get(row.project_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      src: row.src,
      annotations: annotationsByImage.get(row.id) || [],
      texts: textsByImage.get(row.id) || [],
    });
    imagesByProject.set(row.project_id, list);
  });

  const apisByProject = new Map<string, Project["apis"]>();
  apiRows.forEach((row) => {
    const list = apisByProject.get(row.project_id) || [];
    list.push({
      id: row.id,
      method: row.method,
      path: row.path,
      title: row.title,
      description: row.description,
      tags: readJson<string[]>(row.tags),
      parameters: readJson(row.parameters),
      requestFields: readJson(row.request_fields),
      responseFields: readJson(row.response_fields),
    });
    apisByProject.set(row.project_id, list);
  });

  const dataFlowsByProject = new Map<string, Project["dataFlows"]>();
  dataFlowRows.forEach((row) => {
    const list = dataFlowsByProject.get(row.project_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      imageId: row.image_id || "",
      annotationId: row.annotation_id || "",
      apiIds: readJson<string[]>(row.api_ids),
      sources: readJson(row.sources),
      targets: readJson(row.targets),
      fields: readJson(row.fields),
      condition: row.condition,
      transform: row.transform,
      note: row.note,
    });
    dataFlowsByProject.set(row.project_id, list);
  });

  const permissionsByProject = new Map<string, Record<string, PermissionKey[]>>();
  permissionRows.forEach((row) => {
    const permissionMap = permissionsByProject.get(row.project_id) || {};
    if (permissionMap[row.username]) {
      permissionMap[row.username].push(row.permission as PermissionKey);
    } else {
      permissionMap[row.username] = [row.permission as PermissionKey];
    }
    permissionsByProject.set(row.project_id, permissionMap);
  });

  const logsByProject = new Map<string, Project["logs"]>();
  logRows.forEach((row) => {
    const list = logsByProject.get(row.project_id) || [];
    list.push({
      id: row.id,
      time: row.time,
      username: row.username,
      action: row.action,
    });
    logsByProject.set(row.project_id, list);
  });

  return projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    locked: row.locked == null ? undefined : Boolean(row.locked),
    owner: row.owner ?? undefined,
    defaultImageId: row.default_image_id,
    images: imagesByProject.get(row.id) || [],
    apis: apisByProject.get(row.id) || [],
    dataFlows: dataFlowsByProject.get(row.id) || [],
    permissions: permissionsByProject.get(row.id) || {},
    logs: logsByProject.get(row.id) || [],
  }));
}

export function replaceProjects(nextProjects: Project[]) {
  replaceNormalizedProjects(nextProjects);
}
