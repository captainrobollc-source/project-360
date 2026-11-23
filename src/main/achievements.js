// Console achievements + gamerscore, earned by using Project 360 (stored per profile).
const { EventEmitter } = require('events');

const DEFS = [
  { id: 'power-on', title: 'Power On', desc: 'Start Project 360 for the first time.', points: 10, icon: 'power' },
  { id: 'signed-in', title: 'Signed In', desc: 'Sign in to your profile.', points: 5, icon: 'user' },
  { id: 'game-on', title: 'Game On', desc: 'Launch your first game.', points: 15, icon: 'controller' },
  { id: 'regular', title: 'Regular', desc: 'Play 10 sessions.', points: 20, icon: 'controller' },
  { id: 'devoted', title: 'Devoted', desc: 'Play 50 sessions.', points: 40, icon: 'trophy' },
  { id: 'one-more-turn', title: 'One More Turn', desc: 'Play a single session for an hour.', points: 15, icon: 'clock' },
  { id: 'marathon', title: 'Marathon', desc: 'Play a single session for 3 hours.', points: 40, icon: 'clock' },
  { id: 'night-owl', title: 'Night Owl', desc: 'Start playing between midnight and 5 AM.', points: 20, icon: 'sleep' },
  { id: 'early-bird', title: 'Early Bird', desc: 'Start playing between 5 and 8 AM.', points: 15, icon: 'star' },
  { id: 'ten-hours', title: 'Ten Hours In', desc: 'Play for 10 hours in total.', points: 25, icon: 'clock' },
  { id: 'fifty-hours', title: 'Fifty Hours', desc: 'Play for 50 hours in total.', points: 50, icon: 'clock' },
  { id: 'centurion', title: 'Centurion', desc: 'Play for 100 hours in total.', points: 100, icon: 'crown' },
  { id: 'collector', title: 'Collector', desc: 'Have 10 games in your library.', points: 15, icon: 'grid' },
  { id: 'curator', title: 'Curator', desc: 'Have 25 games in your library.', points: 30, icon: 'grid' },
  { id: 'archivist', title: 'Archivist', desc: 'Have 50 games in your library.', points: 50, icon: 'grid' },
  { id: 'hoarder', title: 'Hoarder', desc: 'Have 100 games in your library.', points: 75, icon: 'crown' },
  { id: 'multiplatform', title: 'Multiplatform', desc: 'Have games from 3 different stores.', points: 25, icon: 'globe' },
  { id: 'variety-pack', title: 'Variety Pack', desc: 'Play 5 different games.', points: 30, icon: 'star' },
  { id: 'connoisseur', title: 'Connoisseur', desc: 'Play 15 different games.', points: 50, icon: 'trophy' },
  { id: 'favorite-things', title: 'Favorite Things', desc: 'Pin 5 favorites.', points: 15, icon: 'star' },
  { id: 'tour-guide', title: 'Tour Guide', desc: 'Visit every blade on the dashboard.', points: 15, icon: 'home' },
  { id: 'interior-designer', title: 'Interior Designer', desc: 'Change your theme.', points: 10, icon: 'image' },
  { id: 'new-look', title: 'New Look', desc: 'Change your gamer picture.', points: 10, icon: 'user' },
  { id: 'soundtrack', title: 'Soundtrack', desc: 'Play music from your collection.', points: 15, icon: 'music' },
  { id: 'picture-perfect', title: 'Picture Perfect', desc: 'View a game capture.', points: 10, icon: 'image' },
  { id: 'movie-night', title: 'Movie Night', desc: 'Watch a video.', points: 15, icon: 'film' },
  { id: 'window-shopper', title: 'Window Shopper', desc: 'Check out a deal in Marketplace.', points: 10, icon: 'star' },
  { id: 'social-butterfly', title: 'Social Butterfly', desc: 'Connect your friends list.', points: 20, icon: 'user' },
  { id: 'couch-potato', title: 'Couch Potato', desc: 'Open a media app.', points: 10, icon: 'tv' },
  { id: 'guided', title: 'Guided', desc: 'Open the Guide during a game.', points: 5, icon: 'controller' },
  { id: 'retro-revival', title: 'Retro Revival', desc: 'Launch a retro game.', points: 20, icon: 'ghost' },
  { id: 'weekend-warrior', title: 'Weekend Warrior', desc: 'Play on a Saturday and the Sunday after.', points: 20, icon: 'flame' },
  { id: 'daily-dose', title: 'Daily Dose', desc: 'Play on 7 different days.', points: 30, icon: 'flame' },
  { id: 'clean-slate', title: 'Clean Slate', desc: 'Hide a game you never play.', points: 5, icon: 'eyeoff' },
  // Built-in arcade
  { id: 'arcade-rat', title: 'Arcade Rat', desc: 'Play every arcade game.', points: 15, icon: 'controller' },
  { id: 'top-of-the-board', title: 'Top of the Board', desc: 'Take first place on an arcade leaderboard.', points: 15, icon: 'crown' },
  { id: 'pulse-50k', title: 'Pulse Check', desc: 'Pulse Arena: score 50,000 points.', points: 20, icon: 'bolt' },
  { id: 'pulse-wave10', title: 'Ring Master', desc: 'Pulse Arena: reach wave 10.', points: 25, icon: 'bolt' },
  { id: 'pulse-nobomb', title: 'Steady Hands', desc: 'Pulse Arena: reach wave 5 without using a bomb.', points: 20, icon: 'bolt' },
  { id: 'prism-level5', title: 'Glass Cutter', desc: 'Prism Breaker: clear level 5.', points: 25, icon: 'star' },
  { id: 'prism-perfect', title: 'Flawless Prism', desc: 'Prism Breaker: clear a level without dropping a ball.', points: 20, icon: 'star' },
  { id: 'prism-multiball', title: 'Light Show', desc: 'Prism Breaker: have 5 balls in play at once.', points: 15, icon: 'star' },
  { id: 'glow-20k', title: 'Bright Idea', desc: 'Glow Link: score 20,000 in one Blitz.', points: 20, icon: 'trophy' },
  { id: 'glow-cascade', title: 'Chain Reaction', desc: 'Glow Link: set off a 5-step cascade.', points: 20, icon: 'trophy' },
  { id: 'glow-nova', title: 'Supernova', desc: 'Glow Link: make a Nova orb by matching five.', points: 15, icon: 'trophy' },
  { id: 'ribbon-round10', title: 'Last Rider Standing', desc: 'Ribbon Rivals: reach round 10 of the Gauntlet.', points: 25, icon: 'flame' },
  { id: 'ribbon-party', title: 'Couch Rivals', desc: 'Ribbon Rivals: finish a party match with two or more players.', points: 15, icon: 'user' },
  { id: 'ribbon-gaps', title: 'Needle Threader', desc: 'Ribbon Rivals: slip through 3 ribbon gaps in one round.', points: 20, icon: 'flame' },
  { id: 'lumen-5k', title: 'Light Speed', desc: 'Lumen Run: travel 5,000 m in one run.', points: 25, icon: 'bolt' },
  { id: 'lumen-graze', title: 'Hair\u2019s Breadth', desc: 'Lumen Run: graze 25 obstacles in one run.', points: 20, icon: 'bolt' },
  { id: 'lumen-chain', title: 'Shard Collector', desc: 'Lumen Run: collect 50 shards in a row.', points: 15, icon: 'bolt' },
  { id: 'golf-ace', title: 'Hole in One', desc: 'Orbit Golf: sink a hole in one.', points: 20, icon: 'star' },
  { id: 'golf-under', title: 'Under Par', desc: 'Orbit Golf: finish the course under par.', points: 25, icon: 'star' },
  { id: 'golf-bank', title: 'Trick Shot', desc: 'Orbit Golf: sink a putt after bouncing off 3 walls or bumpers.', points: 15, icon: 'star' },
];
const BLADES = ['marketplace', 'social', 'home', 'games', 'arcade', 'retro', 'media', 'system'];
const DEF = Object.fromEntries(DEFS.map((d) => [d.id, d]));

