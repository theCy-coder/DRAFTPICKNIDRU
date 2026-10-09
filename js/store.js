// Shared match state. Every page (control panel + overlays) loads this file.
// When the pages are served by server.ps1 the state lives on the server and is
// polled; when opened straight from disk it falls back to localStorage, which
// only syncs between tabs of the same browser.
(function (global) {
    'use strict';

    const LS_KEY = 'mlbb-overlay-state-v2';
    const POLL_MS = 250;
    const SIDES = ['blue', 'red'];

    function emptyTeam(name, tag) {
        // played: heroes this team picked in earlier games of the series,
        // one entry per game: { game: 1, heroes: ['ling', ...] }
        // stats: objectives this team has taken in the current game.
        return { name: name, tag: tag, logo: '', score: 0, players: ['', '', '', '', ''], played: [],
            stats: { towers: 0, turtles: 0, lords: 0 } };
    }

    function defaults() {
        return {
            // One look for the draft, the scoreboard and the MVP screen:
            // classic | slant | glass | studio | neon | prestige | championship
            design: 'classic',
            // effect: this game's battlefield effect, e.g. 'Revealing Wisps' ('' = none)
            tournament: { name: 'Tournament Name', stage: '', bestOf: 3, game: 1, logo: '', effect: '' },
            teams: { blue: emptyTeam('Blue Team', 'BLU'), red: emptyTeam('Red Team', 'RED') },
            draft: {
                visible: true,
                layout: 'auto',          // picks 'bottom' | 'sides' | 'auto' (follow the design)
                stage: 'story',          // centre of the side layout: 'off' | 'story' | 'info' | 'media'
                background: false,       // animated full-screen backdrop in the show design
                mode: 'normal',          // 'normal' | 'fearless'
                fearlessScope: 'both',   // 'both' | 'team'
                step: 0,
                banCount: 5,
                banTime: 60,
                pickTime: 60,
                autoTimer: true,
                autoAdvance: false,
                picks: { blue: [null, null, null, null, null], red: [null, null, null, null, null] },
                bans: { blue: [null, null, null, null, null], red: [null, null, null, null, null] },
                timer: { running: false, endsAt: 0, remaining: 60000 }
            },
            // middle: what the Bar layout shows in its centre: 'info' | 'logo' | 'image'
            scoreboard: { visible: true, layout: 'split', gap: 640, top: 0, showInfo: true, showStats: true, middle: 'info', image: '',
                showEffect: true, effectSide: 'right', effectTop: 20 },
            // Last announcement sent from the Live tab (see js/events.js). `at` is
            // the moment it was pressed, so an overlay only plays a fresh one.
            event: { id: '', side: '', at: 0 },
            banner: { top: 136, seconds: 5 },
            // The whole season, edited on the Season tab and shown by the centre
            // stage. Rows are plain text: standings { team, w, l, pts },
            // schedule { when, a, b, score }, bracket { round, a, sa, b, sb }.
            // `when` is Philippine wall-clock time, "2026-10-10T18:00".
            // heroes: this season's record per hero, { id, p: picked, w: won, b: banned },
            // counted by the control panel each time a game's winner is entered.
            // teams: the season's teams, { id, name, tag, logo }.
            // players: the roster, { name, team (a team id), photo, show }. A photo
            // is a small data URL; `show` picks what the overlays display for the
            // player: 'default' (template), 'own' (their photo), 'team' (the team
            // logo) or 'none'. The overlays match a player by nickname.
            // auto: the standings are worked out from the schedule's scores, with
            // winPoints points for each match won.
            season: { title: '', seconds: 10, auto: true, winPoints: 3, standings: [], schedule: [], bracket: [], heroes: [], teams: [], players: [] },
            // Loading screen (loading.html): how long each slide stays up.
            loading: { seconds: 9 },
            // Waiting screen (idle.html): headline, optional bottom line and a countdown.
            // rotate: the matchup takes turns with schedule and standings pages,
            // pageSeconds each; ticker: results and coming matches along the bottom.
            idle: { title: 'Starting soon', message: '', minutes: 5, showTimer: true, rotate: true, pageSeconds: 12, ticker: true,
                timer: { running: false, endsAt: 0, remaining: 300000 } },
            // Player of the game for the MVP overlay. It is a copy taken when the
            // operator picks it, so it survives the draft being cleared.
            mvp: { visible: false, side: '', hero: '', player: '', team: '', game: 1,
                k: '', d: '', a: '', gold: '', damage: '', rating: '', kdaOnly: false,
                // loop: alternate "who won" and the MVP, `seconds` each.
                // winner: the winning team's name ('' = the MVP's own team).
                loop: true, seconds: 10, winner: '' }
        };
    }

    function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

    // Fill anything missing in a loaded state from the defaults.
    function merge(base, saved) {
        if (!isObject(saved)) return base;
        Object.keys(base).forEach(function (k) {
            if (saved[k] === undefined) return;
            if (isObject(base[k])) base[k] = merge(base[k], saved[k]);
            else if (Array.isArray(base[k])) {
                // Fixed-size rows must keep their length; open lists (empty by default) can be any length.
                if (Array.isArray(saved[k]) && (!base[k].length || saved[k].length === base[k].length)) base[k] = saved[k];
            }
            else base[k] = saved[k];
        });
        return base;
    }

    // Defaults filled in, plus one upgrade: the design used to be chosen per
    // overlay, so a state saved back then hands its draft design to the show.
    function load(saved) {
        const next = merge(defaults(), saved);
        if (isObject(saved) && saved.design === undefined && isObject(saved.draft) && saved.draft.design) next.design = saved.draft.design;
        return next;
    }

    // Combine two edits of the same starting state: every value this page
    // changed since `base` wins, everything else comes from `remote`. Used
    // when another page saved first, so neither edit is lost.
    function merge3(base, local, remote) {
        if (isObject(local) && isObject(remote)) {
            const out = {};
            Object.keys(remote).concat(Object.keys(local)).forEach(function (k) {
                if (!(k in out)) out[k] = merge3(isObject(base) ? base[k] : undefined, local[k], remote[k]);
            });
            return out;
        }
        if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base) &&
            local.length === remote.length && local.length === base.length) {
            return local.map(function (item, i) { return merge3(base[i], item, remote[i]); });
        }
        return JSON.stringify(local) !== JSON.stringify(base) ? local : remote;
    }

    // ---- Draft order -----------------------------------------------------
    // Tournament draft: blue opens both the first ban and first pick rotation,
    // red opens the second ban rotation and gets last pick.
    function sequence(banCount) {
        const s = function (side, type, slots) { return { side: side, type: type, slots: slots }; };
        const B = 'blue', R = 'red';
        const picks1 = [s(B, 'pick', [0]), s(R, 'pick', [0, 1]), s(B, 'pick', [1, 2]), s(R, 'pick', [2])];
        const picks2 = [s(R, 'pick', [3]), s(B, 'pick', [3, 4]), s(R, 'pick', [4])];
        if (banCount === 3) {
            return [s(B, 'ban', [0]), s(R, 'ban', [0]), s(B, 'ban', [1]), s(R, 'ban', [1])]
                .concat(picks1, [s(R, 'ban', [2]), s(B, 'ban', [2])], picks2);
        }
        return [s(B, 'ban', [0]), s(R, 'ban', [0]), s(B, 'ban', [1]), s(R, 'ban', [1]), s(B, 'ban', [2]), s(R, 'ban', [2])]
            .concat(picks1, [s(R, 'ban', [3]), s(B, 'ban', [3]), s(R, 'ban', [4]), s(B, 'ban', [4])], picks2);
    }

    function currentStep(state) {
        return sequence(state.draft.banCount)[state.draft.step] || null;
    }

    function stepDuration(state, step) {
        if (!step) return 0;
        return (step.type === 'ban' ? state.draft.banTime : state.draft.pickTime) * 1000;
    }

    function timerLeft(state) {
        const t = state.draft.timer;
        return t.running ? Math.max(0, t.endsAt - now()) : Math.max(0, t.remaining);
    }

    // Milliseconds left on the waiting screen's countdown.
    function idleLeft(state) {
        const t = state.idle.timer;
        return t.running ? Math.max(0, t.endsAt - now()) : Math.max(0, t.remaining);
    }

    // ---- Fearless draft ---------------------------------------------------
    function playedHeroes(state, side) {
        const out = [];
        state.teams[side].played.forEach(function (entry) {
            entry.heroes.forEach(function (id) { out.push(id); });
        });
        return out;
    }

    // Heroes that may not go into `target` ({ side, type }) because they were
    // already played this series. Empty in normal mode.
    function fearlessLocked(state, target) {
        const locked = {};
        if (state.draft.mode !== 'fearless') return locked;
        if (state.draft.fearlessScope === 'team') {
            // A team only loses its own heroes, and only for picking.
            if (target && target.type === 'pick') playedHeroes(state, target.side).forEach(function (id) { locked[id] = true; });
        } else {
            SIDES.forEach(function (side) { playedHeroes(state, side).forEach(function (id) { locked[id] = true; }); });
        }
        return locked;
    }

    function winsNeeded(state) {
        return Math.floor(state.tournament.bestOf / 2) + 1;
    }

    // ---- Sync ------------------------------------------------------------
    let state = defaults();
    let synced = JSON.stringify(state);   // the state as the server last had it
    let version = -1;
    let clockOffset = 0;
    let mode = 'local';
    let online = true;
    let dirty = false;
    let pushing = false;
    let pushTimer = null;
    let channel = null;
    const listeners = [];
    const statusListeners = [];

    function now() { return Date.now() + clockOffset; }
    function emit() { listeners.forEach(function (fn) { fn(state); }); }
    function setOnline(v) {
        if (v === online) return;
        online = v;
        statusListeners.forEach(function (fn) { fn(online, mode); });
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function fetchState() {
        const r = await fetch('api/state?v=' + version, { cache: 'no-store' });
        if (r.status === 204) return true;
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        clockOffset = j.t - Date.now();
        if (!dirty && !pushing) {
            version = j.v;
            state = load(j.state);
            synced = JSON.stringify(state);
            emit();
        }
        return true;
    }

    async function pollLoop() {
        for (;;) {
            await sleep(POLL_MS);
            if (dirty || pushing) continue;
            try { await fetchState(); setOnline(true); } catch (e) { setOnline(false); }
        }
    }

    async function push() {
        pushTimer = null;
        pushing = true;
        dirty = false;
        let ok = true;
        try {
            const sent = JSON.stringify(state);
            const r = await fetch('api/state?v=' + version, { method: 'POST', body: sent });
            if (r.status === 409) {
                // Another page saved first: keep its changes, add ours, try again.
                const j = await r.json();
                const remote = load(j.state);
                state = merge3(JSON.parse(synced), state, remote);
                synced = JSON.stringify(remote);
                version = j.v;
                dirty = true;
                emit();
            } else {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                version = (await r.json()).v;
                synced = sent;
            }
            setOnline(true);
        } catch (e) {
            ok = false;
            dirty = true;
            setOnline(false);
        }
        pushing = false;
        if (dirty && !pushTimer) pushTimer = setTimeout(push, ok ? 60 : 1000);
    }

    function saveLocal() {
        const text = JSON.stringify(state);
        try { localStorage.setItem(LS_KEY, text); } catch (e) { /* storage full or blocked */ }
        if (channel) channel.postMessage(text);
    }

    function loadLocal(text) {
        try { state = load(JSON.parse(text)); } catch (e) { return; }
        emit();
    }

    async function init() {
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            try {
                await fetchState();
                mode = 'server';
            } catch (e) { mode = 'local'; }
        }
        if (mode === 'server') {
            pollLoop();
        } else {
            let saved = null;
            try { saved = localStorage.getItem(LS_KEY); } catch (e) { /* blocked */ }
            if (saved) loadLocal(saved);
            window.addEventListener('storage', function (e) { if (e.key === LS_KEY && e.newValue) loadLocal(e.newValue); });
            if ('BroadcastChannel' in window) {
                channel = new BroadcastChannel(LS_KEY);
                channel.onmessage = function (e) { loadLocal(e.data); };
            }
        }
        statusListeners.forEach(function (fn) { fn(online, mode); });
        emit();
        return state;
    }

    // Change the state: Store.update(s => { s.teams.blue.score++ })
    function update(mutate) {
        mutate(state);
        emit();
        if (mode === 'server') {
            dirty = true;
            if (!pushTimer && !pushing) pushTimer = setTimeout(push, 60);
        } else {
            saveLocal();
        }
    }

    global.Store = {
        SIDES: SIDES,
        init: init,
        get: function () { return state; },
        update: update,
        subscribe: function (fn) { listeners.push(fn); },
        onStatus: function (fn) { statusListeners.push(fn); },
        now: now,
        defaults: defaults,
        sequence: sequence,
        currentStep: currentStep,
        stepDuration: stepDuration,
        timerLeft: timerLeft,
        idleLeft: idleLeft,
        playedHeroes: playedHeroes,
        fearlessLocked: fearlessLocked,
        winsNeeded: winsNeeded
    };
})(window);
