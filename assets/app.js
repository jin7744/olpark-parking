/* 올팍 주차예보 — 정적 웹(서버 없음). 데이터: web/data/*.json(파이프라인 생성) + 기관 실시간 주차 API(브라우저에서 직접 호출) */
'use strict';
const RT_URL = 'https://www.ksponco.or.kr/online/main/parkingorsApi.do?apiKey=PARKING21803504'; // 기관 누리집 공공데이터 개방목록 #64에 공개된 키
const CAP = 2200;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const VENUE_LOT = {
  'KSPO DOME': { lot: 'P5', cars: 176, gate: '북2문' },
  '티켓링크 라이브 아레나': { lot: 'P6', cars: 167, gate: '남2문' },
  '올림픽홀': { lot: 'P2·올림픽홀 지하', cars: 320, gate: '동2문' },
  '우리금융아트홀': { lot: 'P7', cars: 137, gate: '남2문' },
  'K-아트홀': { lot: 'P1', cars: 562, gate: '남2문·동2문' },
};
const S = { data: {}, sel: null };
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = (m) => { m = Math.round(m); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0'); };
const nf = (n) => Number(n).toLocaleString('ko-KR');
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dlabel = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
function level(pct) {
  if (pct >= 90) return ['만차', 'full'];
  if (pct >= 70) return ['혼잡', 'busy'];
  if (pct >= 50) return ['다소혼잡', 'mid'];
  return ['여유', 'ok'];
}

async function getJSON(p, optional) {
  try {
    const r = await fetch(p, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

/* ---------- 지금(실시간) ---------- */
async function loadLive() {
  const num = $('#liveNum'), lv = $('#liveLvl'), tm = $('#liveTime');
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(RT_URL, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(to);
    const j = await r.json();
    const v = Number(j[0].parking_sum);
    if (!Number.isFinite(v)) throw new Error('bad');
    const pct = Math.round((v / CAP) * 100);
    const [w, c] = level(pct);
    num.textContent = nf(v) + '대';
    lv.textContent = v > CAP ? `기준 대수 초과 · ${pct}%` : `${w} · ${pct}%`;
    lv.className = 'lvl ' + c;
    const now = new Date();
    tm.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 기준 · 기관 실시간 API${v > CAP ? ' · 2,200대는 기관 화면의 기준 대수' : ''}`;
  } catch (e) {
    num.textContent = '—';
    lv.textContent = '실시간 값을 받지 못함';
    lv.className = 'lvl err';
    tm.textContent = '기관 API가 응답하지 않습니다. 잠시 뒤 새로고침하세요.';
  }
}

/* ---------- 날짜 띠 ---------- */
function renderDatebar() {
  const bar = $('#datebar');
  const days = S.data.fc.days;
  bar.innerHTML = days.map((d) => {
    const dt = parseISO(d.date);
    const has = d.sessions.length || (d.unknown_time && d.unknown_time.length);
    const r = has ? (d.risk === '높음' ? 'h' : d.risk === '보통' ? 'm' : 'l') : 'l';
    const cls = dt.getDay() === 6 ? 'sat' : dt.getDay() === 0 ? 'sun' : '';
    const lab = has ? `, 대형 공연 있음${d.sessions.length ? '' : '(시각 미확인)'}, 만차 가능성 ${d.risk}` : ', 대형 공연 없음';
    return `<button class="dchip ${cls}" role="option" data-date="${d.date}" aria-selected="${d.date === S.sel}" aria-label="${dlabel(d.date)}${lab}">
      <span class="dw">${dt.getMonth() + 1}/${WD[dt.getDay()]}</span><span class="dd">${dt.getDate()}</span><span class="dr ${r}"></span></button>`;
  }).join('');
  bar.querySelectorAll('.dchip').forEach((b) => b.addEventListener('click', () => { S.sel = b.dataset.date; renderDatebar(); renderDay(); history.replaceState(null, '', '#' + S.sel); }));
  const cur = bar.querySelector('[aria-selected="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/* ---------- 그날 ---------- */
function titleOf(id) { const e = S.data.evById[id]; return e ? e.title : '(제목 없음)'; }

function timelineSVG(f) {
  const x0 = 10 * 60, x1 = 25 * 60, W = 760, L = 70, R = 14, top = 8;
  const X = (m) => L + ((m - x0) / (x1 - x0)) * (W - L - R);
  const rows = [];
  const ses = f.sessions.slice().sort((a, b) => hm(a.start) - hm(b.start));
  let y = top;
  const parts = [];
  // 시간 눈금
  const H = 34 + ses.length * 28 + 60;
  for (let h = 10; h <= 25; h++) {
    const xx = X(h * 60);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${top}" y2="${H - 22}" stroke="#e7eaf0"/>`);
    if (h % 2 === 0 || h === 25) parts.push(`<text x="${xx}" y="${H - 6}" font-size="13" text-anchor="middle" fill="#5b6474">${String(h % 24).padStart(2, '0')}시</text>`);
  }
  // 입차·출차 띠
  const band = (w, color, label) => {
    if (!w) return;
    let a = hm(w.start), b = hm(w.end);
    if (a < 600) a += 1440; if (b < a) b += 1440;
    parts.push(`<rect x="${X(a)}" y="${top}" width="${Math.max(2, X(b) - X(a))}" height="${H - 30 - top}" fill="${color}" opacity=".22"/>`);
    parts.push(`<text x="${(X(a) + X(b)) / 2}" y="${top + 12}" font-size="13" text-anchor="middle" fill="#333" font-weight="700">${label}</text>`);
  };
  band(f.entry_window, '#f4b740', '입차 몰림');
  band(f.exit_window, '#e0573a', '출차 몰림');
  y = top + 24;
  ses.forEach((s) => {
    let a = hm(s.start), b = hm(s.end); if (b < a) b += 1440;
    parts.push(`<text x="${L - 6}" y="${y + 16}" font-size="13" text-anchor="end" fill="#141820">${esc(s.venue.replace('티켓링크 라이브 아레나', '티켓링크').replace('KSPO DOME', 'DOME'))}</text>`);
    parts.push(`<rect x="${X(a)}" y="${y + 3}" width="${Math.max(2, X(b) - X(a))}" height="20" rx="4" fill="#8a97ad"/>`);
    parts.push(`<text x="${X(a) + 5}" y="${y + 18}" font-size="12.5" fill="#fff">${s.start}~${s.end}${s.duration_src !== '공지' ? '*' : ''}</text>`);
    y += 28;
  });
  // 정점 표시
  const mark = (w, color, txt) => {
    if (!w) return; let p = hm(w.peak); if (p < 600) p += 1440;
    parts.push(`<line x1="${X(p)}" x2="${X(p)}" y1="${y + 4}" y2="${y + 22}" stroke="${color}" stroke-width="3"/>`);
    parts.push(`<text x="${X(p)}" y="${y + 38}" font-size="13" text-anchor="middle" fill="${color}" font-weight="700">${txt} ${w.peak}</text>`);
  };
  mark(f.entry_window, '#a86f00', '입차 정점');
  mark(f.exit_window, '#b23a22', '출차 정점');
  return `<svg class="timeline" viewBox="0 0 ${W} ${H}" role="img" aria-label="공연 시각과 입차·출차 몰림 시간대">${parts.join('')}</svg>`;
}

function analogChart(f) {
  if (!f.analogs3 || !f.analogs3.length) return '';
  const jd = S.data.julyBy;
  const curves = f.analogs3.map((a) => {
    const d = jd[a.date]; const k = Math.round(a.shift_start / 5);
    return { date: a.date, c: d.occ5.map((_, i) => d.occ5[Math.min(Math.max(i - k, 0), 287)]) };
  });
  const i0 = 120, i1 = 288; // 10:00~24:00
  const W = 760, Hh = 240, L = 50, R = 10, T = 10, B = 28;
  let mx = 0; curves.forEach((c) => { for (let i = i0; i < i1; i++) mx = Math.max(mx, c.c[i]); });
  mx = Math.ceil(mx / 500) * 500 || 500;
  const X = (i) => L + ((i - i0) / (i1 - i0 - 1)) * (W - L - R);
  const Y = (v) => T + (1 - v / mx) * (Hh - T - B);
  const p = [];
  for (let v = 0; v <= mx; v += 500) p.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceff4"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#5b6474">${nf(v)}</text>`);
  for (let h = 10; h <= 24; h += 2) { const i = h * 12; p.push(`<text x="${X(Math.min(i, i1 - 1))}" y="${Hh - 6}" font-size="11" text-anchor="middle" fill="#5b6474">${String(h % 24).padStart(2, '0')}시</text>`); }
  // 범위
  let up = '', lo = '';
  for (let i = i0; i < i1; i++) {
    const vs = curves.map((c) => c.c[i]).sort((a, b) => a - b);
    up += `${i === i0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(vs[vs.length - 1]).toFixed(1)}`;
  }
  for (let i = i1 - 1; i >= i0; i--) { const vs = curves.map((c) => c.c[i]).sort((a, b) => a - b); lo += `L${X(i).toFixed(1)},${Y(vs[0]).toFixed(1)}`; }
  p.push(`<path d="${up}${lo}Z" fill="#1d3b6e" opacity=".10"/>`);
  const cols = ['#1d3b6e', '#6b84b3', '#a9b6cf'];
  curves.forEach((c, k) => {
    let d = '';
    for (let i = i0; i < i1; i++) d += `${i === i0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(c.c[i]).toFixed(1)}`;
    p.push(`<path d="${d}" fill="none" stroke="${cols[k]}" stroke-width="${k === 0 ? 2.2 : 1.4}"/>`);
  });
  const leg = curves.map((c, k) => `<span><i style="background:${cols[k]}"></i>${dlabel(c.date).replace(/^\d+월 /, '7월 ')}${f.analogs3[k].shift_start ? ` (${f.analogs3[k].shift_start > 0 ? '+' : ''}${f.analogs3[k].shift_start / 60}시간 이동)` : ''}</span>`).join('');
  return `<h3>비슷한 날 3일의 실제 주차 차량 수</h3>
  <svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="비슷한 날 3일의 시간대별 주차 차량 수">${p.join('')}</svg>
  <div class="legend">${leg}</div>
  <p class="note">2024년 7월 입출차 기록(공공데이터포털 15138735)으로 계산한 '주차 중 차량'. 실시간 대수와 집계 기준이 달라 숫자를 직접 비교하지 않습니다. 같은 공연장이어도 공연마다 규모가 2배까지 달라, 예보는 '언제 몰리나'에 집중합니다.</p>`;
}

function adviceHTML(f) {
  const cs = S.data.cg.class_stats;
  const out = [];
  if (f.entry_window) {
    out.push(`<div class="adv in"><b>도착 — 입차가 가장 몰리는 때</b><span class="big">${f.entry_window.start} ~ ${f.entry_window.end}</span>
      <p>이 시간대를 피해 일찍 오거나 대중교통을 권합니다. <span class="pill">참고용</span></p><small>근거: ${esc(f.entry_window.method || '')} · 이 예보 규칙 그대로 2024년 7월 공연일 9일 교차 검증 4일 적중(상식 규칙 3일) — 정확도가 낮아 참고용</small></div>`);
  }
  if (f.exit_window) {
    out.push(`<div class="adv out"><b>귀가 — 출차가 가장 몰리는 때</b><span class="big">${f.exit_window.start} ~ ${f.exit_window.end}</span>
      <p>${f.sessions.some((x) => x.duration_src !== '공지') ? `추정 종료 ${f.main_end}(소요시간 미공지 → 같은 공연장 중앙값)` : `공지 종료 ${f.main_end}`}보다 늦게 정점이 옵니다. 2024년 7월 공연일 9일 중 8일은 종료 40~100분 뒤가 정점(중앙값 60분).</p><small>근거: ${esc(f.exit_window.method || '')} · 이 예보 규칙 그대로 2024년 7월 공연일 9일 교차 검증 7일 적중(같은 공연 제외 시 8일, 상식 규칙 4일). 출차 차량이 가장 많은 시간대이며 출구 대기 시간은 측정하지 않았습니다.</small></div>`);
  }
  const b = cs[f.cls];
  if (b) {
    const zones = (b.zones_full || []).slice(0, 3).map((z) => `${z[0]}(${z[1]}회)`).join(', ');
    out.push(`<div class="adv warn"><b>만차 가능성 — ${f.risk}</b>
      <p>같은 구성(${esc(f.cls)})의 날: 혼잡도 기록이 있는 ${b.days}일 중 <strong>${b.full_days}일</strong>에 어느 구역이든 만차 기록 (같은 기간 이런 날 전체 ${S.data.cg.span_class_counts[f.cls] || '-'}일, 기록 있는 날 중 주말 ${b.weekend_days}일)${b.first_full_hour_median != null ? ` · 첫 만차 기록 시각 중앙값 ${b.first_full_hour_median}시` : ''}</p>
      ${zones ? `<p>만차가 자주 기록된 구역: ${zones}</p>` : ''}
      <small>근거: 주차장 혼잡도 정보(15164156, 2025-02~2026-08). 등급(높음·보통·낮음)은 공연 구성·주말 여부로 정한 규칙 구분이며 확률이 아닙니다.</small></div>`);
  }
  const lots = [...new Set(f.sessions.map((s) => s.venue).concat(f.unknown_time || []))].map((v) => VENUE_LOT[v] ? `${v} → ${VENUE_LOT[v].lot}(${VENUE_LOT[v].cars}대, ${VENUE_LOT[v].gate})` : '').filter(Boolean);
  out.push(`<div class="adv go"><b>대중교통·가까운 주차장</b>
    <p>지하철 5·9호선 올림픽공원역 3번 출구 · 8호선 몽촌토성역 1번 출구 · 9호선 한성백제역 2번 출구</p>
    ${lots.length ? `<p>공연장 가장 가까운 주차장: ${lots.join(' / ')} — 가장 먼저 찰 수 있습니다.</p>` : ''}
    <small>출처: 올림픽공원 누리집 '주차 안내'(2026-11-11 확인). 대형 행사 때는 선불·사전정산이 없고 대중교통 이용을 기관이 권고합니다.</small></div>`);
  return `<div class="advice">${out.join('')}</div>`;
}

function renderDay() {
  const f = S.data.fcBy[S.sel];
  const box = $('#day');
  if (!f) { box.innerHTML = `<div class="card empty">이 날짜의 예보 자료가 없습니다.</div>`; return; }
  const all = (f.all_sessions || []).slice().sort((a, b) => (a.starts[0] || '99').localeCompare(b.starts[0] || '99'));
  const showList = all.length ? `<ul class="shows">${all.map((s) => {
    const e = S.data.evById[s.id] || {};
    const t = s.starts.length ? s.starts.map((st) => `${st}~${fmt(hm(st) + s.duration)}`).join('<br>') : '시각 미확인';
    const tag = s.parse === 'long_run' ? '<span class="tag">장기 공연</span>' : '';
    const dtag = s.starts.length && e.duration_src && e.duration_src !== '공지' ? '<span class="tag">*소요시간 미공지 → 같은 공연장 중앙값</span>' : '';
    const link = e.link && /^https?:\/\//.test(e.link) ? ` <a href="${esc(e.link)}" target="_blank" rel="noopener">예매</a>` : '';
    return `<li><span class="t">${t}</span><span><span class="title">${esc(e.title || '')}</span>${tag}${dtag}<br><span class="v">${esc(s.venue)}</span>${link}</span></li>`;
  }).join('')}</ul>` : `<p class="note">이 날 기관 공연 일정에 등록된 공연이 없습니다.</p>`;

  if (!f.sessions.length && f.unknown_time && f.unknown_time.length) {
    box.innerHTML = `<div class="daygrid"><div class="card"><div class="dayhead"><h2>${dlabel(f.date)}</h2><span class="risk ${f.risk}">만차 가능성 ${f.risk}</span></div>
      <p><b>대형 공연 있음 — 시작 시각 미확인</b></p>${showList}
      <p class="note">${esc(f.unknown_time.join('·'))} 회차가 있지만 기관 공연 일정의 시각 문구를 읽지 못해 입차·출차 몰림 시간을 계산하지 않았습니다. 예매처에서 시작 시각을 확인하세요. 만차 가능성은 공연 구성으로만 판단했습니다.</p></div>
      <div class="card">${adviceHTML(f)}</div></div>`;
    return;
  }
  if (!f.sessions.length) {
    const b = S.data.cg.class_stats['대형공연 없음'];
    box.innerHTML = `<div class="daygrid"><div class="card"><div class="dayhead"><h2>${dlabel(f.date)}</h2><span class="risk 낮음">대형 공연 없음</span></div>
      ${showList}
      <p class="note">대형 공연장(KSPO DOME·88잔디마당·티켓링크 라이브 아레나·올림픽홀) 회차가 없는 날입니다.${b ? ` 혼잡도 기록상 이런 날 ${b.days}일 중 만차 기록은 ${b.full_days}일이었습니다.` : ''} 지금 대수는 위 실시간 값을 보세요.</p></div>
      <div class="card">${nextEventHint(f.date)}</div></div>`;
    return;
  }
  box.innerHTML = `<div class="daygrid">
    <div class="card"><div class="dayhead"><h2>${dlabel(f.date)}</h2><span class="risk ${f.risk}">만차 가능성 ${f.risk}</span></div>
      <div class="sum">${f.entry_window ? `<div class="sum-i in"><span>입차 몰림</span><b>${f.entry_window.start}~${f.entry_window.end}</b></div>` : ''}${f.exit_window ? `<div class="sum-i out"><span>출차 몰림</span><b>${f.exit_window.start}~${f.exit_window.end}</b></div>` : ''}</div>
      ${showList}
    </div>
    <div class="card">${adviceHTML(f)}</div>
    <div class="card wide"><h3>시간대로 보기</h3>
      ${timelineSVG(f)}
      <div class="legend"><span><i style="background:#f4b740;opacity:.6"></i>입차 몰림</span><span><i style="background:#8a97ad"></i>공연(공지 시각)</span><span><i style="background:#e0573a;opacity:.6"></i>출차 몰림</span>${f.sessions.some((x) => x.duration_src !== '공지') ? '<span>* 소요시간 미공지: 같은 공연장 중앙값</span>' : ''}</div>
      ${f.analog_note ? `<p class="note">${esc(f.analog_note)}</p>` : ''}
    </div>
    <div class="card wide">${analogChart(f)}</div>
  </div>`;
}

function nextEventHint(date) {
  const nx = S.data.fc.days.find((d) => d.date > date && d.sessions.length);
  if (!nx) return '<p class="note">이후 예보 범위 안에 대형 공연이 없습니다.</p>';
  return `<h3>다음 대형 공연날</h3><p><b>${dlabel(nx.date)}</b> · 만차 가능성 ${nx.risk}</p><p class="note">${nx.sessions.map((s) => `${esc(s.venue)} ${s.start}`).join(' · ')}</p><button class="ghost" type="button" data-go="${nx.date}">이 날 보기</button>`;
}

/* ---------- 운영자 보기 ---------- */
function opsRows() {
  const today = iso(new Date());
  const end = new Date(); end.setDate(end.getDate() + 56);
  return S.data.fc.days.filter((d) => d.date >= today && d.date <= iso(end) && (d.sessions.length || (d.unknown_time && d.unknown_time.length)));
}
function renderOps() {
  const rows = opsRows();
  const t = $('#opsTable');
  if (!rows.length) { t.innerHTML = '<tr><td class="empty">앞으로 8주 안에 대형 공연이 없습니다.</td></tr>'; return; }
  t.innerHTML = `<thead><tr><th>날짜</th><th>공연장·시작</th><th>동시 공연</th><th>만차 가능성</th><th>입차 몰림</th><th>출차 몰림</th><th>비슷한 실측일</th></tr></thead><tbody>${rows.map((d) => {
    const vs = [...new Set(d.sessions.map((s) => s.venue).concat(d.unknown_time || []))];
    const vtxt = d.sessions.map((s) => `${esc(s.venue)} ${s.start}`).concat((d.unknown_time || []).map((v) => `${esc(v)} <span class="pill">시각 미확인</span>`)).join('<br>');
    return `<tr><td class="n">${dlabel(d.date)}</td><td>${vtxt}</td><td>${vs.length > 1 ? '<b>' + vs.length + '곳</b>' : '1곳'}</td><td><span class="risk ${d.risk}">${d.risk}</span></td><td class="n">${d.entry_window ? d.entry_window.start + '~' + d.entry_window.end : '-'}</td><td class="n">${d.exit_window ? d.exit_window.start + '~' + d.exit_window.end : '-'}</td><td>${d.analog ? d.analog.date : d.sessions.length ? '<span class="pill">일반 규칙</span>' : '-'}</td></tr>`;
  }).join('')}</tbody>`;
}
function opsCSV() {
  const rows = opsRows();
  const head = ['날짜', '공연장·시작', '만차 가능성', '입차 몰림', '출차 몰림', '비슷한 실측일'];
  const lines = [head.join(',')].concat(rows.map((d) => [d.date, d.sessions.map((s) => s.venue + ' ' + s.start).concat((d.unknown_time || []).map((v) => v + ' 시각 미확인')).join(' / '), d.risk,
    d.entry_window ? d.entry_window.start + '~' + d.entry_window.end : '', d.exit_window ? d.exit_window.start + '~' + d.exit_window.end : '', d.analog ? d.analog.date : d.sessions.length ? '일반 규칙' : ''].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'olpark_parking_plan.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- 실시간 수집 기록 ---------- */
function rtlogHTML() {
  const L = S.data.rtlog;
  if (!L || !L.samples || L.samples.length < 12) return '';
  const sm = L.samples;
  const T = (x) => { const [d, t] = x.split(' '); const [y, mo, da] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, mo - 1, da, h, mi).getTime(); };
  const t0 = T(sm[0][0]), t1 = T(sm[sm.length - 1][0]);
  let mx = sm[0], mn = sm[0];
  sm.forEach((x) => { if (x[1] > mx[1]) mx = x; if (x[1] < mn[1]) mn = x; });
  const top = Math.ceil(Math.max(mx[1], CAP) / 500) * 500;
  const W = 760, Hh = 200, Lm = 50, R = 10, Tm = 10, B = 26;
  const X = (t) => Lm + ((t - t0) / Math.max(1, t1 - t0)) * (W - Lm - R);
  const Y = (v) => Tm + (1 - v / top) * (Hh - Tm - B);
  const p = [];
  for (let v = 0; v <= top; v += 500) p.push(`<line x1="${Lm}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceff4"/><text x="${Lm - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#5b6474">${nf(v)}</text>`);
  p.push(`<line x1="${Lm}" x2="${W - R}" y1="${Y(CAP)}" y2="${Y(CAP)}" stroke="#c62828" stroke-dasharray="4 4"/><text x="${W - R}" y="${Y(CAP) - 4}" font-size="11" text-anchor="end" fill="#c62828">기관 화면 기준 2,200대</text>`);
  const step = Math.max(1, Math.round((t1 - t0) / 6 / 3600000)) * 3600000;
  for (let t = Math.ceil(t0 / 3600000) * 3600000; t <= t1; t += step) { const d = new Date(t); p.push(`<text x="${X(t)}" y="${Hh - 6}" font-size="11" text-anchor="middle" fill="#5b6474">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}시</text>`); }
  let path = '';
  sm.forEach((x, i) => { path += `${i ? 'L' : 'M'}${X(T(x[0])).toFixed(1)},${Y(x[1]).toFixed(1)}`; });
  p.push(`<path d="${path}" fill="none" stroke="#1d3b6e" stroke-width="2"/>`);
  return `<h3>직접 모은 실시간 주차 대수(5분 간격)</h3>
  <svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="수집한 실시간 주차 대수">${p.join('')}</svg>
  <p class="note">${esc(sm[0][0])} ~ ${esc(sm[sm.length - 1][0])}, ${nf(sm.length)}건. 최대 ${nf(mx[1])}대(${esc(mx[0])}), 최소 ${nf(mn[1])}대(${esc(mn[0])}). 대형 공연이 없는 평일에도 낮에는 기관 화면 기준 2,200대를 넘는 시간이 있어, '90% 이상'만으로 공연 효과를 판단하지 않고 입차·출차 시각으로 채점합니다(부록 prereg/prereg_addendum_20261112.md).</p>`;
}

/* ---------- 근거·검증 ---------- */
function compareChart() {
  const jl = S.data.july.days;
  const wk = jl.filter((d) => d.type === 'wkd' && !d.sessions.length);
  const avg = Array.from({ length: 288 }, (_, i) => wk.reduce((s, d) => s + d.occ5[i], 0) / wk.length);
  const pick = ['2024-07-20', '2024-07-21'].map((k) => S.data.julyBy[k]);
  const W = 680, Hh = 230, L = 44, R = 10, T = 10, B = 26, i0 = 72, i1 = 288;
  const mx = 2500;
  const X = (i) => L + ((i - i0) / (i1 - i0 - 1)) * (W - L - R);
  const Y = (v) => T + (1 - v / mx) * (Hh - T - B);
  const p = [];
  for (let v = 0; v <= mx; v += 500) p.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eceff4"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="#5b6474">${nf(v)}</text>`);
  for (let h = 6; h <= 24; h += 3) p.push(`<text x="${X(Math.min(h * 12, i1 - 1))}" y="${Hh - 6}" font-size="11" text-anchor="middle" fill="#5b6474">${h}시</text>`);
  const line = (c, col, w) => { let d = ''; for (let i = i0; i < i1; i++) d += `${i === i0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(c[i]).toFixed(1)}`; return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"/>`; };
  p.push(line(avg, '#9aa3b2', 2));
  p.push(line(pick[0].occ5, '#1d3b6e', 2.2));
  p.push(line(pick[1].occ5, '#e0573a', 2.2));
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="공연날과 평일 평균 주차 차량 수 비교">${p.join('')}</svg>
  <div class="legend"><span><i style="background:#9aa3b2"></i>공연 없는 월~목 ${wk.length}일 평균</span><span><i style="background:#1d3b6e"></i>7/20(토) DOME 18:00 + 올림픽홀 18:00 — 최대 ${nf(pick[0].occ_peak)}대 ${pick[0].occ_peak_time}</span><span><i style="background:#e0573a"></i>7/21(일) DOME 17:00 + 올림픽홀 16:00 — 최대 ${nf(pick[1].occ_peak)}대 ${pick[1].occ_peak_time}</span></div>`;
}

function renderProof() {
  const bt = S.data.bt, cg = S.data.cg, s = bt.summary, sv = S.data.bsv;
  const cls = ['DOME+기타대형', 'DOME 단독', '88잔디마당', '기타 대형(아레나·올림픽홀)', '대형공연 없음'];
  const ev = S.data.evals;
  const evalRows = ev && ev.results ? ev.results.map((r) => `<tr><td class="n">${r.date}</td><td>${r.verdict || '채점 완료'}${r.verdict === '표본 부족' ? ` (${Math.round(r.coverage * 100)}%)` : ''}</td><td>${r.entry_obs || '-'} ${r.entry_hit == null ? '' : r.entry_hit ? '<span class="ok-t">적중</span>' : '<span class="no-t">빗나감</span>'}</td><td>${r.exit_obs || '-'} ${r.exit_hit == null ? '' : r.exit_hit ? '<span class="ok-t">적중</span>' : '<span class="no-t">빗나감</span>'}</td><td class="n">${r.shape_r ?? '-'}</td><td class="n">${r.obs_max != null ? nf(r.obs_max) + '대' : '-'}</td></tr>`).join('') : '';
  $('#proof').innerHTML = `
  <h2>1. 공연날에는 시간대 모양이 다릅니다</h2>
  <div class="card">${compareChart()}
  <p class="note">2024년 7월 입출차 215,528건(공공데이터포털 15138735)으로 5분마다 '주차 중 차량'을 계산. 공연 없는 월~목 평균은 오전 11시 무렵 약 1,000대가 정점. 대형 공연이 겹친 7/20·21은 공연 직전 오후 5시 무렵 2천 대를 넘었고, 다른 공연날 7일은 최대 908~1,167대였습니다. 7/20 21시대 출차 1,188대, 7/21 20시대 출차 1,060대(1시간).</p></div>

  <h2>2. 무엇을 맞힐 수 있는지 먼저 시험했습니다 (교차 검증)</h2>
  <div class="card"><p class="note">이 서비스의 예보 함수를 그대로 써서 2024년 7월 공연일 ${sv.day.n}일을 하나씩 정답으로 빼고 나머지 날만으로 예측. '공연 단위'는 같은 공연의 다른 날까지 함께 뺀 더 엄격한 시험. 정점은 10분 입차·출차가 가장 많은 시각, 적중은 정점이 예보 구간(±30분) 안.</p>
  <div class="table-wrap"><table class="grid"><thead><tr><th>항목</th><th>이 서비스(날짜 단위)</th><th>이 서비스(공연 단위)</th><th>상식 규칙</th><th>판단</th></tr></thead><tbody>
  <tr><td>출차 정점 시각</td><td class="n">${sv.day.exit_hit}/${sv.day.n}일</td><td class="n">${sv.event.exit_hit}/${sv.event.n}일</td><td class="n">${sv.day.exit_base_hit}/${sv.day.n}일 (종료~+60분)</td><td><b>핵심 예보</b></td></tr>
  <tr><td>입차 정점 시각</td><td class="n">${sv.day.entry_hit}/${sv.day.n}일</td><td class="n">${sv.event.entry_hit}/${sv.event.n}일</td><td class="n">${sv.day.entry_base_hit}/${sv.day.n}일 (시작 60분 전~시작)</td><td>참고용으로만 표시</td></tr>
  <tr><td>주차 차량 수(규모)</td><td class="n" colspan="2">12~24시 평균 절대 오차 ${nf(s.median_mae_A)}대 (비슷한 날 1일, 9일 중앙값)</td><td class="n">${nf(s.median_mae_C)}대 (같은 요일 평균)</td><td><b>못 맞힘</b> → 실시간 값과 혼잡도 기록으로 안내</td></tr>
  </tbody></table></div>
  <p class="note">실제 '종료 → 출차 정점' 분: ${s.exit_after_end_minutes.join(', ')}. 표본이 9일이라 정확도 보장이 아니며, 출차 차량이 가장 많은 시각이 출구 대기 시간이 가장 긴 시각이라는 것은 측정하지 않았습니다. 규칙을 고를 때 시험한 방법 비교는 소스의 pipeline/backtest.py.</p></div>

  <h2>3. 만차 기록은 공연날에 몰립니다</h2>
  <div class="card"><div class="table-wrap"><table class="grid"><thead><tr><th>공연 구성</th><th>기간 중 날짜 수</th><th>혼잡도 기록 있는 날</th><th>그중 만차 기록</th><th>만차 잦은 구역</th></tr></thead><tbody>
  ${cls.map((k) => { const b = cg.class_stats[k] || { days: 0, full_days: 0, zones_full: [] }; return `<tr><td>${k}</td><td class="n">${nf(cg.span_class_counts[k] || 0)}</td><td class="n">${b.days}</td><td class="n">${b.full_days}</td><td>${(b.zones_full || []).slice(0, 4).map((z) => z[0] + ' ' + z[1]).join(', ')}</td></tr>`; }).join('')}
  </tbody></table></div>
  <p class="note">주차장 혼잡도 정보(15164156) ${cg.first}~${cg.last}, ${nf(cg.rows)}건. 공연 구성은 기관 공연 일정으로 판정. 기록은 하루 몇 번뿐이고 기록이 없는 날도 많아, 기록 없는 날을 한산했다고 해석하지 않습니다.</p></div>

  <h2>4. 공연 전에 예측을 고정하고, 실제 값으로 채점합니다</h2>
  <div class="card"><p>2026-11-11 19:47, 11/13~11/29 공연일 8일의 예측과 채점 규칙을 파일로 고정(SHA-256 <span class="mono">d2ca6253b4c549ece7d9bee1d91fe4df45477f75c7458cb163237452e145ef94</span>). 원본은 소스의 prereg/ 폴더(SHA256_사전등록.txt 포함). 기관 실시간 API 기록이 있는 날만 같은 규칙으로 채점합니다(입차: 시작 3시간 전~시작+30분의 30분 최대 증가 시점, 출차: 시작 뒤 30분 최대 감소 시점, 예측 구간 ±15분).</p>
  <p class="note">같은 채점 규칙을 2024년 7월 실측(주차 중 차량 곡선)에 미리 적용한 결과: 출차 ${S.data.bts ? S.data.bts.summary.exit_hit : '-'}/9일, 입차 ${S.data.bts ? S.data.bts.summary.entry_hit : '-'}/9일.</p>
  ${evalRows ? `<div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>상태</th><th>실제 가장 빠른 증가 시각</th><th>실제 가장 빠른 감소 시각</th><th>곡선 상관</th><th>실제 최대</th></tr></thead><tbody>${evalRows}</tbody></table></div>` : '<p class="note">아직 채점할 공연일 자료가 쌓이지 않았습니다.</p>'}
  ${rtlogHTML()}</div>

  <h2>5. 기관 기존 화면과의 관계</h2>
  <div class="card"><p class="note">기관은 '주차장 예상 이용률 서비스'로 주말 30분 단위 예상 이용률(%)과 실시간 대수를 제공합니다. 이 서비스는 그 화면을 대신하지 않고, 기관 화면에 없는 ① 공연 뒤 출차가 몰리는 시간대 ② 구역별 만차 기록 ③ 예보 근거와 검증 결과 공개 ④ 운영자용 8주 대비표를 더합니다. 실시간 대수와 50/70/90% 단계 이름은 기관 화면과 같게 맞췄습니다.</p></div>

  <h2>6. 데이터를 쓰며 발견한 점 (개선 제안)</h2>
  <div class="card"><ul>
  <li>주차장 혼잡도 정보의 '등록시간' ${cg.time_field_bug}/${cg.rows}건이 분·초 자리에 월·일이 들어 있음(예: 2026-06-06 → 00:06:06). 시(時)만 믿을 수 있어 이 서비스는 시 단위로만 사용.</li>
  <li>입출차 정보(2024-07) 215,528건과 월별주차현황 2024년 7월 올림픽공원 59,808대의 집계 기준이 다름. 기준 설명이 메타데이터에 있으면 좋겠음.</li>
  <li>공연 일정의 공연장 이름 표기가 ${S.data.meta.parse_stats.venue_spellings}가지(KSPO DOME만 14가지: 'KSPO DOME', 'KSPO DOME(올림픽체조경기장)', 'KSPODOME' 등). 공연장 코드 열 개방 제안.</li>
  <li>공연 시각이 자유 문장(예: '금 오후 7시 / 토 6PM')이라 날짜별 시작 시각을 기계가 읽기 어려움. 회차별 시작 일시 열 제안.</li>
  <li>입출차 파일은 2024년 7월 한 달, 구역 열 없음. 2025년 전체·구역 포함 자료는 API로만 제공 → 연 단위 파일 개방 제안.</li>
  </ul></div>`;
}

/* ---------- 출처 ---------- */
function renderSrc() {
  const m = S.data.meta;
  const rows = [
    ['15138735', '올림픽공원 입출차 정보(2024-07)', '파일', '이용허락범위 제한 없음', '하루 곡선·입차/출차 정점, 교차 검증'],
    ['15164156', '주차장 혼잡도 정보', '파일', '이용허락범위 제한 없음', '공연 구성별 만차 기록·구역'],
    ['15131671', '월별주차현황(보조)', '파일', '이용허락범위 제한 없음', '월별 표 참고(데이터 출처 화면)'],
    ['3037877', '올림픽공원 공연정보 — 포털 LINK형이 가리키는 기관 누리집 공연 일정에서 받음', '누리집 일정', '공공누리 제1유형(출처표시)', '날짜별 공연장·시작 시각·소요시간'],
    ['15168686', '실시간 주차현황 — 기관 누리집 공공데이터 개방목록 #64에 공개된 주소·키로 호출', 'API', '이용허락범위 제한 없음', '맨 위 지금 주차 대수'],
  ];
  const mon = S.data.monthly.filter((r) => r.place === '올림픽공원');
  $('#src').innerHTML = `<h2>사용한 한국체육산업개발(주) 공공데이터</h2>
  <div class="table-wrap"><table class="grid"><thead><tr><th>포털 번호</th><th>데이터</th><th>형태</th><th>이용 조건</th><th>쓰는 곳</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td class="n">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody></table></div>
  <p class="note">출처: 한국체육산업개발(주), 공공데이터포털(data.go.kr) 및 한국체육산업개발(주) 누리집. 공연 포스터 등 이미지 저작물은 쓰지 않았습니다. 주차장 위치·면수와 대중교통은 올림픽공원 누리집 '주차 안내'를 참고했습니다.</p>
  <h2>월별 주차 대수(올림픽공원, 15131671)</h2>
  <div class="table-wrap"><table class="grid"><thead><tr><th>연도</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join('')}</tr></thead><tbody>
  ${[...new Set(mon.map((r) => r.year))].map((y) => `<tr><td class="n">${y}</td>${Array.from({ length: 12 }, (_, i) => { const r = mon.find((x) => x.year === y && x.month === i + 1); return `<td class="n">${r ? nf(r.cars) : '-'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div>
  <h2>원본 파일 해시(SHA-256)</h2>
  <div class="table-wrap"><table class="grid"><thead><tr><th>파일</th><th>크기</th><th>SHA-256</th></tr></thead><tbody>
  ${m.sources.filter((x) => /^(15138735|15164156|15131671)/.test(x.file)).map((x) => `<tr><td>${esc(x.file)}</td><td class="n">${nf(x.bytes)}</td><td class="mono">${x.sha256}</td></tr>`).join('')}</tbody></table></div>
  <p class="note">자료 생성: ${esc(m.built)} · 공연 일정 ${nf(m.events)}건 · 입출차 ${nf(m.inout_rows)}건 · 혼잡도 ${nf(m.congestion_rows)}건</p>`;
}

/* ---------- 시작 ---------- */
function setTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  ['day', 'ops', 'proof', 'src'].forEach((k) => { $('#tab-' + k).hidden = k !== name; });
}

async function main() {
  const [fc, events, july, cg, bt, monthly, meta, evals, bts, bsv, rtlog] = await Promise.all([
    getJSON('data/forecast.json'), getJSON('data/events.json'), getJSON('data/july2024.json'), getJSON('data/congestion.json'),
    getJSON('data/backtest.json'), getJSON('data/monthly.json'), getJSON('data/meta.json'), getJSON('data/evaluation.json', true), getJSON('data/backtest_scoring.json', true), getJSON('data/backtest_service.json'), getJSON('data/realtime_log.json', true)]);
  Object.assign(S.data, { fc, events, july, cg, bt, monthly, meta, evals, bts, bsv, rtlog });
  S.data.evById = Object.fromEntries(events.map((e) => [e.id, e]));
  S.data.fcBy = Object.fromEntries(fc.days.map((d) => [d.date, d]));
  S.data.julyBy = Object.fromEntries(july.days.map((d) => [d.date, d]));
  const hash = location.hash.slice(1);
  const today = iso(new Date());
  S.sel = S.data.fcBy[hash] ? hash : S.data.fcBy[today] ? today : fc.days[0].date;
  renderDatebar(); renderDay(); renderOps(); renderProof(); renderSrc();
  $('#buildInfo').textContent = `예보 자료 생성 ${fc.generated} · 공연 일정 기준 ${meta.built}`;
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  const qt = new URLSearchParams(location.search).get('tab');
  if (['day', 'ops', 'proof', 'src'].includes(qt)) setTab(qt);
  $('#opsCsv').addEventListener('click', opsCSV);
  $('#liveRefresh').addEventListener('click', loadLive);
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { S.sel = g.dataset.go; renderDatebar(); renderDay(); } });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (S.data.fcBy[h]) { S.sel = h; renderDatebar(); renderDay(); setTab('day'); } });
  loadLive();
  setInterval(loadLive, 60000);
}
main().catch((e) => { $('#day').innerHTML = `<div class="card empty">자료를 불러오지 못했습니다. (${esc(e.message)})</div>`; });