class Achievements extends EventEmitter {
  // store: () => profile data object ({ achievements:{}, stats:{} }), save: () => void
  constructor(getData, save) {
    super();
    this.getData = getData;
    this.save = save;
  }

  data() {
    const d = this.getData();
    d.achievements = d.achievements || {};
    d.stats = d.stats || {};
    return d;
  }

  list() {
    const d = this.data();
    return DEFS.map((def) => ({ ...def, unlockedAt: d.achievements[def.id] || 0 }));
  }

  score() {
    const d = this.data();
    return DEFS.reduce((s, def) => s + (d.achievements[def.id] ? def.points : 0), 0);
  }

  totals() { return { score: this.score(), max: DEFS.reduce((s, d) => s + d.points, 0), unlocked: Object.keys(this.data().achievements).length, count: DEFS.length }; }

  unlock(id) {
    const d = this.data();
    if (!DEF[id] || d.achievements[id]) return;
    d.achievements[id] = Date.now();
    this.save();
    this.emit('unlock', { ...DEF[id], unlockedAt: d.achievements[id] });
  }

  // ctx: { games: [view games], sessions: [] } supplied by the caller where needed
  track(event, data = {}, ctx = {}) {
    const d = this.data();
    const st = d.stats;
    switch (event) {
      case 'boot': this.unlock('power-on'); break;
      case 'signin': this.unlock('signed-in'); break;
      case 'launch':
        this.unlock('game-on');
        if (data.source === 'rom') this.unlock('retro-revival');
        break;
      case 'session': {
        const s = data.seconds || 0;
        if (s >= 3600) this.unlock('one-more-turn');
        if (s >= 3 * 3600) this.unlock('marathon');
        const start = new Date(data.startedAt || Date.now());
        const hr = start.getHours();
        if (s >= 300 && hr < 5) this.unlock('night-owl');
        if (s >= 300 && hr >= 5 && hr < 8) this.unlock('early-bird');
        // Local calendar days (hours and weekday are local too), not UTC.
        const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const day = dayKey(start);
        st.days = Array.from(new Set([...(st.days || []), day])).slice(-60);
        if (st.days.length >= 7) this.unlock('daily-dose');
        if (start.getDay() === 0) {
          const sat = new Date(start); sat.setDate(sat.getDate() - 1);
          if (st.days.includes(dayKey(sat))) this.unlock('weekend-warrior');
        }
        this.save();
        this.evaluateLibrary(ctx.games || []);
        break;
      }
      case 'library': this.evaluateLibrary(ctx.games || []); break;
      case 'blade':
        st.blades = Array.from(new Set([...(st.blades || []), data.id]));
        if (BLADES.every((b) => st.blades.includes(b))) this.unlock('tour-guide');
        this.save();
        break;
      case 'theme': this.unlock('interior-designer'); break;
      case 'avatar': this.unlock('new-look'); break;
      case 'music': this.unlock('soundtrack'); break;
      case 'picture': this.unlock('picture-perfect'); break;
      case 'video': this.unlock('movie-night'); break;
      case 'market': this.unlock('window-shopper'); break;
      case 'friends': this.unlock('social-butterfly'); break;
      case 'media': this.unlock('couch-potato'); break;
      case 'guide': this.unlock('guided'); break;
      case 'hide': if (!data.playtime) this.unlock('clean-slate'); break;
      case 'arcade': {
        const x = data.stats || {};
        if ((data.played || []).length >= (data.total || 3)) this.unlock('arcade-rat');
        if (data.top) this.unlock('top-of-the-board');
        if (data.game === 'pulse') {
          if (data.score >= 50000) this.unlock('pulse-50k');
          if ((x.wave || 0) >= 10) this.unlock('pulse-wave10');
          if (x.noBombWave >= 5) this.unlock('pulse-nobomb');
        } else if (data.game === 'prism') {
          if ((x.levelsCleared || 0) >= 5) this.unlock('prism-level5');
          if (x.perfectLevels > 0) this.unlock('prism-perfect');
          if ((x.maxBalls || 0) >= 5) this.unlock('prism-multiball');
        } else if (data.game === 'glow') {
          if (data.score >= 20000) this.unlock('glow-20k');
          if ((x.maxCascade || 0) >= 5) this.unlock('glow-cascade');
          if ((x.novas || 0) > 0) this.unlock('glow-nova');
        } else if (data.game === 'ribbon') {
          if (!x.party && (x.round || 0) >= 10) this.unlock('ribbon-round10');
          if (x.party && x.matchDone && (x.humans || 0) >= 2) this.unlock('ribbon-party');
          if ((x.maxGapsInRound || 0) >= 3) this.unlock('ribbon-gaps');
        } else if (data.game === 'lumen') {
          if ((x.distance || 0) >= 5000) this.unlock('lumen-5k');
          if ((x.grazes || 0) >= 25) this.unlock('lumen-graze');
          if ((x.maxChain || 0) >= 50) this.unlock('lumen-chain');
        } else if (data.game === 'golf') {
          if ((x.aces || 0) > 0) this.unlock('golf-ace');
          if (x.finished && (x.toPar || 0) < 0) this.unlock('golf-under');
          if ((x.maxBankSink || 0) >= 3) this.unlock('golf-bank');
        }
        break;
      }
      default: break;
    }
  }

