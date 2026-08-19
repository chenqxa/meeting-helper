-- ============================================================
-- 迁移初始数据：从 JSON 文件迁移到 SQL Server
-- 执行此脚本前，请确保已执行 docs/schema.sql 创建表结构
-- ============================================================

-- ── 插入会议类别初始数据（来自 base-data.json） ─────────────────
IF NOT EXISTS (SELECT 1 FROM hyzs_meeting_types WHERE id = 'mt_1')
BEGIN
    INSERT INTO hyzs_meeting_types (id, name, default_dept, default_owner, sort)
    VALUES
        ('mt_1', N'协调会', NULL, NULL, 1),
        ('mt_2', N'点检会', NULL, NULL, 2),
        ('mt_3', N'周会', NULL, NULL, 3),
        ('mt_4', N'月度总结会', NULL, NULL, 4),
        ('mt_5', N'评审会', NULL, NULL, 5),
        ('mt_6', N'复盘会', NULL, NULL, 6),
        ('mt_7', N'培训会', NULL, NULL, 7),
        ('mt_8', N'安全例会', NULL, NULL, 8),
        ('mt_9', N'生产调度会', NULL, NULL, 9),
        ('mt_10', N'项目启动会', NULL, NULL, 10);
END
GO

-- ── 插入用户角色初始数据（来自 roles.json） ───────────────────────
IF NOT EXISTS (SELECT 1 FROM hyzs_user_roles WHERE loginid = 'chenqiaoxia')
BEGIN
    INSERT INTO hyzs_user_roles (loginid, role)
    VALUES
        ('chenqiaoxia', 'admin'),
        ('朱剑军', 'admin'),
        ('戎双娇', 'admin'),
        ('E0766', 'admin'),
        ('E0785', 'admin'),
        ('孔令军', 'admin'),
        ('马雅雯', 'manager'),
        ('徐蓉', 'secretary'),
        ('李朦', 'secretary'),
        ('汪华正', 'secretary'),
        ('付天宇', 'manager');
END
GO
