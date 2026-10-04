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
        return { name: name, tag: tag, logo: '', score: 0, players: ['', '', '', '', ''], played: [] };
    }

    function defaults() {
        return {
            tournament: { name: 'Tournament Name', stage: '', bestOf: 3, game: 1, logo: '' },
            teams: { blue: emptyTeam('Blue Team', 'BLU'), red: emptyTeam('Red Team', 'RED') },
            draft: {
                visible: true,
                design: 'classic',       // look of the draft overlay, see css/overlay-designs.css
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
            scoreboard: { visible: true, design: 'classic', layout: 'split', gap: 640, top: 0, showInfo: true },
            // Last announcement sent from the Live tab (see js/events.js). `at` is
            // the moment it was pressed, so an overlay only plays a fresh one.
            event: { id: '', side: '', at: 0 },
            banner: { top: 110, seconds: 5 }
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
            state = merge(defaults(), j.state);
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
            const r = await fetch('api/state', { method: 'POST', body: JSON.stringify(state) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            version = (await r.json()).v;
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
        try { state = merge(defaults(), JSON.parse(text)); } catch (e) { return; }
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
        playedHeroes: playedHeroes,
        fearlessLocked: fearlessLocked,
        winsNeeded: winsNeeded
    };
})(window);
