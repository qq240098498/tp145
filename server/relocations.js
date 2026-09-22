// 换场地：只改比赛实际使用的场地，主客、日期、时刻都不动。
// 单场与整队批量共用同一套影响测算：给出原场地、新场地、当天新场地已排的场次、
// 换完之后这块场地当天的场次顺序，以及两场间隔不足两小时时的当场冲突提示。
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { resolveVenueId, minutesOf, MIN_GAP_MINUTES } = require('./matches');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value, field) {
  const date = pickText(value);
  if (!DATE_PATTERN.test(date)) {
    throw new ApiError(400, 'DATE_INVALID', '日期要写成四位年加短横线加两位月日，例如 2026-03-14', field || 'date');
  }
  const [year, month, day] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new ApiError(400, 'DATE_INVALID', '这个日期不存在，请检查月份与日', field || 'date');
  }
  return date;
}

function venueNameOf(data, venueId) {
  const venue = data.venues.find((item) => item.id === venueId);
  return venue ? venue.name : '';
}

function briefMatch(match, data) {
  const home = data.teams.find((item) => item.id === match.homeTeamId);
  const away = data.teams.find((item) => item.id === match.awayTeamId);
  return {
    id: match.id,
    round: match.round,
    date: match.date,
    kickoff: match.kickoff,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeName: home ? home.name : '未知球队',
    awayName: away ? away.name : '未知球队',
    status: match.status,
  };
}

// 某块场地某一天的场次，按开赛时刻排好；取消的场次不占位
function dayOrder(venueId, date, data, options) {
  const opts = options || {};
  return data.matches
    .filter((item) => item.date === date
      && resolveVenueId(item, data) === venueId
      && item.status !== '取消'
      && item.id !== opts.excludeId)
    .slice()
    .sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : 0))
    .map((item) => ({ ...briefMatch(item, data), venueChanged: item.venueChanged === true }));
}

// 换入这场之后，与新场地上已有的哪一场间隔不足两小时
function clashAgainst(venueId, date, kickoff, ignoreId, data) {
  const neighbors = data.matches.filter((item) => item.id !== ignoreId
    && item.date === date
    && resolveVenueId(item, data) === venueId
    && item.status !== '取消');
  const found = neighbors.find((item) => Math.abs(minutesOf(item.kickoff) - minutesOf(kickoff)) < MIN_GAP_MINUTES);
  if (!found) return null;
  return {
    match: briefMatch(found, data),
    kickoff: found.kickoff,
    gapMinutes: Math.abs(minutesOf(found.kickoff) - minutesOf(kickoff)),
    requiredMinutes: MIN_GAP_MINUTES,
  };
}

// 算一场比赛换到新场地之后的完整影响（不落盘）
function buildChange(match, newVenueId, data) {
  const oldVenueId = resolveVenueId(match, data);
  const sameVenue = oldVenueId === newVenueId;
  const moved = {
    ...briefMatch(match, data),
    effectiveVenueId: newVenueId,
    venueName: venueNameOf(data, newVenueId) || '未指定',
  };

  // 换完之后新场地当天的顺序：把这场插进去一起排
  const afterOrder = dayOrder(newVenueId, match.date, data, { excludeId: match.id })
    .concat([{ ...moved, venueChanged: !sameVenue, moved: !sameVenue }])
    .sort((a, b) => (a.kickoff < b.kickoff ? -1 : a.kickoff > b.kickoff ? 1 : 0));

  // 换入这场之后，与新场地上已有的哪一场间隔不足两小时；
  // 本来就在这块场地的比赛不算换场，既不改动也不把历史遗留的场地排布算成这次的冲突
  const clash = oldVenueId === newVenueId
    ? null
    : clashAgainst(newVenueId, match.date, match.kickoff, match.id, data);

  return {
    matchId: match.id,
    date: match.date,
    kickoff: match.kickoff,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeName: moved.homeName,
    awayName: moved.awayName,
    round: match.round,
    status: match.status,
    oldVenueId: oldVenueId,
    oldVenueName: venueNameOf(data, oldVenueId) || '未指定',
    newVenueId,
    newVenueName: venueNameOf(data, newVenueId) || '未指定',
    sameVenue: oldVenueId === newVenueId,
    // 新场地当天已经排好的场次（不含本场）
    newVenueDaySchedule: dayOrder(newVenueId, match.date, data, { excludeId: match.id }),
    afterOrder,
    clash,
  };
}

