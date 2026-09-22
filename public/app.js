// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层

const state = {
  view: 'overview',
  teams: [],
  venues: [],
  matches: [],
  relocations: [],
  rounds: [],
  standings: null,
  summary: null,
  drawer: { mode: '', entity: '', id: '', title: '' },
  teamFilter: { status: '', keyword: '' },
  venueFilter: { keyword: '' },
  matchFilter: { round: '', status: '', keyword: '' },
  tableFilter: { keyword: '' },
};

const OPERATOR_KEY = 'league-board-operator';
const WEEKDAYS = [['0', '周日'], ['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六']];
const VIEW_META = {
  overview: { title: '概览', sub: '整季的场次进度与最近赛果', action: '' },
  teams: { title: '球队', sub: '登记参赛球队、简称、主场与档位', action: '新增球队' },
  venues: { title: '场地', sub: '登记比赛场地、容量与可用日', action: '新增场地' },
  matches: { title: '赛程', sub: '按轮次查看对阵，登记比分后积分随之变化', action: '新增赛程' },
  table: { title: '积分榜', sub: '按积分、净胜球、进球依次排序', action: '' },
};

const el = (id) => document.getElementById(id);

async function request(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function toast(message, kind) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'ok' ? 'ok' : 'bad'}`;
  node.textContent = message;
  el('toasts').appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const statusPill = (status) => {
  const map = { 已赛: 'done', 待赛: 'wait', 延期: 'late', 取消: 'off' };
  return `<span class="pill ${map[status] || 'wait'}">${escapeHtml(status)}</span>`;
};

async function loadHealth() {
  const node = el('link-state');
  try {
    await request('/api/health');
    node.className = 'link-state ok';
    node.innerHTML = '<span class="dot"></span>服务正常';
  } catch (err) {
    node.className = 'link-state bad';
    node.innerHTML = '<span class="dot"></span>服务连不上';
  }
}

async function loadSummary() {
  state.summary = await request('/api/summary');
  el('season-name').textContent = state.summary.season;
  renderOverview();
}

async function loadStandings() {
  const params = new URLSearchParams();
  if (state.tableFilter.keyword) params.set('keyword', state.tableFilter.keyword);
  state.standings = await request(`/api/standings${params.toString() ? `?${params}` : ''}`);
  renderStandings();
}

async function loadTeams() {
  const params = new URLSearchParams();
  if (state.teamFilter.status) params.set('status', state.teamFilter.status);
  if (state.teamFilter.keyword) params.set('keyword', state.teamFilter.keyword);
  const payload = await request(`/api/teams${params.toString() ? `?${params}` : ''}`);
  state.teams = payload.teams;
  el('nav-teams').textContent = String(payload.total);
  renderTeams();
}

async function loadVenues() {
  const params = new URLSearchParams();
  if (state.venueFilter.keyword) params.set('keyword', state.venueFilter.keyword);
  const payload = await request(`/api/venues${params.toString() ? `?${params}` : ''}`);
  state.venues = payload.venues;
  el('nav-venues').textContent = String(payload.total);
  renderVenues();
}

async function loadMatches() {
  const params = new URLSearchParams();
  if (state.matchFilter.round) params.set('round', state.matchFilter.round);
  if (state.matchFilter.status) params.set('status', state.matchFilter.status);
  if (state.matchFilter.keyword) params.set('keyword', state.matchFilter.keyword);
  const payload = await request(`/api/matches${params.toString() ? `?${params}` : ''}`);
  state.matches = payload.matches;
  state.rounds = payload.rounds;
  el('nav-matches').textContent = String(payload.total);
  renderMatches();
}

async function loadRelocations() {
  const payload = await request('/api/matches/relocations');
  state.relocations = payload.relocations;
  renderRelocations();
}

function renderOverview() {
  const data = state.summary;
  if (!data) return;
  el('stat-row').innerHTML = [
    ['球队', `${data.activeTeamCount} / ${data.teamCount}`, '参赛中的队数'],
    ['场地', String(data.venueCount), '已登记的比赛场地'],
    ['赛程进度', `${data.playedRounds} / ${data.totalRounds}`, '打完的轮次'],
    ['已赛 / 待赛', `${data.playedMatches} / ${data.pendingMatches}`, `延期 ${data.postponedMatches} 场`],
  ].map(([label, value, note], index) => `<div class="stat ${index === 0 ? 'accent' : ''}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}　${escapeHtml(note)}</span></div>`).join('');

  el('points-hint').textContent = `胜 ${data.points.win} 分 / 平 ${data.points.draw} 分`;
  el('recent-feed').innerHTML = data.recent.length
    ? data.recent.map((item) => `<li>
        <span class="round-tag">第 ${item.round} 轮</span>
        <span>${escapeHtml(item.homeName)}</span>
        <span class="score">${escapeHtml(item.scoreText)}</span>
        <span>${escapeHtml(item.awayName)}</span>
        <span class="muted" style="margin-left:auto">${escapeHtml(item.date)}</span>
      </li>`).join('')
    : '<li class="muted">还没有打完的场次</li>';

  el('podium').innerHTML = data.topThree.length
    ? data.topThree.map((row) => `<li>
        <span class="rank-badge">${row.rank}</span>
        <span>${escapeHtml(row.name)}</span>
        <span class="muted">净胜 ${row.goalDiff}</span>
        <span class="pts">${row.points} 分</span>
      </li>`).join('')
    : '<li class="muted">暂无排名</li>';
}

