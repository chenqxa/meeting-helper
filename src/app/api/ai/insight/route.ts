import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { summary, isPersonal } = await request.json();

    if (!summary) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    // 简化版：基于统计数据的规则生成洞察
    // 真正的AI洞察需要调用LLM API
    let insights: string[] = [];

    if (isPersonal) {
      // 个人任务洞察
      if (summary.overdue > 0) {
        insights.push(`⚠️ 你有 ${summary.overdue} 个任务已逾期，建议优先处理`);
      }

      if (summary.blocked > 0) {
        insights.push(`🚫 ${summary.blocked} 个任务被阻塞，需要主动协调解决`);
      }

      if (summary.inProgress > 0) {
        insights.push(`🔄 ${summary.inProgress} 个任务正在进行中，记得定期汇报进展`);
      }

      if (summary.done > 0) {
        const completionRate = Math.round((summary.done / summary.total) * 100);
        insights.push(`✅ 已完成 ${summary.done} 个任务（${completionRate}% 完成率）`);
      }

      // 个人优先级洞察
      const highPriority = (summary.byPriority as any)?.high || 0;
      if (highPriority > 0) {
        insights.push(`🔥 有 ${highPriority} 个高优先级任务，建议今日优先完成`);
      }

      // 个人建议
      if (summary.total > 5) {
        insights.push(`💡 任务较多，建议按优先级和截止日期排序处理`);
      } else if (summary.total === 0) {
        insights.push(`🎉 当前没有待办任务，可以主动承接新任务`);
      }
    } else {
      // 全局任务洞察
      if (summary.overdue > 0) {
        insights.push(`⚠️ 有 ${summary.overdue} 个任务已逾期，建议立即处理`);
      }

      if (summary.blocked > 0) {
        insights.push(`🚫 ${summary.blocked} 个任务处于阻塞状态，需要协调解决`);
      }

      if (summary.inProgress > 0) {
        insights.push(`🔄 ${summary.inProgress} 个任务正在进行中，建议定期跟进`);
      }

      if (summary.done > 0) {
        const completionRate = Math.round((summary.done / summary.total) * 100);
        insights.push(`✅ 已完成 ${summary.done} 个任务（${completionRate}% 完成率）`);
      }

      // 部门分布洞察
      const deptEntries = Object.entries(summary.byDept || {});
      if (deptEntries.length > 0) {
        const maxDept = deptEntries.sort((a, b) => (b[1] as number) - (a[1] as number))[0];
        insights.push(`📊 ${maxDept[0]} 部门任务最多（${maxDept[1]} 个）`);
      }

      // 优先级洞察
      const highPriority = (summary.byPriority as any)?.high || 0;
      if (highPriority > 0) {
        insights.push(`🔥 有 ${highPriority} 个高优先级任务，建议优先安排`);
      }
    }

    const insightText = insights.length > 0 ? insights.join('；') : '当前任务状态良好，继续保持';

    return NextResponse.json({
      success: true,
      insight: insightText,
    });
  } catch (error) {
    console.error('[AI Insight] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Insight generation failed' },
      { status: 500 }
    );
  }
}
