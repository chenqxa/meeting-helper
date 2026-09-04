// 姓名清洗与匹配：处理 AI 生成时"名字带部门/括号注记"的情况
// 例：'陈巧霞（开发部）' '开发部陈巧霞' '张三-财务部' '李四(负责人)' → 提取纯名字后匹配 OA 用户
// 匹配失败时返回 null，调用方保留原值（不限制自定义人名）

import { searchOAUsers } from './weaver-notify';

// 从"名字+杂质"字符串中提取候选姓名（多个候选按长度降序，优先最长匹配）
export function extractNameCandidates(raw: string): string[] {
  let s = String(raw || '').trim();
  if (!s) return [];

  // 1) 去括号注记：'陈巧霞（开发部）' '张三(负责人)' '李四【总经办】'
  s = s.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ');
  // 2) 常见分隔符切分：'-' '—' '/' '|' ',' '，' ':' '：' 空格
  const parts = s.split(/[-—/\|,，:：\s、;；]+/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  const candidates = new Set<string>();
  for (const p of parts) {
    candidates.add(p);
  }
  // 中文姓名通常 2-4 字：若切出的片段里混着部门词（如"开发部陈巧霞"），再剥离部门前后缀
  const DEPT_WORDS = ['部', '中心', '处', '科', '室', '组', '办', '委员会', '事业部'];
  for (const p of parts) {
    // 前缀型：'开发部陈巧霞'
    for (const w of DEPT_WORDS) {
      const idx = p.indexOf(w);
      if (idx >= 0 && idx + w.length < p.length) {
        candidates.add(p.slice(idx + w.length));
      }
    }
    // 2字以上片段整体也保留（可能就是姓名）
  }

  // 按长度降序（长名优先精确），过滤单字符
  return [...candidates].filter(c => c.length >= 2).sort((a, b) => b.length - a.length);
}

export interface MatchedOAUser {
  loginid: string;
  name: string;
  dept: string;
  oaId?: string;
}

// 尝试把"可能带部门的原始字符串"匹配到 OA 用户：
// 1) 原串直接搜 → 2) 候选姓名逐个搜（精确相等优先）→ 都失败返回 null（保留原值）
export async function matchUserFuzzy(raw: string): Promise<MatchedOAUser | null> {
  const rawTrimmed = String(raw || '').trim();
  if (!rawTrimmed) return null;

  // 原串整搜（本身就是纯名字时最快）
  const direct = await tryExact(rawTrimmed);
  if (direct) return direct;

  for (const cand of extractNameCandidates(rawTrimmed)) {
    if (cand === rawTrimmed) continue;
    const hit = await tryExact(cand);
    if (hit) {
      console.log(`[match-name] "${raw}" → "${hit.name}" (候选: ${cand})`);
      return hit;
    }
  }
  return null;
}

async function tryExact(name: string): Promise<MatchedOAUser | null> {
  try {
    const list = await searchOAUsers(name);
    if (!list.length) return null;
    const exact = list.find(u => u.lastname === name) || list[0];
    return {
      oaId: best(exact, 'oaId'),
      loginid: best(exact, 'loginid'),
      name: best(exact, 'lastname'),
      dept: best(exact, 'departmentname'),
    };
  } catch {
    return null;
  }
}

function best(obj: Record<string, unknown>, key: string): string {
  return String(obj?.[key] ?? '') || '';
}
