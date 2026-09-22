// 换场地：单场更换与按球队批量更换。主客关系不动，只改场地；
// 换完同一块场地同一天的两场至少要隔两小时，撞上时报出撞的是哪两场
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');
const { nameMaps } = require('./standings');
const { resolveVenueId, decorate, checkDate, minutesOf, MIN_GAP_MINUTES } = require('./matches');

const MOVABLE_STATUS = ['待赛', '延期'];

// 一场比赛的称呼：第几轮、谁对谁、几点开球，用于提示与预览
function matchLabel(match, teams) {
  const home = teams.get(match.homeTeamId);
  const away = teams.get(match.awayTeamId);
  return `第 ${match.round} 轮 ${home ? home.name : '未知球队'} vs ${away ? away.name : '未知球队'}（${match.kickoff}）`;
}

// 在同一天同一块场地的场次里，找出间隔不到两小时的对子；entries 形如 [{ match }]
function findClashes(entries) {
  const sorted = entries.slice().sort((a, b) => minutesOf(a.match.kickoff) - minutesOf(b.match.kickoff));
  const clashes = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const gap = minutesOf(sorted[j].match.kickoff) - minutesOf(sorted[i].match.kickoff);
      if (gap >= MIN_GAP_MINUTES) break;
      clashes.push({ a: sorted[i].match, b: sorted[j].match, gap });
    }
  }
  return clashes;
}

// 撞场提示：把撞上的每一对都写清楚是哪两场、隔了几分钟
function clashMessage(clashes, teams, venueName) {
  const pairs = clashes.map((c) => `${c.a.date} 的 ${matchLabel(c.a, teams)} 与 ${matchLabel(c.b, teams)} 只隔 ${c.gap} 分钟`);
  return `换不过去：${venueName} 同一天的场次至少要隔两小时，撞上 ${clashes.length} 对 — ${pairs.join('；')}`;
}

function teamMapOf(data) {
  return new Map(data.teams.map((item) => [item.id, item]));
}

// 单场更换的共用检查：场次在不在、状态能不能换、新场地认不认识、是不是同一块、撞不撞
function prepareSingle(data, matchId, venueId) {
  const match = data.matches.find((item) => item.id === matchId);
  if (!match) throw new ApiError(404, 'MATCH_NOT_FOUND', '这场赛程不存在或已被删除', '');
  if (!MOVABLE_STATUS.includes(match.status)) {
    throw new ApiError(409, 'MATCH_NOT_MOVABLE', `这场已经是「${match.status}」状态，只有待赛或延期的场次才能换场地`, '');
  }
  const venue = data.venues.find((item) => item.id === venueId);
  if (!venue) throw new ApiError(404, 'VENUE_NOT_FOUND', '这块场地没有登记过', 'venueId');
  const fromVenueId = resolveVenueId(match, data);
  if (fromVenueId === venueId) {
    throw new ApiError(400, 'VENUE_SAME', '这场本来就排在这块场地，换一块别的', 'venueId');
  }
  const sameDay = data.matches.filter((item) => item.id !== match.id && item.date === match.date
    && item.status !== '取消' && resolveVenueId(item, data) === venueId);
  const clashes = findClashes(sameDay.concat([match]).map((item) => ({ match: item })));
  return { match, venue, fromVenueId, sameDay, clashes };
}

// 批量更换的共用检查：球队、时间段、新场地，再把整批放到一起模拟撞场
function prepareTeamBatch(data, teamId, body) {
  const team = data.teams.find((item) => item.id === teamId);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', '这支球队没有登记过', '');
  const venueId = pickText(body && body.venueId);
  if (!venueId) throw new ApiError(400, 'VENUE_REQUIRED', '先选一块新场地', 'venueId');
  const venue = data.venues.find((item) => item.id === venueId);
  if (!venue) throw new ApiError(404, 'VENUE_NOT_FOUND', '这块场地没有登记过', 'venueId');
  const fromDate = checkDate(body && body.fromDate, 'fromDate');
  const toDate = checkDate(body && body.toDate, 'toDate');
  if (fromDate > toDate) {
    throw new ApiError(400, 'RANGE_INVALID', '开始日期不能晚于结束日期', 'fromDate');
  }

  const inRange = data.matches.filter((item) => item.homeTeamId === team.id
    && item.date >= fromDate && item.date <= toDate);
  const skipped = {
    played: inRange.filter((item) => item.status === '已赛').length,
    cancelled: inRange.filter((item) => item.status === '取消').length,
    alreadyAtVenue: 0,
  };
  const movable = [];
  inRange.filter((item) => MOVABLE_STATUS.includes(item.status)).forEach((item) => {
    if (resolveVenueId(item, data) === venue.id) skipped.alreadyAtVenue += 1;
    else movable.push(item);
  });
  if (movable.length === 0) {
    const why = skipped.alreadyAtVenue > 0
      ? `这段时间里 ${team.name} 的主场比赛本来就在 ${venue.name}，不用换`
      : `${fromDate} 到 ${toDate} 之间 ${team.name} 没有待赛或延期的主场比赛`;
    throw new ApiError(404, 'NO_MOVABLE_MATCHES', why, '');
  }

  // 逐天模拟：这天新场地上已有的（未取消、不在本批里）加上本批换过来的，一起查间隔
  const movedIds = new Set(movable.map((item) => item.id));
  const dates = Array.from(new Set(movable.map((item) => item.date)));
  const clashes = [];
  dates.forEach((date) => {
    const existing = data.matches.filter((item) => !movedIds.has(item.id) && item.date === date
      && item.status !== '取消' && resolveVenueId(item, data) === venue.id);
    const moved = movable.filter((item) => item.date === date);
    clashes.push(...findClashes(existing.concat(moved).map((item) => ({ match: item }))));
  });

  const fromVenueIds = Array.from(new Set(movable.map((item) => resolveVenueId(item, data))));
  return { team, venue, fromDate, toDate, movable, skipped, clashes, fromVenueIds };
}

