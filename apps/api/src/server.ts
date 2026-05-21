import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  cleanupSessions,
  createSession,
  createUser,
  deleteSession,
  getSessionUser,
  getUser,
  listProjects,
  listPublicAccounts,
  replaceProjects,
  seedRootUser,
  updatePassword,
} from "./db/index.js";
import type { PermissionKey, Project } from "./types.js";

const SESSION_COOKIE = "abs_session";
const ALL_PERMISSIONS: PermissionKey[] = ["admin", "editProject", "editImage", "editInterface", "editContent"];
const DEFAULT_MANAGER_PERMISSIONS: PermissionKey[] = ["admin"];
const PASSWORD_HASH_RE = /^[a-f0-9]{64}$/i;
const DEFAULT_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"];
const WEB_ORIGINS = parseOriginList(process.env.WEB_ORIGINS || process.env.CORS_ORIGINS);
const ALLOWED_WEB_ORIGINS = new Set([...DEFAULT_WEB_ORIGINS, ...WEB_ORIGINS]);
const COOKIE_SAME_SITE = normalizeCookieSameSite(process.env.COOKIE_SAME_SITE, WEB_ORIGINS);
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || COOKIE_SAME_SITE === "none";

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>;

type AuthBody = {
  username?: string;
  passwordHash?: string;
};

type PasswordBody = {
  oldPasswordHash?: string;
  newPasswordHash?: string;
};

type ProjectsBody = {
  projects?: Project[];
};

type ProjectParams = {
  projectId?: string;
};

type PermissionBody = {
  username?: string;
  permission?: PermissionKey;
};

type TransferAdminBody = {
  username?: string;
};

seedRootUser();
cleanupSessions();

const app = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024,
});

await app.register(cookie, {
  secret: process.env.COOKIE_SECRET || "anti-blameshift-dev-cookie-secret",
});

await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || ALLOWED_WEB_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS"), false);
  },
});

function parseOriginList(value?: string) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function normalizeCookieSameSite(value: string | undefined, configuredOrigins: string[]) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "none" || normalized === "strict" || normalized === "lax") return normalized;
  return configuredOrigins.length ? "none" : "lax";
}

function publicUser(user: { username: string; isRoot: boolean } | null) {
  if (!user) return null;
  return {
    username: user.username,
    passwordHash: "",
    isRoot: user.isRoot || undefined,
  };
}

function bootstrapPayload(user: { username: string; isRoot: boolean } | null) {
  return {
    user: publicUser(user),
    accounts: listPublicAccounts(),
    projects: listProjects(),
  };
}

function getCurrentUser(request: { cookies: Record<string, string | undefined> }) {
  return getSessionUser(request.cookies[SESSION_COOKIE]);
}

function setSession(reply: FastifyReply, username: string) {
  const session = createSession(username);
  reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
  });
}

function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
  });
}

function normalizeUsername(value: unknown) {
  return String(value || "").trim();
}

function isValidHash(value: unknown) {
  return typeof value === "string" && PASSWORD_HASH_RE.test(value);
}

function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && ALL_PERMISSIONS.includes(value as PermissionKey);
}

function projectPermissions(project: Project, username: string) {
  return project.permissions[username] || [];
}

function hasProjectPermission(project: Project, user: SessionUser, permission: PermissionKey) {
  if (user.isRoot) return true;
  const permissions = projectPermissions(project, user.username);
  return permissions.includes("admin") || permissions.includes(permission);
}

function hasAnyProjectPermission(project: Project, user: SessionUser, permissions: PermissionKey[]) {
  return permissions.some((permission) => hasProjectPermission(project, user, permission));
}

function projectMetaSnapshot(project: Project) {
  return JSON.stringify({
    name: project.name,
    locked: project.locked ?? null,
  });
}

function projectImageSnapshot(project: Project) {
  return JSON.stringify({
    defaultImageId: project.defaultImageId,
    images: project.images.map((image) => ({
      id: image.id,
      name: image.name,
      src: image.src,
    })),
  });
}

function projectContentSnapshot(project: Project) {
  return JSON.stringify({
    images: project.images.map((image) => ({
      id: image.id,
      annotations: image.annotations,
      texts: image.texts,
    })),
    dataFlows: project.dataFlows,
  });
}

function projectApiSnapshot(project: Project) {
  return JSON.stringify(project.apis);
}