function renderTeams() {
  el('team-rows').innerHTML = state.teams.map((item) => `<tr>
      <td class="num">${item.seedRank}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.shortName)}</td>
      <td>${escapeHtml(item.city)}</td>
      <td>${escapeHtml(item.venueName)}</td>
      <td class="num">${item.matchCount}</td>
      <td>${item.status === '参赛' ? '<span class="pill done">参赛</span>' : '<span class="pill off">退赛</span>'}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        <button type="button" class="mini" data-edit-team="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-team="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('team-empty').classList.toggle('show', state.teams.length === 0);
}

function renderVenues() {
  el('venue-grid').innerHTML = state.venues.map((item) => `<article class="venue-card">
      <h3>${escapeHtml(item.name)}</h3>
      <div class="city">${escapeHtml(item.city)}</div>
      <dl>
        <dt>容量</dt><dd>${item.capacity} 人</dd>
        <dt>可用日</dt><dd>${escapeHtml(item.weekdaysText)}</dd>
        <dt>主场球队</dt><dd>${item.homeTeams.length ? escapeHtml(item.homeTeams.join('、')) : '无'}</dd>
        <dt>已排场次</dt><dd>${item.matchCount} 场</dd>
      </dl>
      <div class="card-actions">
        <button type="button" class="mini" data-edit-venue="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-venue="${escapeHtml(item.id)}">删除</button>
      </div>
    </article>`).join('');
  el('venue-empty').classList.toggle('show', state.venues.length === 0);
}

function renderRounds() {
  const chips = [{ round: '', label: '全部轮次' }].concat(state.rounds.map((item) => ({
    round: String(item.round),
    label: `第 ${item.round} 轮 ${item.played}/${item.total}`,
  })));
  el('round-chips').innerHTML = chips.map((chip) => `<button type="button" class="${String(state.matchFilter.round) === chip.round ? 'is-active' : ''}" data-round="${chip.round}">${escapeHtml(chip.label)}</button>`).join('');
}

function renderMatches() {
  renderRounds();
  el('match-rows').innerHTML = state.matches.map((item) => `<tr>
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)}</td>
      <td class="num">${item.scoreText ? escapeHtml(item.scoreText) : '—'}</td>
      <td>${escapeHtml(item.awayName)}</td>
      <td>${escapeHtml(item.venueName)}${item.venueRelocated ? ' <span class="pill late">已换场</span>' : ''}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        ${['待赛', '延期'].includes(item.status) ? `<button type="button" class="mini" data-relocate-match="${escapeHtml(item.id)}">换场地</button>` : ''}
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

// 改过场地的场次单独列在赛程表上方：原场地 → 新场地，主客关系不变
function renderRelocations() {
  const list = state.relocations;
  el('relocation-card').classList.toggle('show', list.length > 0);
  el('relocation-list').innerHTML = list.map((item) => `<li>
      <span class="round-tag">第 ${item.round} 轮</span>
      <span>${escapeHtml(item.homeName)} vs ${escapeHtml(item.awayName)}</span>
      <span class="muted">${escapeHtml(item.date)} ${escapeHtml(item.kickoff)}</span>
      <span class="reloc-move">${escapeHtml(item.venueFromName || '未指定场地')} → ${escapeHtml(item.venueName)}</span>
      ${statusPill(item.status)}
    </li>`).join('');
}

