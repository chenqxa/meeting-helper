export type ActionDisplayStatus = 'pending' | 'done' | 'cancelled';

export function getActionDisplayStatus(status?: string | null): ActionDisplayStatus {
  const normalized = String(status || '').trim();
  if (normalized === 'done') return 'done';
  if (normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

export function getActionDisplayLabel(status?: string | null): string {
  const displayStatus = getActionDisplayStatus(status);
  if (displayStatus === 'done') return '已处理';
  if (displayStatus === 'cancelled') return '已取消';
  return '未处理';
}

const DONE_KEYWORDS = ['完成', '已完', '通过', '完毕', '达成', '落实', '已执行', '已实现', '已处理', '已解决', '已上线', '已发布', '验收'];
const FAIL_KEYWORDS = ['未完成', '无法', '取消', '放弃', '阻塞', '超期', '拒绝', '不通过', '失败', '暂停'];
const PROGRESS_KEYWORDS = ['进行中', '部分完成', '延期', '推迟', '正在', '跟进中'];

export function autoDetectStatus(
  resultText: string,
  explicitStatus?: string,
): { status: string; score: number; autoDetected: boolean } {
  if (explicitStatus === 'done') return { status: 'done', score: 1, autoDetected: false };
  if (explicitStatus === 'blocked') return { status: 'blocked', score: -1, autoDetected: false };

  const text = (resultText || '').toLowerCase();
  for (const kw of FAIL_KEYWORDS) {
    if (text.includes(kw)) return { status: 'blocked', score: -1, autoDetected: true };
  }
  for (const kw of DONE_KEYWORDS) {
    if (text.includes(kw)) return { status: 'done', score: 1, autoDetected: true };
  }
  for (const kw of PROGRESS_KEYWORDS) {
    if (text.includes(kw)) return { status: 'in_progress', score: 0, autoDetected: true };
  }

  return { status: 'in_progress', score: 0, autoDetected: false };
}