function addProjectLog(project: Project, username: string, action: string): Project {
  return {
    ...project,
    logs: [
      ...project.logs,
      {
        id: randomUUID(),
        time: new Date().toISOString(),
        username,
        action,
      },
    ],
  };
}

function normalizeNewProject(project: Project, user: SessionUser): Project {
  return {
    ...project,
    owner: user.username,
    permissions: user.isRoot ? {} : { [user.username]: [...DEFAULT_MANAGER_PERMISSIONS] },
  };
}

function updateStoredProject(projectId: string, updater: (project: Project) => Project) {
  const projects = listProjects();
  const projectIndex = projects.findIndex((project) => project.id === projectId);
  if (projectIndex < 0) return null;
  const nextProjects = [...projects];
  nextProjects[projectIndex] = updater(projects[projectIndex]);
  replaceProjects(nextProjects);
  return nextProjects[projectIndex];
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/bootstrap", async (request) => {
  return bootstrapPayload(getCurrentUser(request));
});

app.post<{ Body: AuthBody }>("/api/auth/register", async (request, reply) => {
  const username = normalizeUsername(request.body?.username);
  const passwordHash = request.body?.passwordHash || "";
  if (!username || !isValidHash(passwordHash)) {
    return reply.code(400).send({ message: "用户名或密码格式不正确" });
  }
  if (getUser(username)) {
    return reply.code(409).send({ message: "用户名已存在" });
  }
  createUser(username, passwordHash);
  setSession(reply, username);
  return bootstrapPayload(getUser(username) || null);
});

app.post<{ Body: AuthBody }>("/api/auth/login", async (request, reply) => {
  const username = normalizeUsername(request.body?.username);
  const passwordHash = request.body?.passwordHash || "";
  const user = getUser(username);
  if (!user || user.passwordHash !== passwordHash) {
    return reply.code(401).send({ message: "用户名或密码错误" });
  }
  setSession(reply, username);
  return bootstrapPayload(user);
});

app.post("/api/auth/logout", async (request, reply) => {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (sessionId) deleteSession(sessionId);
  clearSession(reply);
  return bootstrapPayload(null);
});

app.post<{ Body: PasswordBody }>("/api/auth/password", async (request, reply) => {
  const user = getCurrentUser(request);
  if (!user) return reply.code(401).send({ message: "请先登录后再修改密码" });
  const oldPasswordHash = request.body?.oldPasswordHash || "";
  const newPasswordHash = request.body?.newPasswordHash || "";
  if (!isValidHash(oldPasswordHash) || !isValidHash(newPasswordHash)) {
    return reply.code(400).send({ message: "密码格式不正确" });
  }
  if (oldPasswordHash !== user.passwordHash) {
    return reply.code(400).send({ message: "原密码不匹配" });
  }
  updatePassword(user.username, newPasswordHash);
  return bootstrapPayload(getUser(user.username) || null);
});

app.put<{ Body: ProjectsBody }>("/api/projects", async (request, reply) => {
  const user = getCurrentUser(request);
  if (!user) return reply.code(401).send({ message: "请先登录后再保存项目" });
  const projects = request.body?.projects;
  if (!Array.isArray(projects)) {
    return reply.code(400).send({ message: "项目数据格式不正确" });
  }
  const currentProjects = listProjects();
  const currentProjectMap = new Map(currentProjects.map((project) => [project.id, project]));
  const nextProjectIds = new Set(projects.map((project) => project.id));

  for (const currentProject of currentProjects) {
    if (!nextProjectIds.has(currentProject.id) && !hasProjectPermission(currentProject, user, "admin")) {
      return reply.code(403).send({ message: `没有权限删除项目：${currentProject.name}` });
    }
  }

  for (const nextProject of projects) {
    const currentProject = currentProjectMap.get(nextProject.id);
    if (!currentProject) continue;

    if (projectMetaSnapshot(nextProject) !== projectMetaSnapshot(currentProject) && !hasProjectPermission(currentProject, user, "editProject")) {
      return reply.code(403).send({ message: `没有权限编辑项目：${currentProject.name}` });
    }

    if (projectImageSnapshot(nextProject) !== projectImageSnapshot(currentProject) && !hasAnyProjectPermission(currentProject, user, ["editProject", "editImage"])) {
      return reply.code(403).send({ message: `没有权限编辑图片：${currentProject.name}` });
    }

    if (projectApiSnapshot(nextProject) !== projectApiSnapshot(currentProject) && !hasProjectPermission(currentProject, user, "editInterface")) {
      return reply.code(403).send({ message: `没有权限编辑接口：${currentProject.name}` });
    }

    if (projectContentSnapshot(nextProject) !== projectContentSnapshot(currentProject) && !hasProjectPermission(currentProject, user, "editContent")) {
      return reply.code(403).send({ message: `没有权限编辑内容：${currentProject.name}` });
    }
  }

  replaceProjects(
    projects.map((project) => {
      const currentProject = currentProjectMap.get(project.id);
      if (!currentProject) return normalizeNewProject(project, user);
      return {
        ...project,
        owner: currentProject.owner,
        permissions: currentProject.permissions,
      };
    }),
  );
  return { projects: listProjects() };
});