function renderStandings() {
  const data = state.standings;
  if (!data) return;
  el('table-hint').textContent = `${data.season}　已打 ${data.playedMatches} 场，待赛 ${data.pendingMatches} 场，延期 ${data.postponedMatches} 场`;
  el('table-rows').innerHTML = data.table.map((row) => `<tr>
      <td class="num">${row.rank}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.played}</td>
      <td>${row.win}</td>
      <td>${row.draw}</td>
      <td>${row.loss}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</td>
      <td><strong>${row.points}</strong></td>
    </tr>`).join('');
}

/* 抽屉与表单 */
function fieldHtml(kind, name, label, extra) {
  const attrs = extra || '';
  if (kind === 'select') return `<label class="field"><span>${label}</span><select data-name="${name}" ${attrs}></select></label>`;
  if (kind === 'text') return `<label class="field"><span>${label}</span><input data-name="${name}" ${attrs}></label>`;
  return `<label class="field"><span>${label}</span>${extra || ''}</label>`;
}

function optionsHtml(list, selected) {
  return list.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function openTeamDrawer(team) {
  state.drawer = { mode: team ? 'edit' : 'create', entity: 'team', id: team ? team.id : '', title: team ? `编辑球队：${team.name}` : '新增球队' };
  const venueOptions = optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), team ? team.venueId : (state.venues[0] ? state.venues[0].id : ''));
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队名称</span><input data-name="name" maxlength="24" value="${escapeHtml(team ? team.name : '')}" placeholder="例如 江城铁马"></label>
    <div class="field-row">
      <label class="field"><span>简称（两到四个大写字母）</span><input data-name="shortName" maxlength="4" value="${escapeHtml(team ? team.shortName : '')}" placeholder="JCTM"></label>
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(team ? team.city : '')}" placeholder="江城"></label>
    </div>
    <label class="field"><span>主场场地</span><select data-name="venueId">${venueOptions}</select></label>
    <div class="field-row">
      <label class="field"><span>档位</span><input data-name="seedRank" maxlength="2" value="${escapeHtml(team ? team.seedRank : '')}" placeholder="1"></label>
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml([{ value: '参赛', label: '参赛' }, { value: '退赛', label: '退赛' }], team ? team.status : '参赛')}</select></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(team ? team.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openVenueDrawer(venue) {
  state.drawer = { mode: venue ? 'edit' : 'create', entity: 'venue', id: venue ? venue.id : '', title: venue ? `编辑场地：${venue.name}` : '新增场地' };
  const picked = venue ? venue.weekdays.map(String) : ['6'];
  el('drawer-form').innerHTML = `
    <label class="field"><span>场地名称</span><input data-name="name" maxlength="30" value="${escapeHtml(venue ? venue.name : '')}" placeholder="例如 江城体育中心"></label>
    <div class="field-row">
      <label class="field"><span>所属城市</span><input data-name="city" maxlength="20" value="${escapeHtml(venue ? venue.city : '')}" placeholder="江城"></label>
      <label class="field"><span>容量（人）</span><input data-name="capacity" maxlength="6" value="${escapeHtml(venue ? venue.capacity : '')}" placeholder="32000"></label>
    </div>
    <div class="field"><span>可用日</span><div class="weekday-pick">
      ${WEEKDAYS.map(([value, label]) => `<label><input type="checkbox" data-weekday="${value}" ${picked.includes(value) ? 'checked' : ''}> ${label}</label>`).join('')}
    </div></div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(venue ? venue.note : '')}" placeholder="例如 三家共用"></label>`;
  showDrawer();
}

function openMatchDrawer(match) {
  state.drawer = { mode: match ? 'edit' : 'create', entity: 'match', id: match ? match.id : '', title: match ? `编辑赛程：第 ${match.round} 轮` : '新增赛程' };
  const teamOptions = state.teams.map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` }));
  const venueOptions = [{ value: '', label: '留空表示用主队主场' }].concat(state.venues.map((item) => ({ value: item.id, label: item.name })));
  const statusOptions = ['待赛', '已赛', '延期', '取消'].map((value) => ({ value, label: value }));
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>轮次</span><input data-name="round" maxlength="2" value="${escapeHtml(match ? match.round : '1')}" placeholder="1"></label>
      <label class="field"><span>日期</span><input data-name="date" maxlength="10" value="${escapeHtml(match ? match.date : '')}" placeholder="2026-03-14"></label>
      <label class="field"><span>开赛时刻</span><input data-name="kickoff" maxlength="5" value="${escapeHtml(match ? match.kickoff : '15:30')}" placeholder="15:30"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>主队</span><select data-name="homeTeamId">${optionsHtml(teamOptions, match ? match.homeTeamId : '')}</select></label>
      <label class="field"><span>客队</span><select data-name="awayTeamId">${optionsHtml(teamOptions, match ? match.awayTeamId : '')}</select></label>
    </div>
    <label class="field"><span>场地</span><select data-name="venueId">${optionsHtml(venueOptions, match ? match.venueId : '')}</select></label>
    <div class="field-row">
      <label class="field"><span>状态</span><select data-name="status">${optionsHtml(statusOptions, match ? match.status : '待赛')}</select></label>
      <label class="field"><span>主队进球</span><input data-name="homeGoals" maxlength="2" value="${match && match.homeGoals !== null ? match.homeGoals : ''}" placeholder="留空表示未赛"></label>
      <label class="field"><span>客队进球</span><input data-name="awayGoals" maxlength="2" value="${match && match.awayGoals !== null ? match.awayGoals : ''}" placeholder="留空表示未赛"></label>
    </div>
    <label class="field"><span>备注</span><input data-name="note" maxlength="200" value="${escapeHtml(match ? match.note : '')}" placeholder="需要留意的地方"></label>`;
  showDrawer();
}

function openResultDrawer(match) {
  state.drawer = { mode: 'result', entity: 'match', id: match.id, title: `登记比分：${match.homeName} vs ${match.awayName}` };
  el('drawer-form').innerHTML = `
    <div class="field-row">
      <label class="field"><span>${escapeHtml(match.homeName)} 进球</span><input data-name="homeGoals" maxlength="2" value="" placeholder="0"></label>
      <label class="field"><span>${escapeHtml(match.awayName)} 进球</span><input data-name="awayGoals" maxlength="2" value="" placeholder="0"></label>
    </div>
    <p class="hint">登记完成后这场标成已赛，积分榜与名次立即重算。</p>`;
  showDrawer();
}

/* 换场地：单场与批量共用的预览渲染 */
const briefText = (m) => `第 ${m.round} 轮 ${m.homeName} vs ${m.awayName}`;

const clashNoteHtml = (clashes) => clashes.map((c) => `<p class="clash-note">撞场：${escapeHtml(c.a.date)} 的 ${escapeHtml(briefText(c.a))}（${c.a.kickoff}）与 ${escapeHtml(briefText(c.b))}（${c.b.kickoff}）只隔 ${c.gap} 分钟，不到两小时，换不过去</p>`).join('');

function openRelocateDrawer(match) {
  state.drawer = { mode: 'relocate', entity: 'match', id: match.id, title: `换场地：${match.homeName} vs ${match.awayName}` };
  const venueOptions = [{ value: '', label: '选一块新场地' }].concat(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })));
  el('drawer-form').innerHTML = `
    <p class="hint">第 ${match.round} 轮 · ${escapeHtml(match.date)} ${escapeHtml(match.kickoff)} · 现在的场地：${escapeHtml(match.venueName)}。只换场地，主客关系不变。</p>
    <label class="field"><span>新场地</span><select data-name="venueId">${optionsHtml(venueOptions, '')}</select></label>
    <div id="relocate-preview"><p class="hint">选好新场地后，这里会先列出这次更换的影响</p></div>`;
  showDrawer();
}

