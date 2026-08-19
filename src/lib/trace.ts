const TRACE_HEADER = 'x-hyzs-trace';
const QUERY_KEY = '_t';

function rand(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function newTraceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${rand()}`;
}

export function getTraceFromRequest(request: Request, prefix: string): string {
  const fromHeader = request.headers.get(TRACE_HEADER);
  if (fromHeader) return fromHeader;
  try {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get(QUERY_KEY);
    if (fromQuery) return fromQuery;
  } catch {
    /* ignore */
  }
  return newTraceId(prefix);
}

export function appendTraceToUrl(url: string, traceId: string): string {
  if (!traceId) return url;
  try {
    const u = new URL(url);
    if (u.searchParams.get(QUERY_KEY) === traceId) return url;
    u.searchParams.set(QUERY_KEY, traceId);
    return u.toString();
  } catch {
    return url;
  }
}
