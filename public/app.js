// 页面交互：左侧导航切换视图，右侧抽屉负责新增与编辑，所有提示走右上角浮层

const state = {
  view: 'overview',
  teams: [],
  venues: [],
  matches: [],
  allMatches: [],
  rounds: [],
  relocations: [],
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
  relocations: { title: '换场地', sub: '主队的主场临时不能用时把比赛换到别处，主客关系不变', action: '' },
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
  const payload = await request('/api/relocations');
  state.relocations = payload.relocated;
  renderRelocations();
}

async function loadAllMatches() {
  const payload = await request('/api/matches');
  state.allMatches = payload.matches;
  el('nav-matches').textContent = String(payload.total);
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
      <td>${escapeHtml(item.venueName)}${item.venueChanged ? `<span class="pill moved" title="原场地：${escapeHtml(item.originalVenueName || '主队主场')}">已换场</span>` : ''}</td>
      <td>${statusPill(item.status)}</td>
      <td class="muted">${escapeHtml(item.note)}</td>
      <td>
        ${item.status === '已赛' ? '' : `<button type="button" class="mini" data-result-match="${escapeHtml(item.id)}">登记比分</button>`}
        <button type="button" class="mini" data-relocate-match="${escapeHtml(item.id)}">换场地</button>
        <button type="button" class="mini" data-edit-match="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="mini danger" data-del-match="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('match-empty').classList.toggle('show', state.matches.length === 0);
}

function renderRelocations() {
  const list = state.relocations || [];
  el('nav-relocations').textContent = String(list.length);
  el('relocation-count-hint').textContent = list.length ? `共 ${list.length} 场改过场地，主客关系始终不变` : '';
  el('relocation-rows').innerHTML = list.map((item) => `<tr>
      <td class="num">${item.round}</td>
      <td class="num">${escapeHtml(item.date)}</td>
      <td class="num">${escapeHtml(item.kickoff)}</td>
      <td>${escapeHtml(item.homeName)} <span class="muted">vs</span> ${escapeHtml(item.awayName)}</td>
      <td class="muted">${escapeHtml(item.originalVenueName)}</td>
      <td><strong>${escapeHtml(item.currentVenueName)}</strong></td>
      <td>${statusPill(item.status)}</td>
      <td><button type="button" class="mini" data-revert-match="${escapeHtml(item.id)}">恢复原场地</button></td>
    </tr>`).join('');
  el('relocation-empty').classList.toggle('show', list.length === 0);
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

/* 换场地 */
function venueOptionsHtml(currentId) {
  return optionsHtml(state.venues.map((item) => ({ value: item.id, label: `${item.name}（${item.city}）` })), currentId);
}

function scheduleItemHtml(item, movedId) {
  const isMoved = item.id === movedId || item.moved;
  return `<li class="${isMoved ? 'is-moved' : ''}">
    <span class="kickoff">${escapeHtml(item.kickoff)}</span>
    <span class="vs">${escapeHtml(item.homeName)} <em>vs</em> ${escapeHtml(item.awayName)}</span>
    ${isMoved ? '<span class="tag-moved">本场换入</span>' : statusPill(item.status)}
  </li>`;
}

function clashBoxHtml(change) {
  const other = change.clash.match;
  return `<div class="impact clash">
    <b>同一块场地两场比赛挨得太近</b>
    <ul class="clash-pair">
      <li><span class="kickoff">${escapeHtml(change.kickoff)}</span><span>${escapeHtml(change.homeName)} <em>vs</em> ${escapeHtml(change.awayName)}（本次换入）</span></li>
      <li><span class="kickoff">${escapeHtml(other.kickoff)}</span><span>${escapeHtml(other.homeName)} <em>vs</em> ${escapeHtml(other.awayName)}（已排）</span></li>
    </ul>
    <p class="hint">两场只隔 ${change.clash.gapMinutes} 分钟，至少要隔 ${change.clash.requiredMinutes} 分钟，换过去也不会被接受。</p>
  </div>`;
}

function singleImpactHtml(change) {
  if (!change) return '<div class="impact-placeholder hint">选好新场地后这里会列出更换影响</div>';
  return `<div class="impact">
    <div class="venue-swap">
      <div><span class="hint">原场地</span><strong>${escapeHtml(change.oldVenueName)}</strong></div>
      <span class="swap-arrow">→</span>
      <div><span class="hint">新场地</span><strong>${escapeHtml(change.newVenueName)}</strong></div>
    </div>
    ${change.sameVenue ? '<p class="hint">新场地和现在是同一块，不用更换。</p>' : ''}
    ${change.clash ? clashBoxHtml(change) : ''}
    <div class="impact-block">
      <span class="hint">${escapeHtml(change.date)} 新场地上已经排了 ${change.newVenueDaySchedule.length} 场</span>
      <ul class="schedule">${change.newVenueDaySchedule.length ? change.newVenueDaySchedule.map((item) => scheduleItemHtml(item)).join('') : '<li class="muted">当天还没有别的场次</li>'}</ul>
    </div>
    <div class="impact-block">
      <span class="hint">换完之后这块场地当天的场次顺序</span>
      <ol class="schedule">${change.afterOrder.map((item) => scheduleItemHtml(item, change.matchId)).join('')}</ol>
    </div>
  </div>`;
}

async function refreshSinglePreview(matchId, venueId) {
  const id = matchId || collectForm().payload.matchId;
  const target = venueId || collectForm().payload.venueId;
  const box = el('relocate-impact');
  if (!box) return;
  if (!id || !target) {
    state.relocatePreview = null;
    box.innerHTML = singleImpactHtml(null);
    return;
  }
  box.classList.add('loading');
  try {
    const payload = await request('/api/relocations/preview', {
      method: 'POST',
      body: JSON.stringify({ matchId: id, venueId: target }),
    });
    state.relocatePreview = payload.change;
    box.innerHTML = singleImpactHtml(payload.change);
  } catch (err) {
    state.relocatePreview = null;
    box.innerHTML = `<div class="impact clash"><b>看不了影响</b><p class="hint">${escapeHtml(err.message)}</p></div>`;
  } finally {
    box.classList.remove('loading');
  }
}

function matchOptionsHtml(selectedId) {
  const options = state.allMatches
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.kickoff < b.kickoff ? -1 : 1))
    .map((item) => ({
      value: item.id,
      label: `第${item.round}轮 ${item.date} ${item.kickoff} ${item.homeName} vs ${item.awayName}`,
    }));
  return optionsHtml([{ value: '', label: '请选择要换场地的场次' }].concat(options), selectedId || '');
}