async function fetchRelocationPreview() {
  const box = el('relocate-preview');
  if (!box) return;
  const venueId = el('drawer-form').querySelector('[data-name="venueId"]').value;
  if (!venueId) {
    box.innerHTML = '<p class="hint">选好新场地后，这里会先列出这次更换的影响</p>';
    return;
  }
  try {
    const preview = await request(`/api/matches/${encodeURIComponent(state.drawer.id)}/relocation-preview`, {
      method: 'POST',
      body: JSON.stringify({ venueId }),
    });
    renderRelocationPreview(preview);
  } catch (err) {
    box.innerHTML = `<p class="clash-note">${escapeHtml(err.message)}</p>`;
  }
}

function renderRelocationPreview(p) {
  const sameDay = p.sameDay.length
    ? `<ul>${p.sameDay.map((m) => `<li>${escapeHtml(m.kickoff)}　${escapeHtml(briefText(m))}</li>`).join('')}</ul>`
    : '<p class="muted">当天这块场地还没有排别的比赛</p>';
  const order = p.orderAfter.map((m) => `<li${m.isSelf ? ' class="self"' : ''}>${escapeHtml(m.kickoff)}　${escapeHtml(briefText(m))}${m.isSelf ? '（本场）' : ''}</li>`).join('');
  el('relocate-preview').innerHTML = `
    <div class="reloc-preview">
      <div class="reloc-line">原场地 ${escapeHtml(p.fromVenue.name)} <span class="reloc-arrow">→</span> 新场地 ${escapeHtml(p.toVenue.name)}</div>
      <div><h4>${escapeHtml(p.match.date)} 当天 ${escapeHtml(p.toVenue.name)} 已经排了</h4>${sameDay}</div>
      <div><h4>换完之后这块场地当天的场次顺序</h4><ol class="reloc-order">${order}</ol></div>
      ${clashNoteHtml(p.clashes)}
    </div>`;
}

