// Vercel Serverless Function probe — verifies whether ITS CCTV API
// (openapi.its.go.kr:9443) is reachable from Vercel's egress, vs the
// GCP Cloud Functions asia-northeast3 egress that was getting timed
// out by the agency's TLS stack. No secrets, no state — just round-trip
// the upstream call and report timing + size so we can decide whether
// to migrate nodeMatcherBatch off Firebase entirely.
//
// Usage:
//   GET /api/cctv-probe?minX=127.02&maxX=127.12&minY=37.38&maxY=37.51
//
// The ITS_API_KEY is read from Vercel env vars (Settings → Environment
// Variables). Defaults to a small bbox around 판교 if no params given.

export const config = {
  // Match the Cloud Function region intent (Seoul) when possible.
  // Works on Hobby for single-region; harmless fallback to iad1 otherwise.
  regions: ['icn1'],
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  const apiKey = (process.env.ITS_API_KEY ?? '').trim();
  if (!apiKey) {
    res.status(500).json({ error: 'ITS_API_KEY env var not set on this deployment' });
    return;
  }

  const minX = req.query?.minX ?? '127.02';
  const maxX = req.query?.maxX ?? '127.12';
  const minY = req.query?.minY ?? '37.38';
  const maxY = req.query?.maxY ?? '37.51';
  const roadType = (req.query?.type as string) ?? 'ex';

  const url = new URL('https://openapi.its.go.kr:9443/cctvInfo');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('type', roadType);
  url.searchParams.set('cctvType', '3');
  url.searchParams.set('minX', String(minX));
  url.searchParams.set('maxX', String(maxX));
  url.searchParams.set('minY', String(minY));
  url.searchParams.set('maxY', String(maxY));
  url.searchParams.set('getType', 'json');

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    const elapsed = Date.now() - started;
    const text = await upstream.text();
    const len = text.length;
    let cctvCount: number | string = 'unknown';
    try {
      const json = JSON.parse(text);
      const items = json?.response?.data ?? json?.data ?? [];
      cctvCount = Array.isArray(items) ? items.length : 'not-array';
    } catch {
      cctvCount = 'not-json';
    }

    res.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      elapsedMs: elapsed,
      bodyLength: len,
      cctvCount,
      preview: text.slice(0, 200),
      region: process.env.VERCEL_REGION ?? 'unknown',
    });
  } catch (err: any) {
    const elapsed = Date.now() - started;
    res.status(502).json({
      ok: false,
      elapsedMs: elapsed,
      error: err?.name ?? 'Error',
      message: err?.message ?? String(err),
      region: process.env.VERCEL_REGION ?? 'unknown',
    });
  }
}
