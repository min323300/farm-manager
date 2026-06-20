/****************************************************************
 * 농장 관리 프로그램 - Google Apps Script 백엔드
 * --------------------------------------------------------------
 * 역할: 웹페이지(GitHub Pages)의 요청을 받아 Google Sheets에
 *       데이터를 저장하고 조회한다.
 *
 * 배포 방법은 README.md 의 "3. 백엔드(GAS) 설정"을 참고.
 ****************************************************************/

/** 시트 구조 정의 (시트별 컬럼 순서) ------------------------- */
const SHEETS = {
  worklog: {
    name: '작업일지',
    cols: ['id', '등록시각', '날짜', '필지', '작물', '작업종류', '작업자', '작업시간', '특이사항'],
  },
  pesticide: {
    name: '농약관리',
    cols: ['id', '등록시각', '사용일', '농약명', '사용량', '희석배수', '사용구역', '작업자', '특이사항'],
  },
  fertilizer: {
    name: '비료관리',
    cols: ['id', '등록시각', '사용일', '비료명', '사용량', '사용구역', '작업자', '특이사항'],
  },
  harvest: {
    name: '수확관리',
    cols: ['id', '등록시각', '수확일', '품목', '수확량', '단위', '등급', '판매처', '판매금액'],
  },
  cost: {
    name: '비용관리',
    cols: ['id', '등록시각', '날짜', '비용구분', '금액', '내용', '비고'],
  },
};

/** 공통: JSON 응답 생성 ------------------------------------- */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 공통: 토큰 검증 ----------------------------------------- */
function checkToken(token) {
  const saved = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  // 토큰을 설정하지 않았다면(빈 값) 검증을 건너뛴다.
  if (!saved) return true;
  return token === saved;
}

/** 공통: 시트 가져오기(없으면 생성 + 헤더 작성) -------------- */
function getSheet(key) {
  const def = SHEETS[key];
  if (!def) throw new Error('알 수 없는 시트: ' + key);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(def.name);
  if (!sheet) {
    sheet = ss.insertSheet(def.name);
    sheet.appendRow(def.cols);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(def.cols);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 전체 시트 초기화 --------------------------------------- */
function initAllSheets() {
  Object.keys(SHEETS).forEach(getSheet);
}

/** 시트의 모든 행을 객체 배열로 읽기 ----------------------- */
function readRows(key) {
  const def = SHEETS[key];
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, def.cols.length).getValues();
  return values.map(function (row) {
    const obj = {};
    def.cols.forEach(function (col, i) {
      let v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[col] = v;
    });
    return obj;
  });
}

/** 한 건 추가 -------------------------------------------- */
function addRecord(key, record) {
  const def = SHEETS[key];
  const sheet = getSheet(key);
  if (!record.id) record.id = String(Date.now()) + Math.floor(Math.random() * 1000);
  if (!record['등록시각']) {
    record['등록시각'] = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  const row = def.cols.map(function (col) {
    return record[col] !== undefined && record[col] !== null ? record[col] : '';
  });
  sheet.appendRow(row);
  return record;
}

/** 한 건 삭제(id 기준) ----------------------------------- */
function deleteRecord(key, id) {
  const def = SHEETS[key];
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

/** GET 요청 처리: ping / init / list / listAll ------------- */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!checkToken(p.token)) return jsonOut({ ok: false, error: '인증 실패: 토큰이 일치하지 않습니다.' });

    const action = p.action || 'ping';

    if (action === 'ping') {
      return jsonOut({ ok: true, message: '연결 성공', version: '1.0' });
    }
    if (action === 'init') {
      initAllSheets();
      return jsonOut({ ok: true, message: '시트 초기화 완료' });
    }
    if (action === 'list') {
      if (!SHEETS[p.sheet]) return jsonOut({ ok: false, error: '잘못된 시트 이름' });
      return jsonOut({ ok: true, rows: readRows(p.sheet) });
    }
    if (action === 'listAll') {
      const data = {};
      Object.keys(SHEETS).forEach(function (k) { data[k] = readRows(k); });
      return jsonOut({ ok: true, data: data });
    }
    return jsonOut({ ok: false, error: '알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** POST 요청 처리: add / delete --------------------------- */
function doPost(e) {
  try {
    let body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    if (!checkToken(body.token)) return jsonOut({ ok: false, error: '인증 실패: 토큰이 일치하지 않습니다.' });

    const action = body.action;

    if (action === 'add') {
      if (!SHEETS[body.sheet]) return jsonOut({ ok: false, error: '잘못된 시트 이름' });
      const saved = addRecord(body.sheet, body.record || {});
      return jsonOut({ ok: true, record: saved });
    }
    if (action === 'delete') {
      if (!SHEETS[body.sheet]) return jsonOut({ ok: false, error: '잘못된 시트 이름' });
      const done = deleteRecord(body.sheet, body.id);
      return jsonOut({ ok: done, message: done ? '삭제 완료' : '대상을 찾지 못함' });
    }
    return jsonOut({ ok: false, error: '알 수 없는 action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/****************************************************************
 * (선택) 스프레드시트 메뉴에서 직접 초기화 / 토큰 설정
 ****************************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('농장관리')
    .addItem('시트 초기화', 'initAllSheets')
    .addItem('API 토큰 설정', 'promptSetToken')
    .addToMenu();
}

function promptSetToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('API 토큰 설정', '웹앱에서 사용할 토큰을 입력하세요(빈 값이면 인증 없음):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('API_TOKEN', res.getResponseText().trim());
    ui.alert('저장되었습니다.');
  }
}
