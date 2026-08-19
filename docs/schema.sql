-- ============================================================
-- 会议纪要与行动项助手 — SQL Server 数据库建表脚本
-- 数据库: SQL Server 2019+
-- 版本: 1.0.0 | 2024-04-07
-- ============================================================

-- ── 1. meetings（会议台账） ──────────────────────────────────
CREATE TABLE hyzs_meetings (
    id              BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id      VARCHAR(64)     NOT NULL UNIQUE,          -- 业务唯一标识，如 MTG_20240407_001
    title           NVARCHAR(200)   NOT NULL,
    type            VARCHAR(20)     NOT NULL                  -- weekly | review | retrospective | general
                    CONSTRAINT chk_hyzs_meetings_type
                    CHECK (type IN ('weekly','review','retrospective','general')),
    meeting_time    DATETIME2       NULL,                     -- 实际开会时间
    organizer       NVARCHAR(50)    NULL,                     -- 组织者姓名/工号
    attendees       NVARCHAR(MAX)   NULL,                     -- JSON 数组，["张三","李四"]
    source_type     VARCHAR(10)     NOT NULL DEFAULT 'text'
                    CONSTRAINT chk_hyzs_meetings_source
                    CHECK (source_type IN ('text','audio')),
    status          VARCHAR(10)     NOT NULL DEFAULT 'draft'
                    CONSTRAINT chk_hyzs_meetings_status
                    CHECK (status IN ('draft','locked','archived')),
    locked_version  INT             NULL,                     -- 锁定时的版本号
    created_by      NVARCHAR(50)    NULL,
    created_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    updated_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_hyzs_meetings_type         ON hyzs_meetings (type);
CREATE INDEX IX_hyzs_meetings_organizer    ON hyzs_meetings (organizer);
CREATE INDEX IX_hyzs_meetings_meeting_time ON hyzs_meetings (meeting_time);
CREATE INDEX IX_hyzs_meetings_status       ON hyzs_meetings (status);

-- ── 2. transcripts（会议转写文本） ──────────────────────────
CREATE TABLE hyzs_transcripts (
    id              BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id      VARCHAR(64)     NOT NULL,
    source          NVARCHAR(MAX)   NULL,                     -- 原始转写文本 / 用户粘贴文本
    asr_status      VARCHAR(12)     NOT NULL DEFAULT 'pending'
                    CONSTRAINT chk_hyzs_transcripts_asr
                    CHECK (asr_status IN ('pending','processing','success','failed')),
    asr_task_id     VARCHAR(128)    NULL,                     -- 异步任务 ID
    word_count      INT             NULL,
    created_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_hyzs_transcripts_meeting FOREIGN KEY (meeting_id)
        REFERENCES hyzs_meetings (meeting_id) ON DELETE CASCADE
);

CREATE INDEX IX_hyzs_transcripts_meeting_id ON hyzs_transcripts (meeting_id);
CREATE INDEX IX_hyzs_transcripts_asr_status ON hyzs_transcripts (asr_status);

-- ── 3. summary_blocks（摘要分块） ─────────────────────────────
CREATE TABLE hyzs_summary_blocks (
    id               BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id       VARCHAR(64)     NOT NULL,
    section_type     VARCHAR(15)     NOT NULL
                     CONSTRAINT chk_hyzs_summary_section
                     CHECK (section_type IN ('agenda','conclusion','risk','decision','next_step')),
    content          NVARCHAR(MAX)   NOT NULL,
    confidence       DECIMAL(4,3)    NOT NULL DEFAULT 1.0     -- 0.000 ~ 1.000
                     CONSTRAINT chk_hyzs_summary_confidence
                     CHECK (confidence BETWEEN 0 AND 1),
    is_edited        BIT             NOT NULL DEFAULT 0,
    original_content NVARCHAR(MAX)   NULL,                    -- 编辑前的 AI 原始内容
    created_at       DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_hyzs_summary_meeting FOREIGN KEY (meeting_id)
        REFERENCES hyzs_meetings (meeting_id) ON DELETE CASCADE
);

CREATE INDEX IX_hyzs_summary_meeting_id ON hyzs_summary_blocks (meeting_id);

-- ── 4. action_items（行动项） ─────────────────────────────────
CREATE TABLE hyzs_action_items (
    id                BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id        VARCHAR(64)     NOT NULL,
    description       NVARCHAR(500)   NOT NULL,
    owner             NVARCHAR(50)    NULL,                   -- 负责人（null 表示未识别）
    due_date          DATE            NULL,                   -- 截止日期（YYYY-MM-DD）
    priority          VARCHAR(6)      NOT NULL DEFAULT 'medium'
                      CONSTRAINT chk_hyzs_action_priority
                      CHECK (priority IN ('high','medium','low')),
    status            VARCHAR(12)     NOT NULL DEFAULT 'pending'
                      CONSTRAINT chk_hyzs_action_status
                      CHECK (status IN ('pending','confirmed','in_progress','done','blocked')),
    confidence_owner  DECIMAL(4,3)    NOT NULL DEFAULT 1.0
                      CONSTRAINT chk_hyzs_action_conf_owner
                      CHECK (confidence_owner BETWEEN 0 AND 1),
    confidence_date   DECIMAL(4,3)    NOT NULL DEFAULT 1.0
                      CONSTRAINT chk_hyzs_action_conf_date
                      CHECK (confidence_date BETWEEN 0 AND 1),
    source_sentence   NVARCHAR(500)   NULL,                   -- AI 依据的原文句子
    source_offset     INT             NULL,                   -- 原文字符偏移（用于高亮定位）
    confirmed_by      NVARCHAR(50)    NULL,
    confirmed_at      DATETIME2       NULL,
    created_at        DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    updated_at        DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_hyzs_action_meeting FOREIGN KEY (meeting_id)
        REFERENCES hyzs_meetings (meeting_id) ON DELETE CASCADE
);

CREATE INDEX IX_hyzs_action_meeting_id ON hyzs_action_items (meeting_id);
CREATE INDEX IX_hyzs_action_owner      ON hyzs_action_items (owner);
CREATE INDEX IX_hyzs_action_status     ON hyzs_action_items (status);
CREATE INDEX IX_hyzs_action_due_date   ON hyzs_action_items (due_date);

-- ── 5. export_records（导出记录） ─────────────────────────────
CREATE TABLE hyzs_export_records (
    id          BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id  VARCHAR(64)     NOT NULL,
    version_no  INT             NOT NULL DEFAULT 1,
    format      VARCHAR(4)      NOT NULL
                CONSTRAINT chk_hyzs_export_format
                CHECK (format IN ('word','pdf')),
    file_name   NVARCHAR(255)   NULL,                        -- 导出文件名（含版本号）
    file_url    NVARCHAR(1024)  NULL,                        -- 对象存储下载链接
    operator    NVARCHAR(50)    NULL,
    exported_at DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_hyzs_export_meeting FOREIGN KEY (meeting_id)
        REFERENCES hyzs_meetings (meeting_id) ON DELETE CASCADE
);

CREATE INDEX IX_hyzs_export_meeting_id ON hyzs_export_records (meeting_id);

-- ── 7. meeting_types（会议类别配置） ───────────────────────────
CREATE TABLE hyzs_meeting_types (
    id              VARCHAR(50)     NOT NULL PRIMARY KEY,        -- mt_1, mt_2, etc.
    name            NVARCHAR(50)    NOT NULL UNIQUE,
    default_dept    NVARCHAR(100)   NULL,                       -- 默认负责部门
    default_owner   NVARCHAR(50)    NULL,                       -- 默认负责人
    sort            INT             NOT NULL DEFAULT 0,          -- 排序
    created_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    updated_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_hyzs_meeting_types_sort ON hyzs_meeting_types (sort);

-- ── 8. user_roles（用户角色配置） ───────────────────────────────
CREATE TABLE hyzs_user_roles (
    loginid         VARCHAR(50)     NOT NULL PRIMARY KEY,        -- OA 登录账号
    role            VARCHAR(20)     NOT NULL DEFAULT 'employee'
                    CONSTRAINT chk_hyzs_user_roles_role
                    CHECK (role IN ('admin','manager','secretary','employee')),
    created_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
    updated_at      DATETIME2       NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_hyzs_user_roles_role ON hyzs_user_roles (role);

-- ── 6. operation_logs（操作审计日志，保留 90 天） ──────────────
CREATE TABLE hyzs_operation_logs (
    id          BIGINT          IDENTITY(1,1) PRIMARY KEY,
    meeting_id  VARCHAR(64)     NULL,                        -- 可为 NULL（系统操作）
    action      VARCHAR(20)     NOT NULL
                CONSTRAINT chk_hyzs_log_action
                CHECK (action IN ('upload','transcribe','generate','edit','confirm',
                                  'lock','export','delete','create')),
    operator    NVARCHAR(50)    NOT NULL,
    detail      NVARCHAR(MAX)   NULL,                        -- JSON 格式的详细信息
    ip_address  VARCHAR(45)     NULL,
    created_at  DATETIME2       NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_hyzs_log_meeting_id ON hyzs_operation_logs (meeting_id);
CREATE INDEX IX_hyzs_log_created_at ON hyzs_operation_logs (created_at);   -- 用于 90 天清理任务

-- ── 自动清理 90 天前的操作日志（SQL Server Agent Job 示例）────
/*
-- 建议通过 SQL Server Agent 每日执行：
DELETE FROM hyzs_operation_logs
WHERE created_at < DATEADD(DAY, -90, GETUTCDATE());
*/

-- ── 触发器：自动更新 updated_at ──────────────────────────────
CREATE TRIGGER trg_hyzs_meetings_updated_at
ON hyzs_meetings AFTER UPDATE
AS BEGIN
    SET NOCOUNT ON;
    UPDATE hyzs_meetings SET updated_at = GETUTCDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
GO

CREATE TRIGGER trg_hyzs_action_items_updated_at
ON hyzs_action_items AFTER UPDATE
AS BEGIN
    SET NOCOUNT ON;
    UPDATE hyzs_action_items SET updated_at = GETUTCDATE()
    WHERE id IN (SELECT id FROM inserted);
END;
GO

-- ── 纪要视图：将 minutes JSON 展开为可查询列 ─────────────────
-- 依赖 SQL Server 2016+ OPENJSON
CREATE OR ALTER VIEW vw_hyzs_minutes_action_items AS
SELECT
    m.meeting_id,
    m.title            AS meeting_title,
    m.meeting_time,
    m.organizer,
    m.status,
    JSON_VALUE(m.minutes, '$.meetingDate')    AS minutes_date,
    JSON_VALUE(m.minutes, '$.conclusion')     AS conclusion,
    -- 行动项字段
    ai.[key]           AS item_seq,
    JSON_VALUE(ai.value, '$.seq')             AS seq,
    JSON_VALUE(ai.value, '$.task')            AS task,
    JSON_VALUE(ai.value, '$.owner')           AS owner,
    JSON_VALUE(ai.value, '$.ownerLoginId')    AS owner_loginid,
    JSON_VALUE(ai.value, '$.ownerDept')       AS owner_dept,
    JSON_VALUE(ai.value, '$.goal')            AS goal
FROM hyzs_meetings m
CROSS APPLY OPENJSON(JSON_QUERY(m.minutes, '$.actionTable')) ai
WHERE m.minutes IS NOT NULL;
GO

-- ── 示例种子数据（可选） ─────────────────────────────────────
INSERT INTO hyzs_meetings (meeting_id, title, type, meeting_time, organizer, attendees, source_type, status, created_by)
VALUES (
    'MTG_DEMO_001',
    '产品双周会 2024-W14',
    'weekly',
    '2024-04-07 14:00:00',
    '张三',
    N'["张三","李四","王五"]',
    'text',
    'draft',
    '张三'
);
