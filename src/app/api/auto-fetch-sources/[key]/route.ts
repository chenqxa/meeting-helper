import { NextRequest, NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import { AUTO_FETCH_SOURCES } from '@/lib/auto-fetch-sources-meta';
import { getCustomSource, upsertCustomSource, deleteCustomSource } from '@/storage/database/auto-fetch-source-storage';

// PUT /api/auto-fetch-sources/[key] - 更新自定义取数源（未提供的字段保持原值）
export async function PUT(request: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
  try {
    const { key } = await ctx.params;
    if (AUTO_FETCH_SOURCES.some(s => s.key === key)) {
      return NextResponse.json({ success: false, error: '内置源不可在前台修改' }, { status: 400 });
    }
    const existing = await getCustomSource(key);
    if (!existing) return NextResponse.json({ success: false, error: '取数源不存在' }, { status: 404 });

    const b = await request.json();
    const pick = <T>(v: T | undefined, fallback: T): T => (v === undefined ? fallback : v);
    await upsertCustomSource({
      key,
      name: pick(b.name, existing.name),
      src: pick(b.src, existing.src),
      how: pick(b.how, existing.how),
      when: pick(b.when, existing.when),
      summarySql: pick(b.summarySql, existing.summarySql),
      detailSql: pick(b.detailSql, existing.detailSql),
      progressTpl: pick(b.progressTpl, existing.progressTpl),
      detailCols: pick(b.detailCols, existing.detailCols),
      enabled: pick(b.enabled, existing.enabled),
    });
    return NextResponse.json({ success: true, data: { key } });
  } catch (error) {
    console.error('[auto-fetch-sources] update', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '保存失败' }, { status: 500 });
  }
}

// DELETE /api/auto-fetch-sources/[key]
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
  try {
    const { key } = await ctx.params;
    if (AUTO_FETCH_SOURCES.some(s => s.key === key)) {
      return NextResponse.json({ success: false, error: '内置源不可删除' }, { status: 400 });
    }
    const ok = await deleteCustomSource(key);
    return NextResponse.json({ success: true, data: { deleted: ok } });
  } catch (error) {
    console.error('[auto-fetch-sources] delete', error);
    return NextResponse.json({ success: false, error: '删除失败' }, { status: 500 });
  }
}