function briefOf(match, teams) {
  const home = teams.get(match.homeTeamId);
  const away = teams.get(match.awayTeamId);
  return {
    id: match.id,
    round: match.round,
    date: match.date,
    kickoff: match.kickoff,
    homeName: home ? home.name : '未知球队',
    awayName: away ? away.name : '未知球队',
  };
}

function briefClashes(clashes, teams) {
  return clashes.map((c) => ({ gap: c.gap, a: briefOf(c.a, teams), b: briefOf(c.b, teams) }));
}

// 单场预览：原场地与新场地、当天新场地已排的场次、换后当天的场次顺序、撞场对子
function previewRelocation(matchId, body) {
  const data = load();
  const venueId = pickText(body && body.venueId);
  if (!venueId) throw new ApiError(400, 'VENUE_REQUIRED', '先选一块新场地', 'venueId');
  const { match, venue, fromVenueId, sameDay, clashes } = prepareSingle(data, matchId, venueId);
  const teams = teamMapOf(data);
  const fromVenue = data.venues.find((item) => item.id === fromVenueId);
  const orderAfter = sameDay.concat([match])
    .sort((a, b) => minutesOf(a.kickoff) - minutesOf(b.kickoff))
    .map((item) => ({ ...briefOf(item, teams), isSelf: item.id === match.id }));
  return {
    match: briefOf(match, teams),
    fromVenue: { id: fromVenueId, name: fromVenue ? fromVenue.name : '未指定场地' },
    toVenue: { id: venue.id, name: venue.name },
    sameDay: sameDay
      .sort((a, b) => minutesOf(a.kickoff) - minutesOf(b.kickoff))
      .map((item) => briefOf(item, teams)),
    orderAfter,
    clashes: briefClashes(clashes, teams),
  };
}

// 单场落子：只改场地并记下换场痕迹，主客关系不动
function relocateMatch(matchId, body) {
  const data = load();
  const venueId = pickText(body && body.venueId);
  if (!venueId) throw new ApiError(400, 'VENUE_REQUIRED', '先选一块新场地', 'venueId');
  const { match, venue, fromVenueId, clashes } = prepareSingle(data, matchId, venueId);
  if (clashes.length > 0) {
    throw new ApiError(409, 'VENUE_TIME_CONFLICT', clashMessage(clashes, teamMapOf(data), venue.name), 'venueId');
  }
  if (!match.venueRelocated) match.venueFrom = fromVenueId;
  match.venueId = venue.id;
  match.venueRelocated = true;
  match.updatedAt = new Date().toISOString();
  save(data);
  const { teams, venues } = nameMaps();
  return decorate(match, teams, venues);
}

// 批量预览：一共换几场、每场原来在哪、涉及到哪几块场地、整批撞不撞
function previewTeamRelocation(teamId, body) {
  const data = load();
  const prep = prepareTeamBatch(data, teamId, body || {});
  const teams = teamMapOf(data);
  const venueName = (id) => {
    const found = data.venues.find((item) => item.id === id);
    return found ? found.name : '未指定场地';
  };
  return {
    team: { id: prep.team.id, name: prep.team.name },
    fromDate: prep.fromDate,
    toDate: prep.toDate,
    toVenue: { id: prep.venue.id, name: prep.venue.name },
    count: prep.movable.length,
    matches: prep.movable
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1) || (minutesOf(a.kickoff) - minutesOf(b.kickoff)))
      .map((item) => ({ ...briefOf(item, teams), fromVenueName: venueName(resolveVenueId(item, data)) })),
    fromVenues: prep.fromVenueIds.map((id) => ({ id, name: venueName(id) })),
    skipped: prep.skipped,
    clashes: briefClashes(prep.clashes, teams),
  };
}

// 批量落子：整批一起换，任何一对撞场都整批退回
function relocateTeamHomeMatches(teamId, body) {
  const data = load();
  const prep = prepareTeamBatch(data, teamId, body || {});
  if (prep.clashes.length > 0) {
    throw new ApiError(409, 'VENUE_TIME_CONFLICT', clashMessage(prep.clashes, teamMapOf(data), prep.venue.name), 'venueId');
  }
  const now = new Date().toISOString();
  prep.movable.forEach((item) => {
    if (!item.venueRelocated) item.venueFrom = resolveVenueId(item, data);
    item.venueId = prep.venue.id;
    item.venueRelocated = true;
    item.updatedAt = now;
  });
  save(data);
  const { teams, venues } = nameMaps();
  const venueName = (id) => {
    const found = venues.get(id);
    return found ? found.name : '未指定场地';
  };
  return {
    changed: prep.movable.length,
    toVenue: { id: prep.venue.id, name: prep.venue.name },
    venuesInvolved: prep.fromVenueIds.map((id) => venueName(id)),
    matches: prep.movable.map((item) => decorate(item, teams, venues)),
  };
}

// 换过场地的场次单独列出，供页面置顶展示
function listRelocations() {
  const data = load();
  const { teams, venues } = nameMaps();
  const list = data.matches
    .filter((item) => item.venueRelocated)
    .sort((a, b) => (a.date < b.date ? -1 : 1) || (minutesOf(a.kickoff) - minutesOf(b.kickoff)) || (a.round - b.round))
    .map((item) => decorate(item, teams, venues));
  return { relocations: list, total: list.length };
}

module.exports = {
  previewRelocation,
  relocateMatch,
  previewTeamRelocation,
  relocateTeamHomeMatches,
  listRelocations,
};