function readTargetVenue(payload, data) {
  const venueId = pickText(payload && payload.venueId);
  if (!venueId) throw new ApiError(400, 'VENUE_REQUIRED', '请选择要换到哪块场地', 'venueId');
  if (!data.venues.some((item) => item.id === venueId)) {
    throw new ApiError(404, 'VENUE_NOT_FOUND', '这个场地没有登记过', 'venueId');
  }
  return venueId;
}

// 单场换场地：先看影响
function previewRelocation(payload) {
  const data = load();
  const matchId = pickText(payload && payload.matchId);
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', 'matchId');
  const venueId = readTargetVenue(payload, data);
  return { change: buildChange(match, venueId, data) };
}

// 单场换场地：正式落盘
function applyRelocation(payload) {
  const data = load();
  const matchId = pickText(payload && payload.matchId);
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', 'matchId');
  const venueId = readTargetVenue(payload, data);

  const change = buildChange(match, venueId, data);
  if (change.clash) {
    const other = change.clash.match;
    const err = new ApiError(409, 'RELOCATION_CLASH',
      `${change.date} 这块场地的 ${match.kickoff}（${change.homeName} vs ${change.awayName}）与 ${other.kickoff} 的 ${other.homeName} vs ${other.awayName} 只隔 ${change.clash.gapMinutes} 分钟，两场之间至少要隔两小时`,
      'venueId');
    err.details = { clashes: [change.clash] };
    throw err;
  }
  if (!change.sameVenue) {
    // 第一次换走时把最初场地留住；重复换场时最初场地保持不变
    if (!match.venueChanged) {
      match.originalVenueId = match.venueId || '';
    }
    match.venueId = venueId;
    match.venueChanged = true;
    match.updatedAt = new Date().toISOString();
    save(data);
  }
  return { change: buildChange(data.matches.find((item) => item.id === matchId), venueId, data), applied: true };
}

// 把一场恢复到它最初的场地
function revertRelocation(matchId) {
  const data = load();
  const id = pickText(matchId);
  const match = data.matches.find((item) => item.id === id);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  if (!match.venueChanged) {
    throw new ApiError(400, 'NOT_RELOCATED', '这场没有换过场地，不用恢复', '');
  }
  const targetVenueId = match.originalVenueId || (() => {
    const home = data.teams.find((item) => item.id === match.homeTeamId);
    return home ? home.venueId : '';
  })();

  const clash = clashAgainst(targetVenueId, match.date, match.kickoff, match.id, data);
  if (clash) {
    const other = clash.match;
    const err = new ApiError(409, 'RELOCATION_CLASH',
      `恢复到原场地后，${match.date} 的 ${match.kickoff} 与 ${other.kickoff} 的 ${other.homeName} vs ${other.awayName} 只隔 ${clash.gapMinutes} 分钟，先错开时间再恢复`,
      '');
    err.details = { clashes: [clash] };
    throw err;
  }

  match.venueId = match.originalVenueId || '';
  match.venueChanged = false;
  match.originalVenueId = '';
  match.updatedAt = new Date().toISOString();
  save(data);
  return {
    matchId: match.id,
    venueId: match.venueId,
    venueName: venueNameOf(data, resolveVenueId(match, data)) || '未指定',
  };
}

// 挑出某支球队在一段时间里的全部主场
function selectTeamHomeMatches(data, teamId, fromDate, toDate) {
  return data.matches
    .filter((item) => item.homeTeamId === teamId
      && item.status !== '取消'
      && (!fromDate || item.date >= fromDate)
      && (!toDate || item.date <= toDate))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.kickoff < b.kickoff ? -1 : 1));
}

function readTeamWindow(payload, data) {
  const teamId = pickText(payload && payload.teamId);
  if (!teamId) throw new ApiError(400, 'TEAM_REQUIRED', '请选择要换主场的球队', 'teamId');
  const team = data.teams.find((item) => item.id === teamId);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队没有登记过', 'teamId');
  const fromDate = payload && payload.fromDate ? checkDate(payload.fromDate, 'fromDate') : '';
  const toDate = payload && payload.toDate ? checkDate(payload.toDate, 'toDate') : '';
  if (fromDate && toDate && fromDate > toDate) {
    throw new ApiError(400, 'DATE_RANGE_INVALID', '开始日期不能晚于结束日期', 'fromDate');
  }
  return { team, fromDate, toDate };
}