  evaluateLibrary(all) {
    const games = all.filter((g) => g.source !== 'arcade'); // built-in games aren't "your library"
    const visible = games.filter((g) => !g.hidden);
    const n = visible.length;
    if (n >= 10) this.unlock('collector');
    if (n >= 25) this.unlock('curator');
    if (n >= 50) this.unlock('archivist');
    if (n >= 100) this.unlock('hoarder');
    if (new Set(visible.map((g) => (g.source === 'rom' ? 'local' : g.source))).size >= 3) this.unlock('multiplatform');
    const played = games.filter((g) => g.playtime > 0).length;
    if (played >= 5) this.unlock('variety-pack');
    if (played >= 15) this.unlock('connoisseur');
    const total = games.reduce((s, g) => s + (g.playtime || 0), 0);
    if (total >= 10 * 3600) this.unlock('ten-hours');
    if (total >= 50 * 3600) this.unlock('fifty-hours');
    if (total >= 100 * 3600) this.unlock('centurion');
    const sessions = games.reduce((s, g) => s + (g.launches || 0), 0);
    if (sessions >= 10) this.unlock('regular');
    if (sessions >= 50) this.unlock('devoted');
    if (games.filter((g) => g.favorite).length >= 5) this.unlock('favorite-things');
  }
}

module.exports = { Achievements, DEFS };
