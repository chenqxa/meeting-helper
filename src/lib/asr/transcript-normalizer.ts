export interface TranscriptHintContext {
  participants?: Array<string | null | undefined>;
  organizer?: string | null;
  terms?: Array<string | null | undefined>;
}

const CJK_TOKEN_RE = /[\u4e00-\u9fa5]{2,6}/g;

const STATIC_CORRECTIONS: Array<[RegExp, string]> = [
  [/保姆工价|包母工价|保母工价/g, 'BOM工价'],
  [/保姆表|包母表|保母表/g, 'BOM表'],
  [/保姆|包母|保母|包目/g, 'BOM'],
  [/K\s*三|K三|k3|k\s*3/gi, 'K3'],
  [/\b[oO]\s*[aA]\b/g, 'OA'],
  [/\b[eE]\s*[rR]\s*[pP]\b/g, 'ERP'],
  [/\b[mM]\s*[rR]\s*[pP]\b/g, 'MRP'],
  [/\b[uU]\s*[lL]\b/g, 'UL'],
  [/\b[uU]\s*[gG]\s*[rR]\b/g, 'UGR'],
  [/\b[iI]\s*[mM]\b/g, 'IM'],
  [/\b[aA]\s*[iI]\b/g, 'AI'],
  [/企\s*微/g, '企微'],
  [/发言人\s*\d+/g, '[待指定]'],
];

const CN_MONTH_NUM: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12,
};

const CN_DAY_NUM: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  '二十一': 21, '二十二': 22, '二十三': 23, '二十四': 24, '二十五': 25,
  '二十六': 26, '二十七': 27, '二十八': 28, '二十九': 29, '三十': 30, '三十一': 31,
};

const SPEECH_DIGIT: Record<string, string> = {
  '幺': '1', '零': '0', '一': '1', '二': '2', '三': '3', '四': '4',
  '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(name?: string | null): string {
  return (name || '').trim().replace(/\s+/g, '');
}

function normalizeCnDates(text: string): string {
  return text.replace(
    /(十二|十一|[一二三四五六七八九十])(月)(三十一|三十|二十[一二三四五六七八九]|二十|十[一二三四五六七八九]|十|[一二三四五六七八九])(号|日)/g,
    (full, m, _month, d) => {
      const mo = CN_MONTH_NUM[m];
      const dy = CN_DAY_NUM[d];
      return mo && dy ? `${mo}月${dy}日` : full;
    }
  );
}

function normalizeCnDigits(text: string): string {
  const toArabic = (value: string) => value.split('').map((ch) => SPEECH_DIGIT[ch] ?? ch).join('');
  let result = text.replace(
    /[幺零一二三四五六七八九]*幺[幺零一二三四五六七八九]*/g,
    (value) => (value.length >= 2 ? toArabic(value) : value)
  );

  result = result.replace(
    /(?<=\d[^，。；\n]{0,5}[、,])([零一二三四五六七八九]{4,})/g,
    (value) => toArabic(value)
  );

  return result;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function applyKnownNames(text: string, names: string[]): string {
  let result = text;

  for (const name of names) {
    if (name.length < 2) continue;
    const spacedPattern = new RegExp(name.split('').map(escapeRegExp).join('\\s*'), 'g');
    result = result.replace(spacedPattern, name);
  }

  return result.replace(CJK_TOKEN_RE, (token) => {
    const candidates = names.filter((name) => Math.abs(name.length - token.length) <= 1);
    if (candidates.length === 0) return token;

    let best = '';
    let bestDistance = Number.MAX_SAFE_INTEGER;
    let ambiguous = false;

    for (const candidate of candidates) {
      const distance = levenshtein(token, candidate);
      const sharesPrefix = candidate[0] === token[0];
      const sharesSuffix = candidate[candidate.length - 1] === token[token.length - 1];
      if (distance <= 1 && (sharesPrefix || sharesSuffix)) {
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
          ambiguous = false;
        } else if (distance === bestDistance && candidate !== best) {
          ambiguous = true;
        }
      }
    }

    return best && !ambiguous ? best : token;
  });
}

function applyKnownTerms(text: string, terms: string[]): string {
  let result = text;
  for (const term of terms) {
    if (!term || term.length < 2) continue;
    const pattern = new RegExp(term.split('').map(escapeRegExp).join('\\s*'), 'gi');
    result = result.replace(pattern, term);
  }
  return result;
}

function splitSpeakerLabel(line: string): { label: string; content: string } {
  const match = line.match(/^(说话人\d+：)(.*)$/);
  if (!match) return { label: '', content: line };
  return { label: match[1], content: match[2] || '' };
}

function buildHintTerms(context?: TranscriptHintContext): { names: string[]; terms: string[] } {
  const names = Array.from(new Set(
    [context?.organizer, ...(context?.participants || [])]
      .map(normalizeName)
      .filter(Boolean)
  ));

  const terms = Array.from(new Set(
    (context?.terms || [])
      .map((term) => (term || '').trim())
      .filter((term): term is string => Boolean(term && term.length >= 2))
  ));

  return { names, terms };
}

export function normalizeTranscriptLine(line: string, context?: TranscriptHintContext): string {
  const { names, terms } = buildHintTerms(context);
  const { label, content } = splitSpeakerLabel(line);

  let result = content || '';
  for (const [pattern, replacement] of STATIC_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  result = normalizeCnDates(result);
  result = normalizeCnDigits(result);
  result = applyKnownTerms(result, terms);
  result = applyKnownNames(result, names);
  result = result.replace(/\s{2,}/g, ' ').trim();

  return `${label}${result}`.trim();
}

export function normalizeTranscriptText(text: string, context?: TranscriptHintContext): string {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeTranscriptLine(line, context))
    .filter(Boolean)
    .join('\n');
}
