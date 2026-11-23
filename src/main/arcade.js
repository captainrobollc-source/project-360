// Built-in arcade: original mini games that live inside the dashboard. They appear in the
// library like any game (source "arcade"), keep playtime, and share one leaderboard per game
// across every profile on this console.
const CATALOG = [
  {
    key: 'pulse', title: 'Pulse Arena', year: 2026, genre: 'Twin-stick shooter', players: '1 player',
    description: 'Hold the line inside a ring of light. Steer with the left stick, fire with the right, and chain kills without getting hit to build your multiplier. Bombs clear the screen when it gets crowded.',
  },
  {
    key: 'prism', title: 'Prism Breaker', year: 2026, genre: 'Brick breaker', players: '1 player',
    description: 'Bounce a ball of light through walls of glass. Catch power-ups for multi-ball, a wider paddle and lasers, and clear each level without dropping a ball for a perfect bonus.',
  },
  {
    key: 'glow', title: 'Glow Link', year: 2026, genre: 'Puzzle', players: '1 player',
    description: 'Swap glowing orbs to line up three or more. Big matches make special orbs, cascades multiply your score, and a two-minute Blitz decides who tops the board.',
  },
  {
    key: 'ribbon', title: 'Ribbon Rivals', year: 2026, genre: 'Party', players: '1-4 players',
    description: 'Ride a ribbon of light through a neon arena and make sure everyone else crashes first. Slip through the gaps, boost past your rivals and climb the solo Gauntlet, or bring up to three friends for a first-to-five party.',
  },
  {
    key: 'lumen', title: 'Lumen Run', year: 2026, genre: 'Tunnel runner', players: '1 player',
    description: 'Race down a tunnel of light as rings, spinning bars and pulsing gates rush at you. Collect shards without missing one to build your chain, skim walls for graze bonuses, and hold A to phase through when there’s no way around.',
  },
  {
    key: 'golf', title: 'Orbit Golf', year: 2026, genre: 'Mini golf', players: '1 player',
    description: 'Putt across nine neon holes built into a space station. Bank off rails and bumpers, ride conveyor belts, dodge blast doors and hull breaches, and bend your shot around a planet’s gravity to sink it in as few strokes as you can.',
  },
];
const BOARD_SIZE = 10;

const entryFor = (c) => ({
  id: `arcade:${c.key}`,
  title: c.title,
  sortTitle: c.title.toLowerCase(),
  source: 'arcade',
  launch: { type: 'arcade', target: c.key },
  watch: { dirs: [], exes: [] },
  meta: { description: c.description, genres: [c.genre], developer: 'Project 360', publisher: 'Project 360', year: c.year, players: c.players },
});

function create({ settings, library, achievements, profiles, withProfile }) {
  const boards = () => {
    if (!settings.data.arcade) settings.data.arcade = {};
    if (!settings.data.arcade.scores) settings.data.arcade.scores = {};
    return settings.data.arcade.scores;
  };
  const view = (key) => (boards()[key] || []).map((r, i) => {
    const p = profiles().find((x) => x.id === r.pid);
    return { rank: i + 1, score: r.score, at: r.at, pid: r.pid, gamertag: p ? p.gamertag : 'Former player', avatar: p ? p.avatar : 0 };
  });
  // Per-profile arcade stats (best score per game, games played) live with that profile's data.
  const statsOf = (pid) => withProfile(pid, () => {
    const d = library.profileData();
    d.stats = d.stats || {};
    d.stats.arcade = d.stats.arcade || { best: {}, played: [] };
    return d.stats.arcade;
  });

  return {
    CATALOG,
    scanner: { scan: async () => ({ ok: true, games: CATALOG.map(entryFor) }) },

    // The shared leaderboard plus this player's own best (which may be off the top 10).
    board(key, pid) {
      const board = view(key);
      const own = pid ? statsOf(pid).best[key] || 0 : 0;
      const onBoard = board.filter((r) => r.pid === pid).reduce((m, r) => Math.max(m, r.score), 0);
      return { rows: board, best: Math.max(own, onBoard) };
    },

    // A finished run, credited to the player who started it (pid), not whoever is active now.
    finish(key, { seconds = 0, score = 0, stats = {} } = {}, pid) {
      if (!CATALOG.some((c) => c.key === key)) throw new Error('Unknown arcade game');
      if (!profiles().some((p) => p.id === pid)) throw new Error('Unknown profile');
      const id = `arcade:${key}`;
      score = Math.max(0, Math.round(Number(score) || 0));
      return withProfile(pid, () => {
        if (seconds > 0) library.recordSession(id, Math.round(seconds));
        const mine = statsOf(pid);
        const prevBest = mine.best[key] || 0;
        if (score > prevBest) mine.best[key] = score;
        mine.played = [...new Set([...(mine.played || []), key])];
        library.user.save();

        const list = boards()[key] || (boards()[key] = []);
        let rank = 0;
        if (score > 0) {
          const entry = { pid, score, at: Date.now() };
          list.push(entry);
          list.sort((a, b) => b.score - a.score || a.at - b.at);
          list.length = Math.min(list.length, BOARD_SIZE);
          rank = list.indexOf(entry) + 1; // 0 when it didn't make the board
          settings.save();
        }
        achievements.track('arcade', { game: key, score, stats, played: mine.played, top: rank === 1, total: CATALOG.length });
        return { rank, personalBest: score > prevBest && score > 0, prevBest, best: Math.max(prevBest, score), board: view(key) };
      });
    },
  };
}
module.exports = { create, CATALOG };
