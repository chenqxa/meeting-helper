import { NextRequest, NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import { AUTO_FETCH_SOURCES } from '@/lib/auto-fetch-sources-meta';
import { listCustomSources, upsertCustomSource } from '@/storage/database/auto-fetch-source-storage';

// GET /api/auto-fetch-sources - 取数源列表（内置 + 自定义）
export async function GET() {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
  try {
    const custom = await listCustomSources();
    return NextResponse.json({ success: true, data: { builtin: AUTO_FETCH_SOURCES, custom } });
  } catch (error) {
    console.error('[auto-fetch-sources] list', error);
    return NextResponse.json({ success: false, error: '读取取数源失败' }, { status: 500 });
  }
}

// POST /api/auto-fetch-sources - 新建/覆盖自定义取数源
export async function POST(request: NextRequest) {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
  try {
    const b = await request.json();
    const key = String(b?.key || '').trim();
    const name = String(b?.name || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(key)) {
      return NextResponse.json({ success: false, error: 'key 只能用小写字母/数字/短横线，2~64 位（如 custom-kpi-1）' }, { status: 400 });
    }
    if (AUTO_FETCH_SOURCES.some(s => s.key === key)) {
      return NextResponse.json({ success: false, error: '该 key 与内置源冲突，请换一个' }, { status: 400 });
    }
    if (!name) return NextResponse.json({ success: false, error: '请填写源名称' }, { status: 400 });
    await upsertCustomSource({
      key, name,
      src: b.src ?? null, how: b.how ?? null, when: b.when ?? null,
      summarySql: b.summarySql ?? null, detailSql: b.detailSql ?? null,
      progressTpl: b.progressTpl ?? null, detailCols: b.detailCols ?? null,
      enabled: b.enabled !== false,
    });
    return NextResponse.json({ success: true, data: { key } });
  } catch (error) {
    console.error('[auto-fetch-sources] create', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '保存失败' }, { status: 500 });
  }
}