function renderSingleForm(matchId) {
  const match = state.allMatches.find((item) => item.id === matchId);
  const box = el('relocate-impact');
  if (!match) {
    if (box) box.innerHTML = singleImpactHtml(null);
    return;
  }
  state.drawer.title = `换场地：第 ${match.round} 轮 ${match.homeName} vs ${match.awayName}`;
  el('drawer-title').textContent = state.drawer.title;
  const defaultVenue = state.venues.find((item) => item.id !== match.effectiveVenueId) || state.venues[0];
  const form = el('drawer-form');
  form.querySelector('[data-name="venueId"]').innerHTML = venueOptionsHtml(defaultVenue ? defaultVenue.id : '');
  form.querySelector('.match-meta').innerHTML = `
    <div><span class="hint">日期时刻</span><strong>${escapeHtml(match.date)} ${escapeHtml(match.kickoff)}</strong></div>
    <div><span class="hint">对阵（主客不变）</span><strong>${escapeHtml(match.homeName)} <em class="muted">vs</em> ${escapeHtml(match.awayName)}</strong></div>
    <div><span class="hint">当前场地</span><strong>${escapeHtml(match.venueName)}</strong></div>`;
  refreshSinglePreview(match.id, defaultVenue ? defaultVenue.id : '');
}

function openRelocateDrawer(match) {
  state.drawer = { mode: 'single', entity: 'relocate', id: match ? match.id : '', title: '单场换场地' };
  state.relocatePreview = null;
  el('drawer-form').innerHTML = `
    <label class="field"><span>哪一场</span>
      <select data-name="matchId" data-preview="single-pick">${matchOptionsHtml(match ? match.id : '')}</select>
    </label>
    <div class="match-meta"></div>
    <label class="field"><span>换到哪块场地</span>
      <select data-name="venueId" data-preview="single"></select>
    </label>
    <div id="relocate-impact" class="impact-wrap"></div>`;
  showDrawer();
  el('drawer-submit').textContent = '确认换场地';
  renderSingleForm(match ? match.id : '');
}

function teamClashHtml(plan) {
  if (!plan.clashes.length) return '';
  return `<div class="impact clash">
    <b>${plan.clashes.length} 场会和新场地已排的比赛撞在一起（间隔不足两小时）</b>
    <ul class="clash-list">
      ${plan.clashes.map((c) => `<li>
        <div class="clash-date">${escapeHtml(c.date)} ${escapeHtml(c.kickoff)}　${escapeHtml(c.homeName)} <em>vs</em> ${escapeHtml(c.awayName)}</div>
        <div class="muted">撞上 ${escapeHtml(c.clash.match.kickoff)}　${escapeHtml(c.clash.match.homeName)} <em>vs</em> ${escapeHtml(c.clash.match.awayName)}，只隔 ${c.clash.gapMinutes} 分钟</div>
      </li>`).join('')}
    </ul>
    <p class="hint">有冲突时整批都不会更换，先错开时刻或换一块场地。</p>
  </div>`;
}

