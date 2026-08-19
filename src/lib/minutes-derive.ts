// 从纪要派生摘要和行动项（纯数据转换，无 AI 调用）
import type { MeetingMinutes } from './minutes-generator';

export function deriveSummary(minutes: MeetingMinutes) {
  const keyTopics = minutes.sections?.flatMap(sec =>
    sec.items?.map(item => ({
      topic: item.subtitle,
      description: item.points?.map(p => p.text).join(' ').substring(0, 200) || '',
      importance: 'medium' as const,
    })) || []
  ) || [];

  const decisions = minutes.sections?.flatMap(sec =>
    sec.items?.flatMap(item =>
      item.points
        ?.filter(p => p.label === '决议' || p.label === '共识')
        .flatMap(p => (p.bullets?.length ? p.bullets : [p.text]))
        .map((d: string) => ({
          decision: d,
          rationale: '',
          impact: '',
          stakeholders: [] as string[],
        })) || []
    ) || []
  ) || [];

  const nextSteps = (minutes.actionTable || []).map(row => ({
    step: row.task,
    owner: row.owner || null,
    timeline: null as string | null,
    priority: 'medium' as const,
  }));

  return {
    title: minutes.title,
    overview: minutes.conclusion || '',
    keyTopics,
    decisions,
    risks: [] as Array<{ risk: string; probability: string; impact: string; mitigation: string }>,
    nextSteps,
    participants: [] as string[],
    meetingDate: minutes.meetingDate,
    estimatedDuration: '',
  };
}

export function deriveActionItems(minutes: MeetingMinutes) {
  const continuousKeywords = ['持续执行', '持续跟进', '每日', '每周', '长期', '常态化', '持续', '常规', '日常'];
  const tbdKeywords = ['待定', '待确认', '另行通知', '后续确定', '待明确', '另行确认', '后续通知'];

  return (minutes.actionTable || []).map((row, index) => {
    let dueDate: string | undefined;
    let dueDateType: string = 'tbd';

    const goalText = (row.goal || '').trim();
    const combinedText = `${row.goal || ''} ${row.task || ''}`;

    // 先判定持续项
    if (continuousKeywords.some(kw => combinedText.includes(kw))) {
      dueDateType = 'continuous';
    }
    // 再判定待定
    else if (tbdKeywords.some(kw => combinedText.includes(kw))) {
      dueDateType = 'tbd';
    }
    // 尝试解析日期
    else {
      const dateText = [row.goal, row.task].find(s => s && /\d{1,2}月\d{1,2}|月底|下[周月]|\d{4}年\d{1,2}月|\d{1,2}[\/\-]\d{1,2}/.test(s));
      if (dateText) {
        const m1 = dateText.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
        if (m1) dueDate = `${m1[1]}-${m1[2].padStart(2,'0')}-${m1[3].padStart(2,'0')}`;
        if (!dueDate) {
          const m2 = dateText.match(/(\d{1,2})[月/\-.](\d{1,2})/);
          if (m2) dueDate = `${new Date().getFullYear()}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
        }
        if (dueDate) dueDateType = 'date';
      }
    }

    return {
      id: `action-${index + 1}`,
      description: row.task,
      owner: row.owner || undefined,
      assignee: row.owner || undefined,
      ownerLoginId: row.ownerLoginId || undefined,
      ownerOaId: row.ownerOaId || undefined,
      dept: row.ownerDept || undefined,
      dueDate,
      dueDateType,
      priority: 'medium' as const,
      status: 'pending' as const,
      initialResult: row.goal || undefined,
      confidence: {
        assignee: row.owner ? 0.95 : 0.8,
        dueDate: dueDate ? 0.8 : 0.1,
        priority: 0.9,
      },
      sourceText: '',
      category: 'task' as const,
    };
  });
}