function openTeamRelocateDrawer() {
  state.drawer = { mode: 'team-relocate', entity: 'match', id: '', title: '批量换主场场地' };
  const teamOptions = [{ value: '', label: '选一支球队' }].concat(state.teams.map((item) => ({ value: item.id, label: item.name })));
  const venueOptions = [{ value: '', label: '选一块新场地' }].concat(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })));
  el('drawer-form').innerHTML = `
    <p class="hint">把一支球队在一段时间里的全部主场未赛场次换到另一块场地，主客关系不变；已赛与已取消的不动。</p>
    <label class="field"><span>球队</span><select data-name="teamId">${optionsHtml(teamOptions, '')}</select></label>
    <div class="field-row">
      <label class="field"><span>开始日期</span><input data-name="fromDate" maxlength="10" placeholder="2026-03-01"></label>
      <label class="field"><span>结束日期</span><input data-name="toDate" maxlength="10" placeholder="2026-06-30"></label>
    </div>
    <label class="field"><span>新场地</span><select data-name="venueId">${optionsHtml(venueOptions, '')}</select></label>
    <div id="team-relocate-preview"><p class="hint">选好球队、时间段与新场地后，这里会先列出这次更换的影响</p></div>`;
  showDrawer();
}

async function fetchTeamRelocationPreview() {
  const box = el('team-relocate-preview');
  if (!box) return;
  const read = (name) => el('drawer-form').querySelector(`[data-name="${name}"]`).value.trim();
  const teamId = read('teamId');
  const fromDate = read('fromDate');
  const toDate = read('toDate');
  const venueId = read('venueId');
  if (!teamId || !fromDate || !toDate || !venueId) {
    box.innerHTML = '<p class="hint">选好球队、时间段与新场地后，这里会先列出这次更换的影响</p>';
    return;
  }
  try {
    const preview = await request(`/api/teams/${encodeURIComponent(teamId)}/relocation-preview`, {
      method: 'POST',
      body: JSON.stringify({ fromDate, toDate, venueId }),
    });
    renderTeamRelocationPreview(preview);
  } catch (err) {
    box.innerHTML = `<p class="clash-note">${escapeHtml(err.message)}</p>`;
  }
}

function renderTeamRelocationPreview(p) {
  const rows = p.matches.map((m) => `<li>第 ${m.round} 轮 · ${escapeHtml(m.date)} ${escapeHtml(m.kickoff)} · 对 ${escapeHtml(m.awayName)} · 原 ${escapeHtml(m.fromVenueName)}</li>`).join('');
  const fromNames = p.fromVenues.map((v) => escapeHtml(v.name)).join('、');
  const skippedBits = [];
  if (p.skipped.played) skippedBits.push(`已赛 ${p.skipped.played} 场不动`);
  if (p.skipped.cancelled) skippedBits.push(`已取消 ${p.skipped.cancelled} 场不动`);
  if (p.skipped.alreadyAtVenue) skippedBits.push(`本来就在新场地 ${p.skipped.alreadyAtVenue} 场不动`);
  el('team-relocate-preview').innerHTML = `
    <div class="reloc-preview">
      <div class="reloc-line">一共换 <b>${p.count}</b> 场，涉及场地：${fromNames} <span class="reloc-arrow">→</span> ${escapeHtml(p.toVenue.name)}</div>
      <ul class="reloc-list">${rows}</ul>
      ${skippedBits.length ? `<p class="muted">${skippedBits.join('；')}</p>` : ''}
      ${clashNoteHtml(p.clashes)}
    </div>`;
}