function teamImpactHtml(plan) {
  if (!plan) return '<div class="impact-placeholder hint">选好球队、时间与新场地后点“查看影响”</div>';
  if (plan.total === 0) return '<div class="impact clash"><b>这段时间没有主场比赛</b><p class="hint">换个时间段，或检查球队有没有选对。</p></div>';
  return `<div class="impact">
    <div class="plan-summary">
      <div><b class="big">${plan.total}</b><span class="hint">场主场要换</span></div>
      <div><span class="hint">涉及场地</span><strong>${plan.involvedVenues.length ? escapeHtml(plan.involvedVenues.map((v) => v.name).join('、')) : '无'}</strong></div>
      <div><span class="hint">统一换到</span><strong>${escapeHtml(plan.newVenueName)}</strong></div>
    </div>
    ${teamClashHtml(plan)}
    <div class="impact-block">
      <span class="hint">逐场影响与换后顺序</span>
      <div class="plan-list">
        ${plan.changes.map((c) => `<details class="plan-day" ${c.clash ? 'open' : ''}>
          <summary class="${c.clash ? 'has-clash' : ''}">
            <span>${escapeHtml(c.date)} ${escapeHtml(c.kickoff)}</span>
            <span>${escapeHtml(c.homeName)} <em>vs</em> ${escapeHtml(c.awayName)}</span>
            <span class="muted">${c.sameVenue ? '已在该场地' : `${escapeHtml(c.oldVenueName)} → ${escapeHtml(c.newVenueName)}`}</span>
          </summary>
          <ol class="schedule">${c.afterOrder.map((item) => scheduleItemHtml(item, c.matchId)).join('')}</ol>
        </details>`).join('')}
      </div>
    </div>
  </div>`;
}

async function refreshTeamPreview() {
  const payload = collectForm().payload;
  const box = el('relocate-impact');
  if (!payload.teamId || !payload.venueId) {
    state.relocatePreview = null;
    if (box) box.innerHTML = teamImpactHtml(null);
    return;
  }
  if (box) box.classList.add('loading');
  try {
    const res = await request('/api/relocations/team/preview', {
      method: 'POST',
      body: JSON.stringify({ teamId: payload.teamId, venueId: payload.venueId, fromDate: payload.fromDate || '', toDate: payload.toDate || '' }),
    });
    state.relocatePreview = res.plan;
    if (box) box.innerHTML = teamImpactHtml(res.plan);
  } catch (err) {
    state.relocatePreview = null;
    if (box) box.innerHTML = `<div class="impact clash"><b>看不了影响</b><p class="hint">${escapeHtml(err.message)}</p></div>`;
  } finally {
    if (box) box.classList.remove('loading');
  }
}

