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

function create({ settings, library, achievements, profiles }) {
  const boards = () => {
    const a = settings.get('arcade') || {};
    if (!a.scores) a.scores = {};
    if (!settings.get('arcade')) settings.data.arcade = a;
    return a.scores;
  };
  const view = (key) => (boards()[key] || []).map((r, i) => {
    const p = profiles().find((x) => x.id === r.pid);
    return { rank: i + 1, score: r.score, at: r.at, pid: r.pid, gamertag: p ? p.gamertag : 'Former player', avatar: p ? p.avatar : 0 };
  });

  return {
    CATALOG,
    scanner: { scan: async () => ({ ok: true, games: CATALOG.map(entryFor) }) },

    board(key) { return view(key); },

    // A finished run: playtime for the active profile, leaderboard, achievements.
    finish(key, { seconds = 0, score = 0, stats = {} } = {}, pid) {
      const id = `arcade:${key}`;
      if (!CATALOG.some((c) => c.key === key)) throw new Error('Unknown arcade game');
      if (seconds > 0) library.recordSession(id, Math.round(seconds));
      const list = boards()[key] || (boards()[key] = []);
      const prevBest = list.filter((r) => r.pid === pid).reduce((m, r) => Math.max(m, r.score), 0);
      let rank = 0;
      if (score > 0) {
        list.push({ pid, score: Math.round(score), at: Date.now() });
        list.sort((a, b) => b.score - a.score || a.at - b.at);
        list.length = Math.min(list.length, BOARD_SIZE);
        const i = list.findIndex((r) => r.pid === pid && r.score === Math.round(score));
        rank = i >= 0 ? i + 1 : 0;
        settings.save();
      }
      const played = new Set([...(settings.get('arcade.played') || []), key]);
      settings.data.arcade.played = [...played];
      settings.save();
      achievements.track('arcade', { game: key, score, stats, played: [...played], top: rank === 1, total: CATALOG.length });
      return { rank, personalBest: score > prevBest, prevBest, board: view(key) };
    },
  };
}

module.exports = { create, CATALOG };
