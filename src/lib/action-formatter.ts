// 行动项格式化工具
// 将行动项数组格式化为待办清单文本

import type { ActionItemRecord } from '@/storage';

type ActionItem = ActionItemRecord;

interface FormatOptions {
  showCompleted?: boolean;
  showPriority?: boolean;
  showDueDate?: boolean;
  maxItems?: number;
  groupByStatus?: boolean;
}

const PRIORITY_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  confirmed: '已确认',
  in_progress: '进行中',
  done: '已完成',
  blocked: '已阻塞',
};

const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  confirmed: '✅',
  in_progress: '🔄',
  done: '✅',
  blocked: '🚫',
};

const PRIORITY_EMOJI: Record<string, string> = {
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `已逾期 ${Math.abs(diffDays)} 天`;
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '明天';
  if (diffDays <= 7) return `${diffDays} 天后`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function formatActionItemsToTodoList(
  items: ActionItem[],
  options: FormatOptions = {},
  includeHeader = true
): string {
  const {
    showCompleted = false,
    showPriority = true,
    showDueDate = true,
    maxItems,
    groupByStatus = true,
  } = options;

  // 过滤已完成的行动项
  let filteredItems = showCompleted
    ? items
    : items.filter(item => item.status !== 'done');

  // 限制数量
  if (maxItems && maxItems > 0) {
    filteredItems = filteredItems.slice(0, maxItems);
  }

  if (filteredItems.length === 0) {
    return includeHeader ? '暂无待办事项' : '';
  }

  let lines: string[] = [];

  if (groupByStatus) {
    // 按状态分组
    const groups = filteredItems.reduce((acc, item) => {
      const status = item.status || 'pending';
      if (!acc[status]) acc[status] = [];
      acc[status].push(item);
      return acc;
    }, {} as Record<string, ActionItem[]>);

    // 按优先级排序：高 > 中 > 低
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

    for (const [status, statusItems] of Object.entries(groups)) {
      const items = statusItems as ActionItem[];
      if (items.length === 0) continue;

      lines.push(`\n${STATUS_EMOJI[status] || ''} ${STATUS_LABEL[status] || status} (${items.length})`);

      items.sort((a: ActionItem, b: ActionItem) => {
        const priorityDiff = (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
        if (priorityDiff !== 0) return priorityDiff;
        const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return dueA - dueB;
      });

      items.forEach((item: ActionItem, index: number) => {
        const priorityEmoji = showPriority ? PRIORITY_EMOJI[item.priority] || '' : '';
        const dueDateStr = showDueDate && item.dueDate ? `· ${formatDate(item.dueDate)}` : '';
        const proposerPrefix = item.proposer ? `[提出人: ${item.proposer}] ` : '';
        lines.push(`${index + 1}. ${priorityEmoji} ${proposerPrefix}${item.description}${dueDateStr}`);
      });
    }
  } else {
    // 不分组，直接列表
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

    filteredItems.sort((a: ActionItem, b: ActionItem) => {
      const priorityDiff = (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
      if (priorityDiff !== 0) return priorityDiff;
      const dueA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const dueB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return dueA - dueB;
    });

    filteredItems.forEach((item: ActionItem, index: number) => {
      const priorityEmoji = showPriority ? PRIORITY_EMOJI[item.priority] || '' : '';
      const dueDateStr = showDueDate && item.dueDate ? `· ${formatDate(item.dueDate)}` : '';
      const proposerPrefix = item.proposer ? `[提出人: ${item.proposer}] ` : '';
      lines.push(`${index + 1}. ${priorityEmoji} ${proposerPrefix}${item.description}${dueDateStr}`);
    });
  }

  const total = filteredItems.length;
  const body = lines.join('\n');
  if (!includeHeader) {
    return body.replace(/^\n+/, '');
  }

  const header = `📋 待办清单（共 ${total} 项）\n${'─'.repeat(20)}`;

  return `${header}${body}`;
}

export function formatActionItemsToStructuredCard(
  items: ActionItem[],
  options: FormatOptions & { projectsMap?: Map<string, any> } = {}
): string {
  const {
    showCompleted = false,
    maxItems,
    projectsMap,
  } = options;

  let filteredItems = showCompleted
    ? items
    : items.filter(item => item.status !== 'done');

  // 排序：逾期优先 -> 优先级(高>中>低) -> 截止日期
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  filteredItems.sort((a, b) => {
    // 逾期判断
    const isOverdueA = a.dueDate && new Date(a.dueDate) < new Date();
    const isOverdueB = b.dueDate && new Date(b.dueDate) < new Date();
    if (isOverdueA && !isOverdueB) return -1;
    if (!isOverdueA && isOverdueB) return 1;

    // 优先级
    const pa = priorityOrder[a.priority] ?? 1;
    const pb = priorityOrder[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;

    // 日期
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return da - db;
  });

  if (maxItems && maxItems > 0) {
    filteredItems = filteredItems.slice(0, maxItems);
  }

  if (filteredItems.length === 0) {
    return JSON.stringify({
      title: '📋 待办中心',
      text: '您目前没有待处理的任务，继续保持！',
    });
  }

  const total = filteredItems.length;
  const pendingCount = filteredItems.filter(i => i.status === 'pending' || i.status === 'confirmed' || i.status === 'in_progress').length;
  const overdueCount = filteredItems.filter(i => {
    if (!i.dueDate || i.status === 'done') return false;
    const d = new Date(i.dueDate);
    d.setHours(23, 59, 59, 999);
    return d < new Date();
  }).length;

  const card = {
    title: '🚀 研发项目管理驾驶舱',
    text: `您今日有 ${total} 项任务待跟进${overdueCount > 0 ? `，其中 ${overdueCount} 项已逾期` : ''}。`,
    items: filteredItems.slice(0, 5).map(item => {
      const projectName = item.projectId && projectsMap?.get(item.projectId)?.name;
      const projectPrefix = projectName ? `[${projectName}] ` : '';
      const proposerPrefix = item.proposer ? `[提出人: ${item.proposer}] ` : '';

      return {
        text: `${projectPrefix}${proposerPrefix}${item.description}`,
        status: `${STATUS_EMOJI[item.status] || ''} ${STATUS_LABEL[item.status] || item.status}`,
        priority: `${PRIORITY_EMOJI[item.priority] || ''} ${PRIORITY_LABEL[item.priority] || item.priority}`,
        dueDate: item.dueDate ? `📅 ${formatDate(item.dueDate)}` : '',
      };
    }),
    footer: '请及时在系统中更新进展。',
    url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000'}/kanban`,
  };

  return JSON.stringify(card);
}
