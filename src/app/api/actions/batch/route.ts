import { NextRequest, NextResponse } from 'next/server';
import { createTaskBatch, updateTaskBatch, createActionItem } from '@/storage';
import { getCurrentUser } from '@/lib/session';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { logOperation } from '@/lib/operation-log';
import { getEmployees, getDepartments } from '@/storage/database/org-storage';
import { guardWrite } from '@/lib/api-guard';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const { title, sourceChannel, items } = body;

    if (!title?.trim()) {
      return NextResponse.json({ success: false, error: '请输入批次标题' }, { status: 400 });
    }
    if (!items?.length) {
      return NextResponse.json({ success: false, error: '请至少添加一条行动项' }, { status: 400 });
    }

    const batch = await createTaskBatch({
      title: title.trim(),
      sourceChannel: sourceChannel || null,
      status: 'draft',
      createdBy: user.name,
      createdByLoginId: user.loginid,
      oaPushedAt: null,
    });

    const createdItems: any[] = [];
    // 提出人 → 部门 快照映射
    const proposerDeptMap = new Map<string, string>();
    try {
      const [emps, depts] = await Promise.all([getEmployees(), getDepartments()]);
      const deptName = new Map<string, string>();
      depts.forEach((d: any) => { if (d.id) deptName.set(String(d.id), String(d.name || '')); });
      emps.forEach((e: any) => { if (e.name) proposerDeptMap.set(String(e.name).trim(), deptName.get(String(e.departmentId || '')) || ''); });
    } catch { /* 组织数据不可用时留空 */ }

    for (const item of items) {
      if (!item.description?.trim()) continue;

      const resolved = await resolveActionOwnerIdentity({
        owner: item.owner || null,
        ownerLoginId: item.ownerLoginId || null,
        dept: item.dept || null,
      });

      const actionItem = await createActionItem({
        meetingId: null,
        description: item.description.trim(),
        owner: resolved.owner || item.owner || null,
        ownerLoginId: resolved.ownerLoginId || null,
        ownerOaId: resolved.ownerOaId || null,
        dept: resolved.dept || item.dept || null,
        dueDate: item.dueDateType === 'date' ? (item.dueDate || null) : null,
        dueDateType: item.dueDateType || 'date',
        priority: item.priority || 'medium',
        status: item.oaScore === 1 ? 'done' : item.oaScore === -1 ? 'blocked' : 'pending',
        sourceType: 'batch',
        sourceId: batch.id,
        proposer: item.proposer || null,
        proposerDept: (item.proposer ? proposerDeptMap.get(String(item.proposer).trim()) || null : null),
        sourceText: item.category || null,
        oaScore: item.oaScore ?? null,
        initialResult: (item.meetingDate) ? JSON.stringify({ d: item.meetingDate }) : null,
        oaResult: (item.dueDateType === 'continuous' && (item.year || item.week || item.date)) ? JSON.stringify({ y: item.year, w: item.week, d: item.date }) : null,
      });

      createdItems.push(actionItem);
    }

    await updateTaskBatch(batch.id, { title: batch.title });

    await logOperation({
      action: 'import',
      targetType: 'import',
      targetId: batch.id,
      summary: `批量导入「${title?.trim() || batch.title}」共 ${createdItems.length} 条`,
      detail: { count: createdItems.length, batchId: batch.id, title: title?.trim() },
    });

    return NextResponse.json({
      success: true,
      data: { batch, items: createdItems },
    });
  } catch (error) {
    console.error('[actions/batch]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}
