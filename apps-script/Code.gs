/**
 * 세금계산서 취소/정산 CS 진단 도구 — 공용 기록 저장소 (Google Sheets)
 *
 * 이 파일을 구글 시트의 [확장 프로그램 > Apps Script]에 붙여 넣고
 * 웹 앱으로 배포하면, 도구(index.html)가 팀 전체 응대 기록을 이 시트에 쌓습니다.
 * 설정 방법은 저장소의 "구글시트_연동_설정_안내.md"를 참고하세요.
 *
 * 요청 형식
 *  - GET  ?action=list                      → { ok:true, rows:[...] } (최신순, 최대 5000건)
 *  - POST {"action":"insert","row":{...}}  → { ok:true, id:"..." }
 *  - POST {"action":"delete","id":"..."}   → { ok:true, deleted:true|false }
 *  POST 본문은 text/plain 으로 보냅니다 (브라우저 CORS 사전 요청을 피하기 위함).
 */

const SHEET_NAME = 'cs_logs';
const HEADERS = ['id', 'ts', 'time', 'mode', 'case_label', 'situation', 'escalate', 'generated'];
const LIST_LIMIT = 5000;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 시트 수식으로 해석되지 않도록 텍스트를 정리합니다.
function text_(v) {
  let s = (v == null ? '' : String(v)).slice(0, 300);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action !== 'list') return json_({ ok: false, error: 'unknown action' });
    const values = sheet_().getDataRange().getValues();
    const header = values.shift() || HEADERS;
    const rows = values
      .filter(function (r) { return r[0] !== ''; })
      .map(function (r) {
        const o = {};
        header.forEach(function (h, i) { o[h] = r[i]; });
        o.ts = Number(o.ts);
        o.escalate = o.escalate === true || o.escalate === 'TRUE';
        o.generated = o.generated === true || o.generated === 'TRUE';
        return o;
      })
      .sort(function (a, b) { return b.ts - a.ts; })
      .slice(0, LIST_LIMIT);
    return json_({ ok: true, rows: rows });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sh = sheet_();

    if (body.action === 'insert') {
      const r = body.row || {};
      const id = Utilities.getUuid();
      const ts = Date.now();
      sh.appendRow([
        id, ts, new Date(ts),
        text_(r.mode), text_(r.case_label), text_(r.situation),
        !!r.escalate, !!r.generated
      ]);
      return json_({ ok: true, id: id });
    }

    if (body.action === 'delete') {
      const id = String(body.id || '');
      if (!id) return json_({ ok: false, error: 'id required' });
      const last = sh.getLastRow();
      if (last >= 2) {
        const ids = sh.getRange(2, 1, last - 1, 1).getValues();
        for (let i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0]) === id) {
            sh.deleteRow(i + 2);
            return json_({ ok: true, deleted: true });
          }
        }
      }
      return json_({ ok: true, deleted: false });
    }

    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
