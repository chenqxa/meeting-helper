import { pgTable, serial, timestamp, varchar, text, jsonb, integer, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const healthCheck = pgTable("health_check", {
  id: serial().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 会议记录表
export const meetingRecords = pgTable(
  "meeting_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    title: varchar("title", { length: 500 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(), // weekly, project_review, business_review
    meeting_date: timestamp("meeting_date", { withTimezone: true }).notNull(),
    participants: jsonb("participants").notNull().$type<string[]>(),
    organizer: varchar("organizer", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"), // draft, review, locked, exported
    input_type: varchar("input_type", { length: 20 }).notNull(), // text, recording, upload
    input_content: text("input_content"), // 原始文本内容
    file_url: varchar("file_url", { length: 1000 }), // 上传文件URL
    file_name: varchar("file_name", { length: 500 }), // 文件名
    transcript: text("transcript"), // 转写文本
    summary: jsonb("summary").$type<{
      topics: string[];
      keyDecisions: string[];
      risks: string[];
      nextSteps: string[];
      rawText?: string;
    }>(),
    version: integer("version").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("meeting_records_type_idx").on(table.type),
    index("meeting_records_status_idx").on(table.status),
    index("meeting_records_date_idx").on(table.meeting_date),
    index("meeting_records_organizer_idx").on(table.organizer),
    index("meeting_records_created_at_idx").on(table.created_at),
  ]
);

// 行动项表
export const meetingActionItems = pgTable(
  "meeting_action_items",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    meeting_id: varchar("meeting_id", { length: 36 }).notNull().references(() => meetingRecords.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    assignee: varchar("assignee", { length: 100 }),
    due_date: timestamp("due_date", { withTimezone: true }),
    priority: varchar("priority", { length: 10 }).notNull(), // high, medium, low
    confidence: varchar("confidence", { length: 10 }).notNull(), // high, medium, low
    source_text: text("source_text"), // 原文依据
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, in_progress, completed, cancelled
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("meeting_action_items_meeting_id_idx").on(table.meeting_id),
    index("meeting_action_items_assignee_idx").on(table.assignee),
    index("meeting_action_items_status_idx").on(table.status),
    index("meeting_action_items_due_date_idx").on(table.due_date),
  ]
);

// 审计日志表
export const meetingAuditLogs = pgTable(
  "meeting_audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    meeting_id: varchar("meeting_id", { length: 36 }).notNull().references(() => meetingRecords.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 50 }).notNull(),
    actor: varchar("actor", { length: 100 }).notNull(),
    details: text("details"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_audit_logs_meeting_id_idx").on(table.meeting_id),
    index("meeting_audit_logs_created_at_idx").on(table.created_at),
  ]
);

// 导出记录表
export const meetingExportRecords = pgTable(
  "meeting_export_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    meeting_id: varchar("meeting_id", { length: 36 }).notNull().references(() => meetingRecords.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    format: varchar("format", { length: 10 }).notNull(), // word, pdf
    exported_by: varchar("exported_by", { length: 100 }).notNull(),
    file_url: varchar("file_url", { length: 1000 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("meeting_export_records_meeting_id_idx").on(table.meeting_id),
    index("meeting_export_records_created_at_idx").on(table.created_at),
  ]
);