function openTeamRelocateDrawer() {
  state.drawer = { mode: 'team', entity: 'relocate', id: '', title: '整队批量换场地' };
  state.relocatePreview = null;
  const teamOptions = optionsHtml(state.teams.map((item) => ({ value: item.id, label: `${item.name}（${item.shortName}）` })), '');
  el('drawer-form').innerHTML = `
    <label class="field"><span>球队（只换它这段时间的主场）</span>
      <select data-name="teamId" data-preview="team"><option value="">请选择球队</option>${teamOptions}</select>
    </label>
    <div class="field-row">
      <label class="field"><span>开始日期（可留空）</span><input data-name="fromDate" maxlength="10" placeholder="2026-03-28"></label>
      <label class="field"><span>结束日期（可留空）</span><input data-name="toDate" maxlength="10" placeholder="2026-04-30"></label>
    </div>
    <label class="field"><span>统一换到哪块场地</span>
      <select data-name="venueId" data-preview="team"><option value="">请选择场地</option>${state.venues.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(item.city)}）</option>`).join('')}</select>
    </label>
    <button type="button" class="ghost" id="team-preview-btn">查看影响</button>
    <div id="relocate-impact" class="impact-wrap"></div>`;
  showDrawer();
  el('drawer-submit').textContent = '确认整批更换';
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
  el('drawer-submit').textContent = '保存';
  state.drawer = { mode: '', entity: '', id: '', title: '' };
  state.relocatePreview = null;
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
    if (entity === 'relocate') {
      if (mode === 'single') {
        if (!payload.matchId) throw Object.assign(new Error('请先选择要换场地的场次'), { field: 'matchId' });
        if (!payload.venueId) throw Object.assign(new Error('请选择要换到哪块场地'), { field: 'venueId' });
        const preview = state.relocatePreview;
        if (preview && preview.sameVenue) {
          throw new Error('新场地和现在是同一块，换一块场地再提交');
        }
        if (preview && preview.clash) {
          throw new Error('这块场地当天两场比赛间隔不足两小时，按上面列出的冲突调整后再换');
        }
        await request('/api/relocations/apply', {
          method: 'POST',
          body: JSON.stringify({ matchId: payload.matchId, venueId: payload.venueId }),
        });
        toast('场地已更换，主客关系不变', 'ok');
      } else if (mode === 'team') {
        if (!payload.teamId) throw Object.assign(new Error('请选择要换主场的球队'), { field: 'teamId' });
        if (!payload.venueId) throw Object.assign(new Error('请选择统一换到哪块场地'), { field: 'venueId' });
        const res = await request('/api/relocations/team/apply', {
          method: 'POST',
          body: JSON.stringify({
            teamId: payload.teamId,
            venueId: payload.venueId,
            fromDate: payload.fromDate || '',
            toDate: payload.toDate || '',
          }),
        });
        toast(`已更换 ${res.changedCount} 场主场，涉及 ${res.plan.involvedVenues.length} 块场地`, 'ok');
      }
      await Promise.all([loadRelocations(), loadMatches().catch(() => {}), loadSummary()]);
      if (state.allMatches.length) await loadAllMatches();
      closeDrawer();
      return;
    }
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
      } else {
        const body = { ...payload, round: Number(payload.round) };
        if (mode === 'edit') await request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
        else await request('/api/matches', { method: 'POST', body: JSON.stringify(body) });
        toast(mode === 'edit' ? '赛程已保存' : '赛程已新增', 'ok');
      }
      await Promise.all([loadMatches(), loadSummary()]);
      if (state.view === 'table') await loadStandings();
    }
    closeDrawer();
  } catch (err) {
    toast(err.message, 'bad');
    markField(err.field);
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

  try {
    if (view === 'overview') await loadSummary();
    if (view === 'teams') { await Promise.all([loadVenues(), loadTeams()]); }
    if (view === 'venues') await loadVenues();
    if (view === 'matches') { await Promise.all([loadTeams(), loadMatches()]); }
    if (view === 'relocations') { await Promise.all([loadVenues(), loadAllMatches(), loadRelocations()]); }
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

el('relocate-single').addEventListener('click', () => openRelocateDrawer(null));
el('relocate-team').addEventListener('click', openTeamRelocateDrawer);

// 抽屉里换场地表单的联动预览
el('drawer-form').addEventListener('change', (event) => {
  const node = event.target;
  if (state.drawer.entity !== 'relocate') return;
  if (node.dataset.preview === 'single') {
    refreshSinglePreview().catch((err) => toast(err.message, 'bad'));
  } else if (node.dataset.preview === 'single-pick') {
    renderSingleForm(node.value);
  } else if (node.dataset.preview === 'team') {
    refreshTeamPreview().catch((err) => toast(err.message, 'bad'));
  }
});
el('drawer-form').addEventListener('click', (event) => {
  if (event.target.closest('#team-preview-btn')) {
    refreshTeamPreview().catch((err) => toast(err.message, 'bad'));
  }
});

async function ensureAllMatches() {
  if (!state.allMatches.length) await loadAllMatches();
}

document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  if (node.dataset.editTeam) return openDrawerFor('teams', node.dataset.editTeam);
  if (node.dataset.editVenue) return openDrawerFor('venues', node.dataset.editVenue);
  if (node.dataset.editMatch) return openDrawerFor('matches', node.dataset.editMatch);
  if (node.dataset.relocateMatch) {
    await ensureAllMatches();
    return openRelocateDrawer(state.allMatches.find((item) => item.id === node.dataset.relocateMatch));
  }
  if (node.dataset.revertMatch) {
    if (!window.confirm('确定把这场恢复到它最初的场地吗？')) return;
    try {
      await request(`/api/matches/${encodeURIComponent(node.dataset.revertMatch)}/revert-venue`, { method: 'POST' });
      toast('已恢复到原场地', 'ok');
      await Promise.all([loadRelocations(), loadAllMatches(), loadMatches().catch(() => {}), loadSummary()]);
    } catch (err) {
      toast(err.message, 'bad');
    }
    return;
  }
  if (node.dataset.resultMatch) {
    await ensureAllMatches();
    return openResultDrawer(state.allMatches.find((item) => item.id === node.dataset.resultMatch));
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
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, el('operator').value.trim());
});

async function boot() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
  await loadHealth();
  await switchView('overview');
}

boot();
