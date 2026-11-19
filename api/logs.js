// 세금계산서 취소/정산 CS 진단 도구 — 공용 기록 API (Vercel 서버 함수 + Neon Postgres)
//
// Vercel 대시보드에서 Neon(Postgres) 저장소를 이 프로젝트에 연결하면
// DATABASE_URL 환경변수가 자동으로 들어오고, 이 함수가 기록을 저장/조회합니다.
// 표(cs_logs)는 첫 요청 때 자동으로 만들어집니다.
//
//  GET    /api/logs            → { ok:true, rows:[...] }  (최신순, 최대 5000건)
//  POST   /api/logs  {row}     → { ok:true, id }
//  DELETE /api/logs?id=...     → { ok:true, deleted:true|false }
//  DB가 연결되지 않았으면 503 { ok:false, error:'not_configured' }

const { neon } = require('@neondatabase/serverless');

const LIST_LIMIT = 5000;
let ready = null;

function text(v) { return (v == null ? '' : String(v)).slice(0, 300); }

async function ensureTable(sql) {
  if (!ready) {
    ready = sql`CREATE TABLE IF NOT EXISTS cs_logs (
      id         BIGSERIAL PRIMARY KEY,
      ts         BIGINT      NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      mode       TEXT        NOT NULL,
      case_label TEXT,
      situation  TEXT,
      escalate   BOOLEAN     NOT NULL DEFAULT false,
      generated  BOOLEAN     NOT NULL DEFAULT false
    )`.catch(e => { ready = null; throw e; });
  }
  return ready;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return res.status(503).json({ ok: false, error: 'not_configured' });

  try {
    const sql = neon(url);
    await ensureTable(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id::text AS id, ts, mode, case_label, situation, escalate, generated
        FROM cs_logs ORDER BY ts DESC LIMIT ${LIST_LIMIT}`;
      return res.status(200).json({ ok: true, rows: rows.map(r => ({ ...r, ts: Number(r.ts) })) });
    }

    if (req.method === 'POST') {
      const r = (await readBody(req)).row || {};
      const mode = r.mode === 'test' ? 'test' : 'real';
      const [row] = await sql`
        INSERT INTO cs_logs (ts, mode, case_label, situation, escalate, generated)
        VALUES (${Date.now()}, ${mode}, ${text(r.case_label)}, ${text(r.situation)}, ${!!r.escalate}, ${!!r.generated})
        RETURNING id::text AS id`;
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (req.method === 'DELETE') {
      const id = String((req.query && req.query.id) || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'id required' });
      const del = await sql`DELETE FROM cs_logs WHERE id = ${id} RETURNING id`;
      return res.status(200).json({ ok: true, deleted: del.length > 0 });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'db_error' });
  }
};