app.post<{ Params: ProjectParams; Body: PermissionBody }>("/api/projects/:projectId/permissions/toggle", async (request, reply) => {
  const user = getCurrentUser(request);
  if (!user) return reply.code(401).send({ message: "请先登录后再修改权限" });

  const projectId = request.params.projectId || "";
  const username = normalizeUsername(request.body?.username);
  const permission = request.body?.permission;
  const targetUser = getUser(username);
  const project = listProjects().find((item) => item.id === projectId);

  if (!project) return reply.code(404).send({ message: "项目不存在" });
  if (!targetUser) return reply.code(404).send({ message: "成员不存在" });
  if (!isPermissionKey(permission) || permission === "admin") {
    return reply.code(400).send({ message: "权限参数不正确" });
  }
  if (targetUser.isRoot) {
    return reply.code(400).send({ message: "Root 账号权限固定" });
  }
  if (!hasProjectPermission(project, user, "admin")) {
    return reply.code(403).send({ message: "当前账号只能阅览，不能编辑" });
  }

  updateStoredProject(projectId, (currentProject) => {
    const currentPermissions = new Set(projectPermissions(currentProject, username));
    if (currentPermissions.has(permission)) currentPermissions.delete(permission);
    else currentPermissions.add(permission);

    const permissions = { ...currentProject.permissions };
    if (currentPermissions.size) permissions[username] = [...currentPermissions];
    else delete permissions[username];

    return addProjectLog(
      {
        ...currentProject,
        permissions,
      },
      user.username,
      `更新 ${username} 的权限`,
    );
  });

  return bootstrapPayload(getUser(user.username) || null);
});

app.post<{ Params: ProjectParams; Body: TransferAdminBody }>("/api/projects/:projectId/admin/transfer", async (request, reply) => {
  const user = getCurrentUser(request);
  if (!user) return reply.code(401).send({ message: "请先登录后再转让管理者" });

  const projectId = request.params.projectId || "";
  const username = normalizeUsername(request.body?.username);
  const targetUser = getUser(username);
  const project = listProjects().find((item) => item.id === projectId);

  if (!project) return reply.code(404).send({ message: "项目不存在" });
  if (!targetUser) return reply.code(404).send({ message: "成员不存在" });
  if (!hasProjectPermission(project, user, "admin")) {
    return reply.code(403).send({ message: "当前账号只能阅览，不能编辑" });
  }

  updateStoredProject(projectId, (currentProject) => {
    const permissions = Object.fromEntries(
      Object.entries(currentProject.permissions)
        .map(([accountName, values]) => [
          accountName,
          values.filter((permission) => permission !== "admin"),
        ])
        .filter(([, values]) => values.length),
    ) as Record<string, PermissionKey[]>;

    if (targetUser.isRoot) {
      delete permissions[username];
    } else {
      permissions[username] = Array.from(new Set([...(permissions[username] || []), ...DEFAULT_MANAGER_PERMISSIONS]));
    }

    return addProjectLog(
      {
        ...currentProject,
        owner: username,
        permissions,
      },
      user.username,
      `转让管理者给 ${username}`,
    );
  });

  return bootstrapPayload(getUser(user.username) || null);
});

const webDist = process.env.WEB_DIST_DIR || path.resolve(process.cwd(), "../web/dist");
if (process.env.SERVE_WEB === "true" && existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ message: "Not found" });
      return;
    }
    reply.sendFile("index.html");
  });
}

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

await app.listen({ port, host });