function showDrawer() {
  el('drawer-title').textContent = state.drawer.title;
  el('drawer').classList.add('show');
  el('backdrop').classList.add('show');
  const first = el('drawer-form').querySelector('input, select');
  if (first) first.focus();
}

function closeDrawer() {
  el('drawer').classList.remove('show');
  el('backdrop').classList.remove('show');
  el('drawer-form').innerHTML = '';
  state.drawer = { mode: '', entity: '', id: '', title: '' };
}

function collectForm() {
  const payload = {};
  el('drawer-form').querySelectorAll('[data-name]').forEach((node) => { payload[node.dataset.name] = node.value; });
  const days = Array.from(el('drawer-form').querySelectorAll('[data-weekday]'))
    .filter((node) => node.checked)
    .map((node) => Number(node.dataset.weekday));
  return { payload, days };
}

function markField(field) {
  const node = el('drawer-form').querySelector(`[data-name="${field}"]`);
  if (!node) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.add('invalid');
  node.focus();
}

async function submitDrawer() {
  el('drawer-form').querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  const { payload, days } = collectForm();
  const { mode, entity, id } = state.drawer;
  try {
    if (entity === 'team') {
      const body = { ...payload, seedRank: Number(payload.seedRank) };
      if (mode === 'edit') await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/teams', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '球队已保存' : '球队已新增', 'ok');
      await Promise.all([loadTeams(), loadSummary()]);
    } else if (entity === 'venue') {
      const body = { ...payload, capacity: Number(payload.capacity), weekdays: days };
      if (mode === 'edit') await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await request('/api/venues', { method: 'POST', body: JSON.stringify(body) });
      toast(mode === 'edit' ? '场地已保存' : '场地已新增', 'ok');
      await Promise.all([loadVenues(), loadTeams()]);
    } else if (entity === 'match') {
      if (mode === 'result') {
        await request(`/api/matches/${encodeURIComponent(id)}/result`, {
          method: 'POST',
          body: JSON.stringify({ homeGoals: Number(payload.homeGoals), awayGoals: Number(payload.awayGoals) }),
        });
        toast('比分已登记，积分榜已重算', 'ok');
      } else if (mode === 'relocate') {
        const moved = await request(`/api/matches/${encodeURIComponent(id)}/relocation`, {
          method: 'POST',
          body: JSON.stringify({ venueId: payload.venueId }),
        });
        toast(`已换到 ${moved.venueName}，主客关系不变`, 'ok');
      } else if (mode === 'team-relocate') {
        const result = await request(`/api/teams/${encodeURIComponent(payload.teamId)}/relocation`, {
          method: 'POST',
          body: JSON.stringify({ fromDate: payload.fromDate, toDate: payload.toDate, venueId: payload.venueId }),
        });
        toast(`已换 ${result.changed} 场主场比赛，涉及场地：${result.venuesInvolved.join('、')} → ${result.toVenue.name}`, 'ok');
      } else {
        const body = { ...payload, round: Number(payload.round) };
        if (mode === 'edit') await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await request('/api/matches', { method: 'POST', body: JSON.stringify(body) });
        toast(mode === 'edit' ? '赛程已保存' : '赛程已新增', 'ok');
      }
      await Promise.all([loadMatches(), loadSummary(), loadRelocations()]);
      if (state.view === 'table') await loadStandings();
    }
    closeDrawer();
  } catch (err) {
    toast(err.message, 'bad');
    markField(err.field);
    if (state.drawer.mode === 'relocate') fetchRelocationPreview();
    if (state.drawer.mode === 'team-relocate') fetchTeamRelocationPreview();
  }
}