function buildTeamPlan(data, team, matches, venueId) {
  const changes = matches.map((item) => buildChange(item, venueId, data));
  // 涉及到的原场地按出现顺序去重；本来就在新场地的场次不换，不计入
  const venueIds = [];
  changes.forEach((item) => {
    if (!item.sameVenue && item.oldVenueId && !venueIds.includes(item.oldVenueId)) venueIds.push(item.oldVenueId);
  });
  return {
    teamId: team.id,
    teamName: team.name,
    newVenueId: venueId,
    newVenueName: venueNameOf(data, venueId) || '未指定',
    fromDate: changes.length ? changes[0].date : '',
    toDate: changes.length ? changes[changes.length - 1].date : '',
    total: changes.length,
    changes,
    clashes: changes.filter((item) => item.clash),
    involvedVenues: venueIds.map((id) => ({ id, name: venueNameOf(data, id) || '未指定' })),
  };
}

// 整队换场地：先看影响（几场、涉及哪几块场地、每场的顺序与冲突）
function previewTeamRelocations(payload) {
  const data = load();
  const { team, fromDate, toDate } = readTeamWindow(payload, data);
  const venueId = readTargetVenue(payload, data);
  const matches = selectTeamHomeMatches(data, team.id, fromDate, toDate);
  return { plan: buildTeamPlan(data, team, matches, venueId) };
}

// 整队换场地：正式落盘。有任意一场撞场地就整批不写，并把撞的两场逐场列出来
function applyTeamRelocations(payload) {
  const data = load();
  const { team, fromDate, toDate } = readTeamWindow(payload, data);
  const venueId = readTargetVenue(payload, data);
  const matches = selectTeamHomeMatches(data, team.id, fromDate, toDate);
  if (matches.length === 0) {
    throw new ApiError(400, 'NO_HOME_MATCH', '这段时间里这支球队没有主场比赛可换', 'teamId');
  }

  const plan = buildTeamPlan(data, team, matches, venueId);
  if (plan.clashes.length > 0) {
    const lines = plan.clashes.map((item) => {
      const other = item.clash.match;
      return `${item.date} ${item.kickoff} ${item.homeName} vs ${item.awayName} 与 ${other.kickoff} ${other.homeName} vs ${other.awayName} 只隔 ${item.clash.gapMinutes} 分钟`;
    });
    const err = new ApiError(409, 'RELOCATION_CLASH',
      `有 ${plan.clashes.length} 场和新场地已排的比赛间隔不足两小时，本次整批未更换：\n${lines.join('\n')}`,
      'venueId');
    err.details = { clashes: plan.clashes.map((item) => item.clash), total: plan.total };
    throw err;
  }

  const now = new Date().toISOString();
  let changedCount = 0;
  matches.forEach((match) => {
    const oldVenueId = resolveVenueId(match, data);
    if (oldVenueId === venueId) return;
    if (!match.venueChanged) match.originalVenueId = match.venueId || '';
    match.venueId = venueId;
    match.venueChanged = true;
    match.updatedAt = now;
    changedCount += 1;
  });
  save(data);

  const after = buildTeamPlan(data, team, selectTeamHomeMatches(data, team.id, fromDate, toDate), venueId);
  return { plan: after, applied: true, changedCount };
}

// 改过场地的场次单独列出来
function listRelocations() {
  const data = load();
  const relocated = data.matches
    .filter((item) => item.venueChanged === true)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.kickoff < b.kickoff ? -1 : 1))
    .map((item) => {
      const home = data.teams.find((t) => t.id === item.homeTeamId);
      const away = data.teams.find((t) => t.id === item.awayTeamId);
      const current = resolveVenueId(item, data);
      const originalName = item.originalVenueId
        ? venueNameOf(data, item.originalVenueId)
        : (home && home.venueId ? venueNameOf(data, home.venueId) : '');
      return {
        id: item.id,
        round: item.round,
        date: item.date,
        kickoff: item.kickoff,
        homeName: home ? home.name : '未知球队',
        awayName: away ? away.name : '未知球队',
        status: item.status,
        currentVenueId: current,
        currentVenueName: venueNameOf(data, current) || '未指定',
        originalVenueId: item.originalVenueId,
        originalVenueName: originalName || '主队主场',
      };
    });
  return { total: relocated.length, relocated };
}

module.exports = {
  previewRelocation,
  applyRelocation,
  revertRelocation,
  previewTeamRelocations,
  applyTeamRelocations,
  listRelocations,
};
