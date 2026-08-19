// 北京时间（UTC+8，无夏令时）日期/时间工具
// 不依赖进程时区（本地 Windows / Docker UTC 均正确），统一按北京时区计算
export function getBeijingParts(d: Date = new Date()) {
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth() + 1,
    date: bj.getUTCDate(),
    dayOfWeek: bj.getUTCDay() === 0 ? 7 : bj.getUTCDay(), // 周一=1 … 周日=7
    hhmm: `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`,
    dateStr: `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`,
  };
}
