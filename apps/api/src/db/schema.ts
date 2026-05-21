import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  username: text("username").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  isRoot: integer("is_root", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  username: text("username")
    .notNull()
    .references(() => users.username, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  locked: integer("locked", { mode: "boolean" }),
  owner: text("owner"),
  defaultImageId: text("default_image_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  src: text("src").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const annotations = sqliteTable("annotations", {
  id: text("id").primaryKey(),
  imageId: text("image_id")
    .notNull()
    .references(() => images.id, { onDelete: "cascade" }),
  name: text("name"),
  rectX: real("rect_x").notNull(),
  rectY: real("rect_y").notNull(),
  rectWidth: real("rect_width").notNull(),
  rectHeight: real("rect_height").notNull(),
  interaction: text("interaction").notNull(),
  api: text("api").notNull(),
  note: text("note").notNull(),
  linkTag: text("link_tag"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const imageTexts = sqliteTable("image_texts", {
  id: text("id").primaryKey(),
  imageId: text("image_id")
    .notNull()
    .references(() => images.id, { onDelete: "cascade" }),
  x: real("x").notNull(),
  y: real("y").notNull(),
  content: text("content").notNull(),
  color: text("color").notNull(),
  size: integer("size").notNull(),
  bold: integer("bold", { mode: "boolean" }).notNull().default(false),
  italic: integer("italic", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const apis = sqliteTable("apis", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  method: text("method").notNull(),
  path: text("path").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tags: text("tags").notNull(),
  parameters: text("parameters").notNull(),
  requestFields: text("request_fields").notNull(),
  responseFields: text("response_fields").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const dataFlows = sqliteTable("data_flows", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imageId: text("image_id"),
  annotationId: text("annotation_id"),
  apiIds: text("api_ids").notNull(),
  sources: text("sources").notNull(),
  targets: text("targets").notNull(),
  fields: text("fields").notNull(),
  condition: text("condition").notNull(),
  transform: text("transform").notNull(),
  note: text("note").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const permissions = sqliteTable("permissions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  permission: text("permission").notNull(),
});

export const logs = sqliteTable("logs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  time: text("time").notNull(),
  username: text("username").notNull(),
  action: text("action").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