/* 视图切换 */
async function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((node) => node.classList.toggle('is-active', node.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('is-active', node.id === `view-${view}`));
  const meta = VIEW_META[view];
  el('view-title').textContent = meta.title;
  el('view-sub').textContent = meta.sub;
  el('head-actions').innerHTML = meta.action ? `<button type="button" class="primary" id="head-add">${meta.action}</button>` : '';
  if (meta.action) el('head-add').addEventListener('click', () => openDrawerFor(view, null));
  if (view === 'matches') {
    el('head-actions').insertAdjacentHTML('beforeend', '<button type="button" class="ghost" id="head-team-relocate">批量换场地</button>');
    el('head-team-relocate').addEventListener('click', openTeamRelocateDrawer);
  }

  try {
    if (view === 'overview') await loadSummary();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadVenues(), loadMatches(), loadRelocations()]); }
    if (view === 'table') await loadStandings();
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function openDrawerFor(view, id) {
  if (view === 'teams') openTeamDrawer(id ? state.teams.find((item) => item.id === id) : null);
  if (view === 'venues') openVenueDrawer(id ? state.venues.find((item) => item.id === id) : null);
  if (view === 'matches') openMatchDrawer(id ? state.matches.find((item) => item.id === id) : null);
}

/* 事件绑定 */
el('nav').addEventListener('click', (event) => {
  const node = event.target.closest('.nav-item');
  if (node) switchView(node.dataset.view);
});

el('team-status-filter').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.teamFilter.status = node.dataset.value;
  el('team-status-filter').querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-active', btn === node));
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('team-search').addEventListener('click', () => {
  state.teamFilter.keyword = el('team-keyword').value.trim();
  loadTeams().catch((err) => toast(err.message, 'bad'));
});
el('venue-search').addEventListener('click', () => {
  state.venueFilter.keyword = el('venue-keyword').value.trim();
  loadVenues().catch((err) => toast(err.message, 'bad'));
});
el('match-search').addEventListener('click', () => {
  state.matchFilter.keyword = el('match-keyword').value.trim();
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('match-status').addEventListener('change', () => {
  state.matchFilter.status = el('match-status').value;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});
el('table-search').addEventListener('click', () => {
  state.tableFilter.keyword = el('table-keyword').value.trim();
  loadStandings().catch((err) => toast(err.message, 'bad'));
});
el('round-chips').addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  state.matchFilter.round = node.dataset.round;
  loadMatches().catch((err) => toast(err.message, 'bad'));
});

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.resultMatch) {
    return openResultDrawer(state.matches.find((item) => item.id === node.dataset.resultMatch));
  }
  if (node.dataset.relocateMatch) {
    return openRelocateDrawer(state.matches.find((item) => item.id === node.dataset.relocateMatch));
  }
  if (node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch) {
    const isTeam = Boolean(node.dataset.delTeam);
    const isVenue = Boolean(node.dataset.delVenue);
    const id = node.dataset.delTeam || node.dataset.delVenue || node.dataset.delMatch;
    const what = isTeam ? '球队' : (isVenue ? '场地' : '这场赛程');
    if (!window.confirm(`确定删除这个${what}吗？`)) return;
    try {
      if (isTeam) { await request(`/api/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadTeams(), loadSummary()]); }
      else if (isVenue) { await request(`/api/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadVenues(); }
      else { await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadMatches(), loadSummary()]); }
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
});

el('drawer-submit').addEventListener('click', submitDrawer);
el('drawer-cancel').addEventListener('click', closeDrawer);
el('drawer-close').addEventListener('click', closeDrawer);
el('backdrop').addEventListener('click', closeDrawer);
el('drawer-form').addEventListener('submit', (event) => { event.preventDefault(); submitDrawer(); });
// 换场地抽屉里每改一项就重新算一次影响，撞场当场看得到
el('drawer-form').addEventListener('change', (event) => {
  const name = event.target && event.target.dataset ? event.target.dataset.name : '';
  if (!name) return;
  if (state.drawer.mode === 'relocate' && name === 'venueId') fetchRelocationPreview();
  if (state.drawer.mode === 'team-relocate' && ['teamId', 'fromDate', 'toDate', 'venueId'].includes(name)) fetchTeamRelocationPreview();
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, el('operator').value.trim());
});

async function boot() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
  await loadHealth();
  await switchView('overview');
}

boot();
