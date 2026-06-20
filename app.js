/* ===== 농장 관리 - app.js ===== */
(function () {
  'use strict';

  /* ---------- 시트 메타 ---------- */
  const SHEETS = {
    worklog:    { label: '작업일지', dateKey: '날짜',   amountKey: null },
    pesticide:  { label: '농약',     dateKey: '사용일', amountKey: null },
    fertilizer: { label: '비료',     dateKey: '사용일', amountKey: null },
    harvest:    { label: '수확',     dateKey: '수확일', amountKey: '판매금액' },
    cost:       { label: '비용',     dateKey: '날짜',   amountKey: '금액' },
  };
  const SHEET_ORDER = ['worklog', 'pesticide', 'fertilizer', 'harvest', 'cost'];
  const LS_CFG = 'farm_cfg';
  const LS_DATA = 'farm_data';
  const LS_AC = 'farm_autocomplete';

  /* ---------- 설정 ---------- */
  let cfg = loadJSON(LS_CFG, { url: '', token: '', farm: '우리 농장' });
  const isCloud = () => !!cfg.url;

  /* ---------- 유틸 ---------- */
  function loadJSON(key, fallback) {
    try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key) || '{}')); }
    catch (e) { return fallback; }
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function todayStr() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function monthStr() { return todayStr().slice(0, 7); }
  function num(v) {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function won(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------- 토스트 ---------- */
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast is-show' + (isErr ? ' is-err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  /* =========================================================
   *  데이터 계층 (클라우드=GAS / 로컬=localStorage 자동 전환)
   * ========================================================= */
  const Store = {
    localAll() { return loadJSON(LS_DATA, {}); },
    localSave(all) { localStorage.setItem(LS_DATA, JSON.stringify(all)); },

    async add(sheet, record) {
      record.id = String(Date.now()) + Math.floor(Math.random() * 1000);
      record['등록시각'] = new Date().toISOString().slice(0, 19).replace('T', ' ');
      if (isCloud()) {
        const res = await api('POST', { action: 'add', sheet, record });
        if (!res.ok) throw new Error(res.error || '저장 실패');
        return res.record;
      }
      const all = this.localAll();
      (all[sheet] = all[sheet] || []).push(record);
      this.localSave(all);
      return record;
    },

    async remove(sheet, id) {
      if (isCloud()) {
        const res = await api('POST', { action: 'delete', sheet, id });
        if (!res.ok) throw new Error(res.error || '삭제 실패');
        return;
      }
      const all = this.localAll();
      all[sheet] = (all[sheet] || []).filter((r) => String(r.id) !== String(id));
      this.localSave(all);
    },

    async listAll() {
      if (isCloud()) {
        const res = await api('GET', { action: 'listAll' });
        if (!res.ok) throw new Error(res.error || '불러오기 실패');
        return res.data || {};
      }
      return this.localAll();
    },
  };

  /* ---------- GAS 통신 ----------
     - 단순 요청(text/plain)으로 CORS 프리플라이트를 피한다. */
  async function api(method, payload) {
    const base = cfg.url;
    if (method === 'GET') {
      const qs = new URLSearchParams(Object.assign({ token: cfg.token || '' }, payload)).toString();
      const r = await fetch(base + '?' + qs, { method: 'GET' });
      return r.json();
    }
    const body = JSON.stringify(Object.assign({ token: cfg.token || '' }, payload));
    const r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
    });
    return r.json();
  }

  /* =========================================================
   *  자동완성(이전 입력값 기억)
   * ========================================================= */
  const AC_FIELDS = {
    '필지': 'dl-필지', '작물': 'dl-작물', '작업자': 'dl-작업자',
    '농약명': 'dl-농약명', '비료명': 'dl-비료명', '품목': 'dl-품목', '판매처': 'dl-판매처',
  };
  function loadAC() { try { return JSON.parse(localStorage.getItem(LS_AC) || '{}'); } catch (e) { return {}; } }
  function rememberAC(record) {
    const ac = loadAC();
    Object.keys(AC_FIELDS).forEach((f) => {
      // '사용구역'도 필지 목록에 합친다
      const val = record[f] || (f === '필지' ? record['사용구역'] : '');
      if (val) { ac[f] = ac[f] || []; if (ac[f].indexOf(val) === -1) ac[f].unshift(val); ac[f] = ac[f].slice(0, 30); }
    });
    localStorage.setItem(LS_AC, JSON.stringify(ac));
    renderAC();
  }
  function renderAC() {
    const ac = loadAC();
    Object.keys(AC_FIELDS).forEach((f) => {
      const dl = document.getElementById(AC_FIELDS[f]);
      if (!dl) return;
      dl.innerHTML = (ac[f] || []).map((v) => '<option value="' + escapeHtml(v) + '">').join('');
    });
  }

  /* =========================================================
   *  화면 전환
   * ========================================================= */
  const ROOT_VIEWS = ['home', 'stats', 'settings'];
  function showView(name) {
    $$('.view').forEach((v) => v.classList.remove('view--active'));
    const el = document.getElementById('view-' + name);
    if (el) el.classList.add('view--active');
    // 상단 back 버튼
    $('#backBtn').hidden = ROOT_VIEWS.indexOf(name) !== -1;
    // 탭 활성화
    $$('.tab').forEach((t) => t.classList.toggle('tab--active', t.dataset.go === name));
    window.scrollTo(0, 0);

    if (name === 'home') refreshHome();
    if (name === 'stats') renderStats();
    if (SHEETS[name]) refreshList(name);
  }

  /* =========================================================
   *  칩(선택 버튼) 생성
   * ========================================================= */
  function buildChips() {
    $$('.chips').forEach((box) => {
      const items = (box.dataset.items || '').split(',').filter(Boolean);
      const hidden = box.parentElement.querySelector('input[type="hidden"]');
      box.innerHTML = items.map((it) =>
        '<button type="button" class="chip" data-val="' + escapeHtml(it) + '">' + escapeHtml(it) + '</button>').join('');
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        const on = btn.classList.contains('is-on');
        $$('.chip', box).forEach((c) => c.classList.remove('is-on'));
        if (!on) { btn.classList.add('is-on'); hidden.value = btn.dataset.val; }
        else { hidden.value = ''; }
      });
    });
  }
  function resetChips(form) {
    $$('.chip', form).forEach((c) => c.classList.remove('is-on'));
  }

  /* =========================================================
   *  폼 저장
   * ========================================================= */
  function bindForms() {
    $$('.form').forEach((form) => {
      const sheet = form.dataset.sheet;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const record = {};
        $$('input, textarea', form).forEach((inp) => {
          if (inp.name) record[inp.name] = (inp.value || '').trim();
        });
        const dateKey = SHEETS[sheet].dateKey;
        if (!record[dateKey]) { toast('날짜를 입력하세요.', true); return; }

        const btn = $('.save', form);
        btn.disabled = true; const orig = btn.textContent; btn.textContent = '저장 중…';
        try {
          await Store.add(sheet, record);
          rememberAC(record);
          toast(SHEETS[sheet].label + ' 저장 완료');
          // 폼 초기화(날짜는 유지)
          const keepDate = record[dateKey];
          form.reset(); resetChips(form);
          form.querySelector('[name="' + dateKey + '"]').value = keepDate;
          await refreshList(sheet);
        } catch (err) {
          toast('저장 실패: ' + err.message, true);
        } finally {
          btn.disabled = false; btn.textContent = orig;
        }
      });
    });
  }

  /* =========================================================
   *  목록 렌더링
   * ========================================================= */
  function recLine(sheet, r) {
    let title = '', sub = '', tag = '';
    if (sheet === 'worklog') {
      tag = r['작업종류'] || '작업';
      title = [r['필지'], r['작물']].filter(Boolean).join(' · ') || '작업';
      sub = [r['작업자'] && '작업자 ' + r['작업자'], r['작업시간'], r['특이사항']].filter(Boolean).join(' / ');
    } else if (sheet === 'pesticide') {
      title = r['농약명'] || '농약';
      sub = [r['사용량'], r['희석배수'], r['사용구역'], r['작업자']].filter(Boolean).join(' · ');
    } else if (sheet === 'fertilizer') {
      title = r['비료명'] || '비료';
      sub = [r['사용량'], r['사용구역'], r['작업자']].filter(Boolean).join(' · ');
    } else if (sheet === 'harvest') {
      title = (r['품목'] || '수확') + ' ' + (r['수확량'] || '') + (r['단위'] || '');
      if (r['등급']) tag = r['등급'] + '등급';
      sub = [r['판매처'], r['판매금액'] && won(num(r['판매금액'])) + '원'].filter(Boolean).join(' · ');
    } else if (sheet === 'cost') {
      tag = r['비용구분'] || '비용';
      title = won(num(r['금액'])) + '원';
      sub = [r['내용'], r['비고']].filter(Boolean).join(' / ');
    }
    const date = r[SHEETS[sheet].dateKey] || '';
    return (
      '<li class="rec rec--' + sheet + '">' +
        '<div class="rec__body">' +
          '<div class="rec__top">' +
            '<span class="rec__title">' + (tag ? '<span class="rec__tag">' + escapeHtml(tag) + '</span>' : '') + escapeHtml(title) + '</span>' +
            '<span class="rec__date">' + escapeHtml(date) + '</span>' +
          '</div>' +
          (sub ? '<div class="rec__sub">' + escapeHtml(sub) + '</div>' : '') +
        '</div>' +
        '<button class="rec__del" data-sheet="' + sheet + '" data-id="' + escapeHtml(r.id) + '" aria-label="삭제">🗑</button>' +
      '</li>'
    );
  }

  function sortByDateDesc(rows, key) {
    return rows.slice().sort((a, b) => {
      const da = (a[key] || '') + (a['등록시각'] || '');
      const db = (b[key] || '') + (b['등록시각'] || '');
      return db.localeCompare(da);
    });
  }

  async function refreshList(sheet) {
    const ul = $('[data-list="' + sheet + '"]');
    if (!ul) return;
    ul.innerHTML = '<li class="feed__empty">불러오는 중…</li>';
    try {
      const all = await Store.listAll();
      const rows = sortByDateDesc(all[sheet] || [], SHEETS[sheet].dateKey).slice(0, 20);
      ul.innerHTML = rows.length
        ? rows.map((r) => recLine(sheet, r)).join('')
        : '<li class="feed__empty">아직 기록이 없습니다.</li>';
    } catch (err) {
      ul.innerHTML = '<li class="feed__empty">불러오기 실패: ' + escapeHtml(err.message) + '</li>';
    }
  }

  /* ---------- 삭제(이벤트 위임) ---------- */
  document.addEventListener('click', async (e) => {
    const del = e.target.closest('.rec__del');
    if (!del) return;
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await Store.remove(del.dataset.sheet, del.dataset.id);
      toast('삭제했습니다.');
      await refreshList(del.dataset.sheet);
      if ($('#view-home').classList.contains('view--active')) refreshHome();
    } catch (err) { toast('삭제 실패: ' + err.message, true); }
  });

  /* =========================================================
   *  홈 화면
   * ========================================================= */
  async function refreshHome() {
    $('#todayDate').textContent = todayStr();
    $('#setupBanner').hidden = isCloud();
    let all = {};
    try { all = await Store.listAll(); } catch (err) { toast('불러오기 실패: ' + err.message, true); }

    const t = todayStr(), m = monthStr();
    const work = all.worklog || [], harv = all.harvest || [], cost = all.cost || [];
    $('#sumWorkToday').textContent = work.filter((r) => r['날짜'] === t).length;
    $('#sumHarvestMonth').textContent = harv.filter((r) => (r['수확일'] || '').slice(0, 7) === m).length;
    $('#sumCostMonth').textContent = won(cost.filter((r) => (r['날짜'] || '').slice(0, 7) === m)
      .reduce((s, r) => s + num(r['금액']), 0));

    // 최근 전체 피드(모든 시트 합쳐 최신순 8개)
    const merged = [];
    SHEET_ORDER.forEach((s) => (all[s] || []).forEach((r) => merged.push({ sheet: s, r })));
    merged.sort((a, b) => ((b.r['등록시각'] || '')).localeCompare(a.r['등록시각'] || ''));
    const feed = $('#homeFeed');
    feed.innerHTML = merged.length
      ? merged.slice(0, 8).map((x) => recLine(x.sheet, x.r)).join('')
      : '<li class="feed__empty">아직 기록이 없습니다. 위 버튼으로 기록을 시작하세요.</li>';
  }

  /* =========================================================
   *  통계
   * ========================================================= */
  async function renderStats() {
    const monthInput = $('#statMonth');
    if (!monthInput.value) monthInput.value = monthStr();
    const m = monthInput.value;

    let all = {};
    try { all = await Store.listAll(); } catch (err) { toast('불러오기 실패: ' + err.message, true); return; }
    const inMonth = (rows, key) => (rows || []).filter((r) => (r[key] || '').slice(0, 7) === m);

    const work = inMonth(all.worklog, '날짜');
    const pest = inMonth(all.pesticide, '사용일');
    const fert = inMonth(all.fertilizer, '사용일');
    const harv = inMonth(all.harvest, '수확일');
    const cost = inMonth(all.cost, '날짜');

    const revenue = harv.reduce((s, r) => s + num(r['판매금액']), 0);
    const expense = cost.reduce((s, r) => s + num(r['금액']), 0);
    const profit = revenue - expense;

    $('#statCards').innerHTML = [
      card('작업 횟수', work.length + '회'),
      card('농약/비료', pest.length + ' / ' + fert.length + '건'),
      card('수확 건수', harv.length + '건'),
      card('매출', won(revenue) + '원', 'rev'),
      card('비용', won(expense) + '원', 'cost'),
      card('순이익', won(profit) + '원', 'profit' + (profit < 0 ? ' is-neg' : '')),
    ].join('');

    // 비용 구분별 막대
    renderBars('#costBars', groupSum(cost, '비용구분', (r) => num(r['금액'])), (v) => won(v) + '원', 'cost');
    // 품목별 수확량 막대
    renderBars('#harvBars', groupSum(harv, '품목', (r) => num(r['수확량'])), (v) => won(v), '');
  }
  function card(label, val, mod) {
    return '<div class="scard' + (mod ? ' scard--' + mod : '') + '"><b>' + escapeHtml(val) + '</b><span>' + escapeHtml(label) + '</span></div>';
  }
  function groupSum(rows, key, valFn) {
    const map = {};
    rows.forEach((r) => { const k = r[key] || '기타'; map[k] = (map[k] || 0) + valFn(r); });
    return Object.keys(map).map((k) => ({ name: k, val: map[k] })).sort((a, b) => b.val - a.val);
  }
  function renderBars(sel, data, fmt, mod) {
    const ul = $(sel);
    ul.className = 'bars' + (mod ? ' bars--' + mod : '');
    if (!data.length) { ul.innerHTML = '<li class="feed__empty">해당 월 데이터 없음</li>'; return; }
    const max = Math.max.apply(null, data.map((d) => d.val)) || 1;
    ul.innerHTML = data.map((d) =>
      '<li class="bar__row">' +
        '<span class="bar__name">' + escapeHtml(d.name) + '</span>' +
        '<span class="bar__track"><span class="bar__fill" style="width:' + Math.max(4, (d.val / max) * 100) + '%"></span></span>' +
        '<span class="bar__val">' + escapeHtml(fmt(d.val)) + '</span>' +
      '</li>').join('');
  }

  /* =========================================================
   *  엑셀 다운로드
   * ========================================================= */
  const EXCEL_COLS = {
    worklog: ['날짜', '필지', '작물', '작업종류', '작업자', '작업시간', '특이사항', '등록시각'],
    pesticide: ['사용일', '농약명', '사용량', '희석배수', '사용구역', '작업자', '특이사항', '등록시각'],
    fertilizer: ['사용일', '비료명', '사용량', '사용구역', '작업자', '특이사항', '등록시각'],
    harvest: ['수확일', '품목', '수확량', '단위', '등급', '판매처', '판매금액', '등록시각'],
    cost: ['날짜', '비용구분', '금액', '내용', '비고', '등록시각'],
  };
  async function downloadExcel() {
    toast('엑셀 파일 준비 중…');
    let all = {};
    try { all = await Store.listAll(); } catch (err) { toast('불러오기 실패: ' + err.message, true); return; }
    const wb = XLSX.utils.book_new();
    SHEET_ORDER.forEach((s) => {
      const cols = EXCEL_COLS[s];
      const rows = sortByDateDesc(all[s] || [], SHEETS[s].dateKey)
        .map((r) => cols.map((c) => r[c] != null ? r[c] : ''));
      const ws = XLSX.utils.aoa_to_sheet([cols].concat(rows));
      XLSX.utils.book_append_sheet(wb, ws, SHEETS[s].label);
    });
    const name = (cfg.farm || '농장') + '_기록_' + todayStr() + '.xlsx';
    XLSX.writeFile(wb, name);
  }

  /* =========================================================
   *  약/비료 이름별 값 기억 (레시피)
   * ========================================================= */
  const LS_RECIPE = 'farm_recipe';
  function loadRecipes() { try { return JSON.parse(localStorage.getItem(LS_RECIPE) || '{}'); } catch (e) { return {}; } }
  function saveRecipe(kind, name, data) {
    name = (name || '').trim();
    if (!name) return;
    // 값이 하나라도 있을 때만 저장
    const hasVal = Object.keys(data).some((k) => data[k] !== '' && data[k] != null);
    if (!hasVal) return;
    const all = loadRecipes();
    all[kind] = all[kind] || {};
    all[kind][name] = Object.assign(all[kind][name] || {}, data);
    localStorage.setItem(LS_RECIPE, JSON.stringify(all));
  }
  function getRecipe(kind, name) {
    const all = loadRecipes();
    return (all[kind] && all[kind][(name || '').trim()]) || null;
  }

  /* =========================================================
   *  농약 사용량 계산기
   * ========================================================= */
  function fmtMl(ml) {
    if (!ml) return '0ml';
    if (ml >= 1000) return (Math.round(ml / 10) / 100).toLocaleString('ko-KR') + 'L';
    return (Math.round(ml * 10) / 10).toLocaleString('ko-KR') + 'ml';
  }
  function fmtL(l) { return (Math.round(l * 10) / 10).toLocaleString('ko-KR') + 'L'; }

  let pMode = 'dil';
  function calcCompute() {
    const out = $('#cOut');
    const area = num($('#cArea').value);
    if (!area) { out.innerHTML = '면적과 사용 기준을 넣으면 자동 계산됩니다.'; return null; }

    if (pMode === 'gran') {
      const perG = num($('#cPerG').value);
      if (!perG) { out.innerHTML = '평당 사용량(g)을 넣으면 계산됩니다.'; return null; }
      const totalG = area * perG;
      out.innerHTML = '총 농약량 <b>' + fmtKg(totalG) + '</b>' +
        '<br><span class="muted">' + area.toLocaleString('ko-KR') + '평 × 평당 ' + perG + 'g</span>';
      return { text: fmtKg(totalG) };
    }
    // 희석 방식
    const per = num($('#cPer').value), tank = num($('#cTank').value), dil = num($('#pDilution').value);
    if (!per || !dil) { out.innerHTML = '평당 물량(L)과 희석배수를 넣으면 계산됩니다.'; return null; }
    const water = area * per;
    const pesticideMl = (water / dil) * 1000;
    let html = '필요한 물 <b>' + fmtL(water) + '</b> · 농약 총 <b>' + fmtMl(pesticideMl) + '</b>';
    const extra = [];
    if (tank) {
      extra.push(tank + 'L 약통당 ' + fmtMl((tank / dil) * 1000));
      extra.push('약 ' + (Math.round((water / tank) * 10) / 10).toLocaleString('ko-KR') + '통 분량');
    }
    if (extra.length) html += '<br><span class="muted">' + extra.join(' · ') + '</span>';
    out.innerHTML = html;
    return { text: fmtMl(pesticideMl) };
  }

  function setPestMode(mode) {
    pMode = mode;
    const modeBox = $('#pMode');
    if (modeBox) $$('.calc-mode', modeBox).forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
    $$('[data-pmode-box]').forEach((box) => { box.hidden = box.dataset.pmodeBox !== mode; });
    calcCompute();
  }

  function setupCalculator() {
    const modeBox = $('#pMode');
    if (!modeBox) return;
    modeBox.addEventListener('click', (e) => {
      const btn = e.target.closest('.calc-mode'); if (!btn) return;
      setPestMode(btn.dataset.mode);
    });
    ['#cArea', '#cPer', '#cTank', '#pDilution', '#cPerG'].forEach((s) => {
      const el = $(s); if (el) el.addEventListener('input', calcCompute);
    });
    const apply = $('#cApply');
    if (apply) apply.addEventListener('click', () => {
      const r = calcCompute();
      if (!r) { toast('면적과 사용 기준을 먼저 입력하세요.', true); return; }
      $('#pAmount').value = r.text;
      toast('권장량을 사용량에 입력했습니다. 실제 양으로 수정 가능합니다.');
    });
    // 저장 후 폼 초기화 시 계산 결과도 비움
    const pForm = document.querySelector('.form[data-sheet="pesticide"]');
    if (pForm) pForm.addEventListener('reset', () => { setTimeout(calcCompute, 0); });

    // 농약명 선택 시, 기억해둔 값 자동 채우기
    const pName = $('#pName');
    if (pName) pName.addEventListener('change', () => {
      const r = getRecipe('pesticide', pName.value);
      if (!r) return;
      if (r.mode) setPestMode(r.mode);
      if (r.dil) $('#pDilution').value = r.dil;
      if (r.area) $('#cArea').value = r.area;
      if (r.per) $('#cPer').value = r.per;
      if (r.tank) $('#cTank').value = r.tank;
      if (r.perG) $('#cPerG').value = r.perG;
      calcCompute();
      toast(pName.value.trim() + ' 저장값을 불러왔습니다.');
    });
    // 저장할 때 이 농약의 값 기억
    if (pForm) pForm.addEventListener('submit', () => {
      saveRecipe('pesticide', $('#pName').value, {
        mode: pMode,
        dil: $('#pDilution').value.trim(),
        area: $('#cArea').value.trim(),
        per: $('#cPer').value.trim(),
        tank: $('#cTank').value.trim(),
        perG: $('#cPerG').value.trim(),
      });
    });
  }

  /* =========================================================
   *  비료 사용량 계산기 (면적당 / 희석배수 전환)
   * ========================================================= */
  function fmtKg(g) {
    if (!g) return '0g';
    if (g >= 1000) return (Math.round(g / 10) / 100).toLocaleString('ko-KR') + 'kg';
    return (Math.round(g * 10) / 10).toLocaleString('ko-KR') + 'g';
  }
  let fMode = 'area';
  function fCompute() {
    const out = $('#fOut');
    const area = num($('#fArea').value);
    if (!area) { out.innerHTML = '면적과 사용 기준을 넣으면 자동 계산됩니다.'; return null; }

    if (fMode === 'area') {
      const perG = num($('#fPerG').value);
      if (!perG) { out.innerHTML = '평당 사용량(g)을 넣으면 계산됩니다.'; return null; }
      const totalG = area * perG;
      out.innerHTML = '총 비료량 <b>' + fmtKg(totalG) + '</b>' +
        '<br><span class="muted">' + area.toLocaleString('ko-KR') + '평 × 평당 ' + perG + 'g</span>';
      return { text: fmtKg(totalG) };
    }
    // 희석배수 방식
    const perL = num($('#fPerL').value), tank = num($('#fTank').value), dil = num($('#fDil').value);
    if (!perL || !dil) { out.innerHTML = '평당 물량(L)과 희석배수를 넣으면 계산됩니다.'; return null; }
    const water = area * perL;
    const fertMl = (water / dil) * 1000;
    let html = '필요한 물 <b>' + fmtL(water) + '</b> · 비료 총 <b>' + fmtMl(fertMl) + '</b>';
    const extra = [];
    if (tank) {
      extra.push(tank + 'L 약통당 ' + fmtMl((tank / dil) * 1000));
      extra.push('약 ' + (Math.round((water / tank) * 10) / 10).toLocaleString('ko-KR') + '통 분량');
    }
    if (extra.length) html += '<br><span class="muted">' + extra.join(' · ') + '</span>';
    out.innerHTML = html;
    return { text: fmtMl(fertMl) };
  }
  function setFertMode(mode) {
    fMode = mode;
    const modeBox = $('#fMode');
    if (modeBox) $$('.calc-mode', modeBox).forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
    $$('[data-mode-box]').forEach((box) => { box.hidden = box.dataset.modeBox !== mode; });
    fCompute();
  }
  function setupFertCalc() {
    const modeBox = $('#fMode');
    if (!modeBox) return;
    modeBox.addEventListener('click', (e) => {
      const btn = e.target.closest('.calc-mode'); if (!btn) return;
      setFertMode(btn.dataset.mode);
    });
    ['#fArea', '#fPerG', '#fPerL', '#fTank', '#fDil'].forEach((s) => {
      const el = $(s); if (el) el.addEventListener('input', fCompute);
    });
    const apply = $('#fApply');
    if (apply) apply.addEventListener('click', () => {
      const r = fCompute();
      if (!r) { toast('면적과 사용 기준을 먼저 입력하세요.', true); return; }
      $('#fAmount').value = r.text;
      toast('권장량을 사용량에 입력했습니다. 실제 양으로 수정 가능합니다.');
    });
    const fForm = document.querySelector('.form[data-sheet="fertilizer"]');
    if (fForm) fForm.addEventListener('reset', () => { setTimeout(fCompute, 0); });

    // 비료명 선택 시, 기억해둔 값 자동 채우기
    const fName = $('#fName');
    if (fName) fName.addEventListener('change', () => {
      const r = getRecipe('fertilizer', fName.value);
      if (!r) return;
      if (r.mode) setFertMode(r.mode);
      if (r.area) $('#fArea').value = r.area;
      if (r.perG) $('#fPerG').value = r.perG;
      if (r.perL) $('#fPerL').value = r.perL;
      if (r.tank) $('#fTank').value = r.tank;
      if (r.dil) $('#fDil').value = r.dil;
      fCompute();
      toast(fName.value.trim() + ' 저장값을 불러왔습니다.');
    });
    // 저장할 때 이 비료의 값 기억
    if (fForm) fForm.addEventListener('submit', () => {
      saveRecipe('fertilizer', $('#fName').value, {
        mode: fMode,
        area: $('#fArea').value.trim(),
        perG: $('#fPerG').value.trim(),
        perL: $('#fPerL').value.trim(),
        tank: $('#fTank').value.trim(),
        dil: $('#fDil').value.trim(),
      });
    });
  }

  /* =========================================================
   *  설정
   * ========================================================= */
  function fillSettings() {
    $('#cfgFarm').value = cfg.farm || '';
    $('#cfgUrl').value = cfg.url || '';
    $('#cfgToken').value = cfg.token || '';
  }
  function applyModeChip() {
    const chip = $('#modeChip');
    chip.textContent = isCloud() ? '구글시트' : '로컬';
    chip.classList.toggle('is-cloud', isCloud());
    $('#appTitle').textContent = cfg.farm || '우리 농장';
  }
  function saveConfig() {
    cfg.farm = $('#cfgFarm').value.trim() || '우리 농장';
    cfg.url = $('#cfgUrl').value.trim().replace(/\s+/g, '');
    cfg.token = $('#cfgToken').value.trim();
    localStorage.setItem(LS_CFG, JSON.stringify(cfg));
    applyModeChip();
    setMsg(isCloud() ? '저장됨 · 구글 시트 모드' : '저장됨 · 로컬 모드', 'ok');
    toast('설정을 저장했습니다.');
  }
  function setMsg(text, kind) {
    const el = $('#cfgMsg');
    el.textContent = text;
    el.className = 'cfg-msg' + (kind ? ' is-' + kind : '');
  }
  async function testConnection() {
    const url = $('#cfgUrl').value.trim();
    if (!url) { setMsg('웹앱 URL을 입력하세요.', 'err'); return; }
    setMsg('연결 확인 중…', '');
    try {
      const qs = new URLSearchParams({ action: 'ping', token: $('#cfgToken').value.trim() }).toString();
      const r = await fetch(url + '?' + qs);
      const j = await r.json();
      if (j.ok) setMsg('연결 성공 ✓ (' + (j.message || 'OK') + ')', 'ok');
      else setMsg('응답: ' + (j.error || '실패'), 'err');
    } catch (err) {
      setMsg('연결 실패: ' + err.message + ' (URL/배포 권한을 확인하세요)', 'err');
    }
  }
  async function initSheets() {
    const url = $('#cfgUrl').value.trim();
    if (!url) { setMsg('먼저 웹앱 URL을 입력하세요.', 'err'); return; }
    setMsg('시트 초기화 중…', '');
    try {
      const qs = new URLSearchParams({ action: 'init', token: $('#cfgToken').value.trim() }).toString();
      const r = await fetch(url + '?' + qs);
      const j = await r.json();
      setMsg(j.ok ? '시트 초기화 완료 ✓' : '실패: ' + (j.error || ''), j.ok ? 'ok' : 'err');
    } catch (err) { setMsg('실패: ' + err.message, 'err'); }
  }

  /* =========================================================
   *  초기화/이벤트 바인딩
   * ========================================================= */
  function init() {
    // 날짜 기본값
    $$('input[type="date"]').forEach((d) => { if (!d.value) d.value = todayStr(); });

    buildChips();
    bindForms();
    renderAC();
    applyModeChip();
    fillSettings();
    setupCalculator();
    setupFertCalc();
    setPestMode('dil');
    setFertMode('area');

    // 네비게이션 (data-go)
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { e.preventDefault(); showView(go.dataset.go); }
    });
    $('#backBtn').addEventListener('click', () => showView('home'));
    $('#tabExcel').addEventListener('click', downloadExcel);
    $('#btnExcel').addEventListener('click', downloadExcel);

    // 설정 버튼
    $('#btnSaveCfg').addEventListener('click', saveConfig);
    $('#btnTest').addEventListener('click', testConnection);
    $('#btnInit').addEventListener('click', initSheets);

    // 통계 월 변경
    $('#statMonth').addEventListener('change', renderStats);

    showView('home');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
