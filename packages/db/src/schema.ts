import type { SourceAsset, SourceFile } from "@overleaf-pro/contracts";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

// Better Auth's core models. Project persistence belongs to Part 1.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
export const appMetadata = pgTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const project = pgTable(
  "project",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mainFile: text("main_file").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("project_user_idx").on(table.userId)],
);

export const projectFile = pgTable(
  "project_file",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    sha256: text("sha256").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("project_file_path_idx").on(table.projectId, table.path),
  ],
);

export const projectSnapshot = pgTable(
  "project_snapshot",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    mainFile: text("main_file").notNull(),
    createdAt: createdAt(),
    files: jsonb("files").$type<SourceFile[]>().notNull(),
    assets: jsonb("assets").$type<SourceAsset[]>().notNull().default([]),
    bytes: integer("bytes").notNull(),
  },
  (table) => [
    uniqueIndex("project_snapshot_revision_idx").on(
      table.projectId,
      table.revision,
    ),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const projectAsset = pgTable(
  "project_asset",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    version: integer("version").notNull().default(1),
    sha256: text("sha256").notNull(),
    mediaType: text("media_type").notNull(),
    data: bytea("data").notNull(),
  },
  (table) => [
    uniqueIndex("project_asset_path_idx").on(table.projectId, table.path),
  ],
);

// Labels are separate from immutable source snapshots. A revision can be named
// once, including when an earlier export already captured it.
export const snapshotName = pgTable("snapshot_name", {
  snapshotId: uuid("snapshot_id")
    .primaryKey()
    .references(() => projectSnapshot.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const aiProposal = pgTable("ai_proposal", {
  id: uuid("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  data: jsonb("data").notNull(),
  context: jsonb("context").notNull(),
  bytes: integer("bytes").notNull(),
});

export const resumeAnalysis = pgTable(
  "resume_analysis",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    data: jsonb("data").notNull(),
    bytes: integer("bytes").notNull(),
  },
  (table) => [index("resume_analysis_user_idx").on(table.userId)],
);
