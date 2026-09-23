import { NextRequest, NextResponse } from 'next/server';
import { guardPermission } from '@/lib/api-guard';
import { parseExcelWithImages } from '@/lib/excel-image-import';
import { createTaskBatch, createActionItem } from '@/storage';
import { saveFileToDb } from '@/storage/database/file-storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { getDepartments } from '@/storage/database/org-storage';
import { EXT_MIME_MAP } from '@/lib/file-validator';
import { logOperation } from '@/lib/operation-log';

export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/actions/import-with-images
// multipart: file(Excel) | batchName? | dryRun?
// dryRun=true → 只解析返回摘要，不写库
export async function POST(request: NextRequest) {
  const g = await guardPermission('canBatchImport');
  if (!g.ok) return g.response;
  const user = g.user;

  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const dryRun = String(form.get('dryRun') || '') === 'true';
    const batchName = String(form.get('batchName') || '').trim()
      || `厂区环境问题导入 ${new Date().toISOString().slice(0, 10)}`;
    const deptFilter = String(form.get('dept') || '').trim();
    const ownerOverride = String(form.get('owner') || '').trim();
    const proposerOverride = String(form.get('proposer') || '').trim();

    if (!file) {
      return NextResponse.json({ success: false, error: '请上传 Excel 文件' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseExcelWithImages(buffer);
    // 按部门筛选（可选）：只导入 dept 包含该关键词的记录
    const records = deptFilter ? parsed.records.filter(r => r.dept.includes(deptFilter)) : parsed.records;

    // 部门对照：与组织架构比对，列出对不上的
    const orgDepts = new Set<string>();
    try {
      const ds = await getDepartments();
      ds.forEach((d: { name?: string }) => { if (d?.name) orgDepts.add(String(d.name).trim()); });
    } catch { /* 组织数据不可用时跳过 */ }
    const unmatchedDepts = [...new Set(records.map(r => r.dept).filter(Boolean).filter(d => !orgDepts.has(d)))];
    // 各部门条数（供挑选导入范围）
    const deptCounts: Record<string, number> = {};
    for (const r of parsed.records) { const k = r.dept || '(空)'; deptCounts[k] = (deptCounts[k] || 0) + 1; }

    // ── 预览模式：不写库 ──
    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          batchName,
          records: records.length,
          totalImages: parsed.totalImages,
          departments: parsed.departments,
          deptCounts,
          unmatchedDepts,
          warnings: parsed.warnings,
          sample: records.slice(0, 8).map(r => ({
            row: r.row, seq: r.seq, dept: r.dept, location: r.location,
            desc: r.description.slice(0, 40), measure: r.measure.slice(0, 20), images: r.images.length,
          })),
        },
      });
    }

    // ── 正式导入 ──
    const batch = await createTaskBatch({
      title: batchName,
      sourceChannel: 'excel-image',
      status: 'draft',
      createdBy: user.name,
      createdByLoginId: user.loginid,
      oaPushedAt: null,
    });

    // 提出人（默认当前导入人，可用 proposer 覆盖）
    let proposer = { owner: user.name, ownerLoginId: user.loginid as string | null, ownerOaId: null as string | null, dept: (user.dept || null) as string | null };
    if (proposerOverride) {
      const pr = await resolveActionOwnerIdentity({ owner: proposerOverride, dept: null });
      proposer = { owner: pr.owner || proposerOverride, ownerLoginId: pr.ownerLoginId || null, ownerOaId: pr.ownerOaId || null, dept: pr.dept || null };
    }

    let created = 0;
    let uploadedImages = 0;
    const errors: string[] = [];

    for (const rec of records) {
      try {
        const imageUrls: string[] = [];
        for (const img of rec.images) {
          const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${img.ext}`;
          const mime = EXT_MIME_MAP[img.ext] || 'image/jpeg';
          try {
            await saveFileToDb(safe, mime, img.buffer);
            imageUrls.push(`/api/files/${safe}`);
            uploadedImages++;
          } catch (e) {
            errors.push(`行${rec.row} 图片入库失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        const ownerName = ownerOverride || rec.owner;
        const resolved = await resolveActionOwnerIdentity({ owner: ownerName || null, dept: rec.dept || null });
        const description = rec.location ? `【${rec.location}】${rec.description}` : rec.description;

        await createActionItem({
          meetingId: null,
          description,
          owner: resolved.owner || null,
          ownerLoginId: resolved.ownerLoginId || null,
          ownerOaId: resolved.ownerOaId || null,
          dept: resolved.dept || rec.dept || null,
          dueDate: rec.dueDate || null,
          dueDateType: rec.dueDate ? 'date' : 'tbd',
          priority: 'medium',
          status: 'pending',
          sourceType: 'batch',
          sourceId: batch.id,
          proposer: proposer.owner,
          proposerLoginId: proposer.ownerLoginId,
          proposerDept: proposer.dept,
          sourceText: rec.measure || null, // 整改措施 → 类别
          beforePhotos: imageUrls, // 整改前照片：独立字段，避免被汇报附件覆盖
        } as never);
        created++;
      } catch (e) {
        errors.push(`行${rec.row} 建项失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logOperation({
      action: 'import',
      targetType: 'import',
      targetId: batch.id,
      summary: `Excel带图导入「${batchName}」：${created} 条，${uploadedImages} 张图`,
      detail: { batchId: batch.id, created, uploadedImages, total: records.length, errors: errors.length },
    });

    return NextResponse.json({
      success: true,
      data: {
        batchId: batch.id,
        batchName,
        total: records.length,
        created,
        uploadedImages,
        unmatchedDepts,
        warnings: parsed.warnings.slice(0, 20),
        errors: errors.slice(0, 20),
      },
    });
  } catch (error) {
    console.error('[import-with-images]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 },
    );
  }
}
