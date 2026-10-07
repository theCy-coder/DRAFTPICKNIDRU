// Control panel: the only page that changes the shared state.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const SIDES = Store.SIDES;

    let selected = null;      // slot the operator clicked: { side, type, i }
    let roleFilter = '';
    const history = [];       // draft snapshots for Undo
    const slotEls = { pick: { blue: [], red: [] }, ban: { blue: [], red: [] } };
    const heroEls = {};

    // ---- small helpers ---------------------------------------------------
    function getPath(obj, path) {
        return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
    }
    function setPath(obj, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce(function (o, k) { return o[k]; }, obj)[last] = value;
    }
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function emptyRow() { return [null, null, null, null, null]; }

    // ---- draft logic -----------------------------------------------------
    // `series` snapshots (taken by Next game / Reset series) also remember the
    // game number, scores and played-hero lists so Undo can put them back.
    // Only the board (picks, bans, phase) is snapshotted: the settings stored
    // beside it, such as the design or the timers, are not something to undo.
    function snapshot(state, series) {
        const d = state.draft;
        const snap = { draft: { picks: d.picks, bans: d.bans, step: d.step } };
        if (series) {
            snap.series = {
                game: state.tournament.game,
                effect: state.tournament.effect,
                heroes: state.season.heroes,
                swapped: false,
                blue: { score: state.teams.blue.score, played: state.teams.blue.played, stats: state.teams.blue.stats },
                red: { score: state.teams.red.score, played: state.teams.red.played, stats: state.teams.red.stats }
            };
        }
        history.push(JSON.stringify(snap));
        if (history.length > 60) history.shift();
    }

    function swapSides(state) {
        const blue = state.teams.blue;
        state.teams.blue = state.teams.red;
        state.teams.red = blue;
    }

    function restore(state, snap) {
        state.draft.picks = snap.draft.picks;
        state.draft.bans = snap.draft.bans;
        state.draft.step = snap.draft.step;
        state.draft.timer = { running: false, endsAt: 0, remaining: Store.stepDuration(state, Store.currentStep(state)) };
        if (!snap.series) return;
        if (snap.series.swapped) swapSides(state);
        state.tournament.game = snap.series.game;
        state.tournament.effect = snap.series.effect || '';
        if (snap.series.heroes) state.season.heroes = snap.series.heroes;
        SIDES.forEach(function (side) {
            state.teams[side].score = snap.series[side].score;
            state.teams[side].played = snap.series[side].played;
            if (snap.series[side].stats) state.teams[side].stats = snap.series[side].stats;
        });
    }

    // Remember this game's picks so a fearless draft can lock them later.
    // Recorded in normal mode too, so fearless can be switched on mid-series.
    function recordPlayed(state) {
        SIDES.forEach(function (side) {
            const heroes = state.draft.picks[side].filter(Boolean);
            if (heroes.length) state.teams[side].played.push({ game: state.tournament.game, heroes: heroes });
        });
    }

    function setStep(state, n, run) {
        const seq = Store.sequence(state.draft.banCount);
        state.draft.step = clamp(n, 0, seq.length);
        const step = seq[state.draft.step];
        const dur = Store.stepDuration(state, step);
        state.draft.timer = step && run
            ? { running: true, endsAt: Store.now() + dur, remaining: dur }
            : { running: false, endsAt: 0, remaining: dur };
    }

    function resetDraft(state) {
        state.draft.picks = { blue: emptyRow(), red: emptyRow() };
        state.draft.bans = { blue: emptyRow(), red: emptyRow() };
        setStep(state, 0, false);
    }

    function stepFilled(state, step) {
        const row = state.draft[step.type + 's'][step.side];
        return step.slots.every(function (i) { return row[i]; });
    }

    // Where the next clicked hero goes: the slot the operator selected, or
    // else the first empty slot of the current phase.
    function target(state) {
        if (selected) return selected;
        const step = Store.currentStep(state);
        if (!step) return null;
        const row = state.draft[step.type + 's'][step.side];
        for (let k = 0; k < step.slots.length; k++) {
            if (!row[step.slots[k]]) return { side: step.side, type: step.type, i: step.slots[k] };
        }
        return null;
    }

    function usedHeroes(state) {
        const used = {};
        SIDES.forEach(function (side) {
            state.draft.picks[side].concat(state.draft.bans[side]).forEach(function (id) { if (id) used[id] = true; });
        });
        return used;
    }

    function lockHero(id) {
        Store.update(function (s) {
            const t = target(s);
            if (!t || usedHeroes(s)[id] || Store.fearlessLocked(s, t)[id]) return;
            snapshot(s);
            s.draft[t.type + 's'][t.side][t.i] = id;
            const step = Store.currentStep(s);
            const inStep = step && step.side === t.side && step.type === t.type && step.slots.indexOf(t.i) >= 0;
            if (inStep && stepFilled(s, step)) setStep(s, s.draft.step + 1, s.draft.autoTimer);
            selected = null;
        });
    }

    function clearSlot(slot) {
        Store.update(function (s) {
            if (!s.draft[slot.type + 's'][slot.side][slot.i]) return;
            snapshot(s);
            s.draft[slot.type + 's'][slot.side][slot.i] = null;
        });
    }

    function toggleTimer(s) {
        const t = s.draft.timer;
        const step = Store.currentStep(s);
        if (t.running) {
            s.draft.timer = { running: false, endsAt: 0, remaining: Store.timerLeft(s) };
        } else if (step) {
            const left = t.remaining > 0 ? t.remaining : Store.stepDuration(s, step);
            s.draft.timer = { running: true, endsAt: Store.now() + left, remaining: left };
        }
    }

    // The side that has won the series, or '' while it is still open.
    function seriesWinner(state) {
        const need = Store.winsNeeded(state);
        return SIDES.filter(function (side) { return state.teams[side].score >= need; })[0] || '';
    }

    function seriesOver(state) {
        return state.tournament.game >= state.tournament.bestOf || !!seriesWinner(state);
    }

    // Move on to the next game. The caller has just taken a series snapshot.
    // A new game starts with no objectives taken and its own battlefield effect.
    function clearGame(s) {
        s.tournament.effect = '';
        SIDES.forEach(function (side) { s.teams[side].stats = { towers: 0, turtles: 0, lords: 0 }; });
    }

    function advanceGame(s) {
        recordPlayed(s);
        s.tournament.game += 1;
        resetDraft(s);
        clearGame(s);
        if ($('swap-on-next').checked) {
            swapSides(s);
            const snap = JSON.parse(history.pop());
            snap.series.swapped = true;
            history.push(JSON.stringify(snap));
        }
        selected = null;
    }

    // Add the finished game to the season's hero records: every pick counts as
    // played (and as a win for the winning side), every ban as a ban.
    function recordHeroStats(s, winner) {
        const bySide = {};
        s.season.heroes.forEach(function (row) { bySide[row.id] = row; });
        function row(id) {
            if (!bySide[id]) { bySide[id] = { id: id, p: 0, w: 0, b: 0 }; s.season.heroes.push(bySide[id]); }
            return bySide[id];
        }
        SIDES.forEach(function (side) {
            s.draft.picks[side].filter(Boolean).forEach(function (id) {
                const r = row(id);
                r.p += 1;
                if (side === winner) r.w += 1;
            });
            s.draft.bans[side].slice(0, s.draft.banCount).filter(Boolean).forEach(function (id) { row(id).b += 1; });
        });
    }

    // ---- actions (buttons with data-act) ---------------------------------
    const actions = {
        'game-up': function (s) { s.tournament.game = clamp(s.tournament.game + 1, 1, s.tournament.bestOf); },
        'game-down': function (s) { s.tournament.game = clamp(s.tournament.game - 1, 1, 99); },
        // Once a team has the wins it needs the series is over, so neither
        // score can go up: the two can never add up to more than the series length.
        'score-up': function (s, b) {
            if (seriesWinner(s)) return;
            s.teams[b.dataset.side].score = clamp(s.teams[b.dataset.side].score + 1, 0, Store.winsNeeded(s));
        },
        'score-down': function (s, b) { s.teams[b.dataset.side].score = clamp(s.teams[b.dataset.side].score - 1, 0, Store.winsNeeded(s)); },
        'logo-clear': function (s, b) { s.teams[b.dataset.side].logo = ''; },
        'tour-logo-clear': function (s) { s.tournament.logo = ''; },
        'sb-image-clear': function (s) { s.scoreboard.image = ''; },
        // Season tab
        'season-add': function (s, b) {
            const list = b.dataset.list;
            const row = {};
            SEASON_COLUMNS[list].forEach(function (col) { row[col.key] = ''; });
            s.season[list].push(row);
        },
        'season-del': function (s, b) { s.season[b.dataset.list].splice(Number(b.dataset.i), 1); },
        'season-clear': function (s) { s.season = Store.defaults().season; },
        'season-heroes-clear': function (s) { s.season.heroes = []; },
        // Waiting screen countdown
        'idle-start': function (s) {
            const ms = clamp(Number(s.idle.minutes) || 0, 0, 180) * 60000;
            s.idle.timer = { running: ms > 0, endsAt: Store.now() + ms, remaining: ms };
        },
        'idle-toggle': function (s) {
            const left = Store.idleLeft(s);
            s.idle.timer = s.idle.timer.running
                ? { running: false, endsAt: 0, remaining: left }
                : { running: left > 0, endsAt: Store.now() + left, remaining: left };
        },
        'idle-add': function (s) {
            const t = s.idle.timer;
            if (t.running) t.endsAt = Math.max(t.endsAt, Store.now()) + 60000;
            else t.remaining = Math.max(0, t.remaining) + 60000;
        },
        'idle-reset': function (s) {
            const ms = clamp(Number(s.idle.minutes) || 0, 0, 180) * 60000;
            s.idle.timer = { running: false, endsAt: 0, remaining: ms };
        },
        'mvp-clear': function (s) {
            const old = s.mvp;
            s.mvp = Store.defaults().mvp;
            ['kdaOnly', 'loop', 'seconds'].forEach(function (key) { s.mvp[key] = old[key]; });
        },
        'swap-sides': function (s) {
            swapSides(s);
            // Older snapshots are tied to the sides as they were.
            history.length = 0;
        },
        'next-game': function (s) {
            // A best-of-N series has no game N + 1, and none after it is won.
            if (seriesOver(s)) return;
            snapshot(s, true);
            advanceGame(s);
        },
        // "X won": add the win and, unless it decides the series, start the next game.
        'win': function (s, b) {
            if (seriesWinner(s)) return;
            snapshot(s, true);
            s.teams[b.dataset.side].score += 1;
            recordHeroStats(s, b.dataset.side);
            // The MVP screen's "who won" slide, if the MVP is from this game.
            if (s.mvp.hero && s.mvp.game === s.tournament.game) s.mvp.winner = s.teams[b.dataset.side].name;
            if (!seriesOver(s)) advanceGame(s);
        },
        'reset-series': function (s) {
            snapshot(s, true);
            s.tournament.game = 1;
            SIDES.forEach(function (side) {
                s.teams[side].score = 0;
                s.teams[side].played = [];
            });
            resetDraft(s);
            clearGame(s);
            selected = null;
        },
        'stat-up': function (s, b) { s.teams[b.dataset.side].stats[b.dataset.stat] = clamp(s.teams[b.dataset.side].stats[b.dataset.stat] + 1, 0, 9); },
        'stat-down': function (s, b) { s.teams[b.dataset.side].stats[b.dataset.stat] = clamp(s.teams[b.dataset.side].stats[b.dataset.stat] - 1, 0, 9); },
        'timer-toggle': toggleTimer,
        'timer-restart': function (s) {
            const dur = Store.stepDuration(s, Store.currentStep(s));
            s.draft.timer = s.draft.timer.running
                ? { running: true, endsAt: Store.now() + dur, remaining: dur }
                : { running: false, endsAt: 0, remaining: dur };
        },
        'step-prev': function (s) { selected = null; setStep(s, s.draft.step - 1, false); },
        'step-next': function (s) { selected = null; setStep(s, s.draft.step + 1, s.draft.autoTimer && s.draft.timer.running); },
        'undo': function (s) {
            if (!history.length) return;
            restore(s, JSON.parse(history.pop()));
            selected = null;
        },
        'reset-draft': function (s) { snapshot(s); resetDraft(s); selected = null; },
        // Unlock every hero played earlier in the series (fearless).
        'clear-played': function (s) {
            snapshot(s, true);
            SIDES.forEach(function (side) { s.teams[side].played = []; });
        }
    };
    const needsConfirm = { 'reset-draft': true, 'reset-series': true, 'clear-played': true, 'season-clear': true, 'season-heroes-clear': true };

    // Destructive buttons need a second click within 3 seconds.
    function armed(btn) {
        if (btn.dataset.armed) {
            clearTimeout(Number(btn.dataset.armed));
            btn.textContent = btn.dataset.label;
            delete btn.dataset.armed;
            return true;
        }
        btn.dataset.label = btn.textContent;
        btn.textContent = 'Click again to confirm';
        btn.dataset.armed = String(setTimeout(function () {
            btn.textContent = btn.dataset.label;
            delete btn.dataset.armed;
        }, 3000));
        return false;
    }

    // ---- building the page -----------------------------------------------
    function buildTeamCard(side) {
        $('team-' + side).innerHTML =
            '<h2>' + side + ' side</h2>' +
            '<div class="inline">' +
            '  <label class="field grow">Team name<input type="text" data-bind="teams.' + side + '.name" placeholder="Team name"></label>' +
            '  <label class="field tag">Tag<input type="text" maxlength="4" data-bind="teams.' + side + '.tag" placeholder="TAG"></label>' +
            '</div>' +
            '<div class="field">Logo<div class="logo-row">' +
            '  <div class="logo-preview" id="logo-preview-' + side + '"></div>' +
            '  <label class="btn">Upload<input type="file" accept="image/*" data-logo="' + side + '" hidden></label>' +
            '  <button type="button" class="btn ghost" data-act="logo-clear" data-side="' + side + '">Remove</button>' +
            '</div></div>';
    }

    // ---- tabs ------------------------------------------------------------
    // Each tab holds what one moment of the broadcast needs and nothing else.
    const TABS = ['setup', 'draft', 'live', 'settings', 'season'];
    const TAB_KEY = 'mlbb-overlay-tab';

    function showTab(name) {
        if (TABS.indexOf(name) < 0) name = 'draft';
        document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
        document.querySelectorAll('[data-tab]').forEach(function (t) {
            t.classList.toggle('on', t.dataset.tab === name);
            t.setAttribute('aria-selected', t.dataset.tab === name);
        });
        try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* blocked */ }
        window.scrollTo(0, 0);
    }

    function savedTab() {
        try { return localStorage.getItem(TAB_KEY); } catch (e) { return null; }
    }

    // ---- announcements (Live tab) ----------------------------------------
    function eventButton(def, side) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ebtn';
        btn.dataset.event = def.id;
        btn.dataset.side = side || '';
        if (def.color) btn.style.setProperty('--team', def.color);
        btn.innerHTML = '<i>' + GameEvents.icons[def.icon] + '</i><span></span>';
        btn.querySelector('span').textContent = def.label;
        return btn;
    }

    function buildEvents() {
        const box = $('events');
        ['blue', '', 'red'].forEach(function (side) {
            const col = document.createElement('div');
            col.className = 'ecol ' + (side || 'neutral');
            const title = document.createElement('div');
            title.className = 'ecol-title';
            title.id = 'ecol-title-' + (side || 'neutral');
            title.textContent = side ? side : 'Map';
            col.appendChild(title);
            GameEvents.list.forEach(function (def) {
                if (!!def.team === !!side) col.appendChild(eventButton(def, side));
            });
            box.appendChild(col);
        });
    }

    // Objective counters under each team's score on the Live tab.
    function buildStats(side) {
        const box = $('stats-' + side);
        GameEvents.stats.forEach(function (stat) {
            const row = document.createElement('div');
            row.className = 'stat';
            row.innerHTML = '<i>' + GameEvents.icons[stat.icon] + '</i><span></span>' +
                '<div class="stepper">' +
                '<button type="button" data-act="stat-down" aria-label="One fewer">\u2212</button>' +
                '<output></output>' +
                '<button type="button" data-act="stat-up" aria-label="One more">+</button>' +
                '</div>';
            row.querySelector('span').textContent = stat.label;
            row.querySelector('output').id = 'stat-' + side + '-' + stat.id;
            row.querySelectorAll('button').forEach(function (b) { b.dataset.side = side; b.dataset.stat = stat.id; });
            box.appendChild(row);
        });
    }

    // Battlefield effect picker: a dropdown of the known effects, on Draft and
    // Live. "None" is the default; a name typed by hand shows as "Other".
    const OTHER_EFFECT = '__other';

    function buildEffects() {
        document.querySelectorAll('.effect-select').forEach(function (select) {
            select.add(new Option('None', ''));
            const groups = {};
            GameEvents.effects.forEach(function (def) {
                if (!groups[def.group]) {
                    groups[def.group] = document.createElement('optgroup');
                    groups[def.group].label = def.group;
                    select.appendChild(groups[def.group]);
                }
                groups[def.group].appendChild(new Option(def.name, def.name));
            });
            const other = new Option('Other (typed)', OTHER_EFFECT);
            other.hidden = true;
            select.add(other);
        });
    }

    // ---- season tab ------------------------------------------------------
    const SEASON_COLUMNS = {
        standings: [
            { key: 'team', label: 'Team', grow: 3 },
            { key: 'w', label: 'Wins', grow: 1 },
            { key: 'l', label: 'Losses', grow: 1 },
            { key: 'pts', label: 'Points', grow: 1 }
        ],
        schedule: [
            { key: 'when', label: 'Date and time (PH)', grow: 2, type: 'datetime-local' },
            { key: 'a', label: 'Team', grow: 3 },
            { key: 'score', label: 'Score', grow: 1 },
            { key: 'b', label: 'Team', grow: 3 }
        ],
        bracket: [
            { key: 'round', label: 'Round', grow: 2 },
            { key: 'a', label: 'Team', grow: 3 },
            { key: 'sa', label: 'Score', grow: 1 },
            { key: 'b', label: 'Team', grow: 3 },
            { key: 'sb', label: 'Score', grow: 1 }
        ]
    };

    // One row of text boxes per entry. The boxes are ordinary bound fields
    // ("season.standings.0.team"), so only the row count needs rebuilding.
    function renderSeason(state) {
        Object.keys(SEASON_COLUMNS).forEach(function (list) {
            const box = $('season-' + list);
            const rows = state.season[list];
            if (box.dataset.count === String(rows.length)) return;
            box.dataset.count = String(rows.length);
            box.textContent = '';
            if (!rows.length) {
                const none = document.createElement('p');
                none.className = 'hint';
                none.textContent = 'Nothing here yet.';
                box.appendChild(none);
                return;
            }
            const cols = SEASON_COLUMNS[list];
            const head = document.createElement('div');
            head.className = 'srow head';
            cols.forEach(function (col) {
                const cell = document.createElement('span');
                cell.style.flexGrow = col.grow;
                cell.textContent = col.label;
                head.appendChild(cell);
            });
            head.appendChild(document.createElement('i'));
            box.appendChild(head);
            rows.forEach(function (row, i) {
                const line = document.createElement('div');
                line.className = 'srow';
                cols.forEach(function (col) {
                    const input = document.createElement('input');
                    input.type = col.type || 'text';
                    input.style.flexGrow = col.grow;
                    input.setAttribute('aria-label', col.label);
                    input.dataset.bind = 'season.' + list + '.' + i + '.' + col.key;
                    line.appendChild(input);
                });
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'btn ghost danger';
                del.dataset.act = 'season-del';
                del.dataset.list = list;
                del.dataset.i = i;
                del.textContent = '\u00d7';
                del.setAttribute('aria-label', 'Remove this row');
                line.appendChild(del);
                box.appendChild(line);
            });
        });
    }

    // Read-only table of the season's hero records, most played first.
    function renderHeroStats(state) {
        const box = $('season-heroes');
        const rows = state.season.heroes.slice().sort(function (a, b) { return (b.p + b.b) - (a.p + a.b) || b.w - a.w; });
        const key = JSON.stringify(rows);
        $('season-heroes-clear').disabled = !rows.length;
        if (box.dataset.key === key) return;
        box.dataset.key = key;
        box.textContent = '';
        if (!rows.length) {
            const none = document.createElement('p');
            none.className = 'hint';
            none.textContent = 'Nothing yet. A game is counted when you press who won on the Live game tab.';
            box.appendChild(none);
            return;
        }
        const line = function (cells, cls) {
            const div = document.createElement('div');
            div.className = 'hrow' + (cls ? ' ' + cls : '');
            cells.forEach(function (text) { const span = document.createElement('span'); span.textContent = text; div.appendChild(span); });
            box.appendChild(div);
        };
        line(['Hero', 'Picked', 'Won', 'Win rate', 'Banned'], 'head');
        rows.forEach(function (row) {
            const hero = Heroes.get(row.id);
            line([hero ? hero.name : row.id, row.p, row.w, row.p ? Math.round(row.w / row.p * 100) + '%' : '\u2013', row.b]);
        });
    }

    function seasonNote(text, bad) {
        $('season-note').textContent = text;
        $('season-note').classList.toggle('bad', !!bad);
    }

    function exportSeason() {
        const season = Store.get().season;
        const text = JSON.stringify({ type: 'mlbb-overlay-season', version: 1, season: season }, null, 2);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        link.download = ((season.title || 'season').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'season') + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
        seasonNote('Exported ' + link.download + '.');
    }

    // Keep only what a season file should hold: known lists of rows of text.
    function cleanSeason(raw) {
        const src = raw && typeof raw === 'object' && raw.season && typeof raw.season === 'object' ? raw.season : raw;
        if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
        const next = Store.defaults().season;
        let found = false;
        Object.keys(SEASON_COLUMNS).forEach(function (list) {
            if (!Array.isArray(src[list])) return;
            found = true;
            next[list] = src[list].filter(function (row) { return row && typeof row === 'object'; }).slice(0, 200).map(function (row) {
                const out = {};
                SEASON_COLUMNS[list].forEach(function (col) { out[col.key] = String(row[col.key] == null ? '' : row[col.key]).slice(0, 80); });
                return out;
            });
        });
        if (Array.isArray(src.heroes)) {
            found = true;
            const count = function (v) { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? Math.min(n, 9999) : 0; };
            next.heroes = src.heroes.filter(function (row) { return row && typeof row === 'object' && Heroes.get(row.id); }).map(function (row) {
                const p = count(row.p);
                return { id: String(row.id), p: p, w: Math.min(count(row.w), p), b: count(row.b) };
            });
        }
        if (!found) return null;
        if (typeof src.title === 'string') next.title = src.title.slice(0, 80);
        if (isFinite(Number(src.seconds)) && Number(src.seconds) >= 4) next.seconds = Math.min(120, Number(src.seconds));
        return next;
    }

    function importSeason(file) {
        const reader = new FileReader();
        reader.onload = function () {
            let season = null;
            try { season = cleanSeason(JSON.parse(String(reader.result))); } catch (e) { season = null; }
            if (!season) { seasonNote('That file is not a season export, so nothing was changed.', true); return; }
            Store.update(function (s) { s.season = season; });
            seasonNote('Imported ' + file.name + ': ' + season.standings.length + ' standings rows, ' +
                season.schedule.length + ' schedule rows, ' + season.bracket.length + ' bracket rows, ' + season.heroes.length + ' hero records.');
        };
        reader.onerror = function () { seasonNote('That file could not be read.', true); };
        reader.readAsText(file);
    }

    // What the centre stage will actually show with the current settings.
    let mediaCount = null;
    function renderStageHint(state) {
        const d = state.draft;
        const sides = d.layout === 'sides' || (d.layout !== 'bottom' && state.design === 'studio');
        const season = state.season;
        const hasSeason = ['standings', 'schedule', 'bracket'].some(function (list) { return season[list].length; });
        let text = '';
        if (!sides) text = 'The centre stage only appears when the picks are on the left and right edges.';
        else if (d.stage === 'story') text = 'Draft story: the matchup, whose turn it is, a spotlight on every pick and ban with the hero\u2019s season record, then both lineups.';
        else if (d.stage === 'info') text = hasSeason ? 'Season info: rotates the pages from the Season tab.' : 'Season info: nothing is entered on the Season tab yet, so the matchup card shows instead.';
        else if (d.stage === 'media') {
            text = mediaCount === null ? 'Media: plays the files in the Assets\\Media folder.'
                : mediaCount ? 'Media: playing ' + mediaCount + ' file' + (mediaCount === 1 ? '' : 's') + ' from the Assets\\Media folder.'
                : 'Media: the Assets\\Media folder is empty, so the matchup card shows instead.';
        } else text = 'Centre stage is off: the middle stays clear, for player cameras.';
        $('stage-hint').textContent = text;
    }

    const DESIGN_NOTES = {
        classic: 'Solid team-colour plates. Draft along the bottom.',
        slant: 'Everything leans towards the centre. Draft along the bottom.',
        glass: 'Frosted, rounded panels. Draft along the bottom, picks above the team plates.',
        studio: 'Flat and minimal, with a thin scoreboard strip. Picks go down both edges of the screen unless you change the picks position below.',
        neon: 'Dark panels with glowing outlines. Team colours become cyan and pink.',
        prestige: 'Black and gold. Draft along the bottom with diamond bans.',
        championship: 'The finals look: black and moving gold, hexagon bans, light sweeps, rays and confetti. The heaviest on animation.'
    };

    // MVP picker: the ten picks of the game being played, one button each.
    function buildMvpPicks(side) {
        const box = $('mvp-picks-' + side);
        for (let i = 0; i < 5; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mvp-pick';
            btn.dataset.side = side;
            btn.dataset.i = i;
            btn.innerHTML = '<img alt="" hidden><b></b><span></span>';
            btn.querySelector('img').onerror = function () { this.hidden = true; };
            box.appendChild(btn);
        }
    }

    function pickMvp(side, i) {
        Store.update(function (s) {
            const hero = s.draft.picks[side][i];
            if (!hero) return;
            const same = s.mvp.hero === hero && s.mvp.game === s.tournament.game && s.mvp.side === side;
            const fresh = Store.defaults().mvp;
            // A different MVP starts with empty numbers; re-clicking the same one keeps them.
            ['k', 'd', 'a', 'gold', 'damage', 'rating', 'winner'].forEach(function (key) { if (!same) s.mvp[key] = fresh[key]; });
            s.mvp.side = side;
            s.mvp.hero = hero;
            s.mvp.player = s.teams[side].players[i] || '';
            s.mvp.team = s.teams[side].name;
            s.mvp.game = s.tournament.game;
        });
    }

    function renderMvp(state) {
        const m = state.mvp;
        SIDES.forEach(function (side) {
            $('mvp-picks-' + side).querySelectorAll('.mvp-pick').forEach(function (btn, i) {
                const id = state.draft.picks[side][i];
                const hero = Heroes.get(id);
                const img = btn.querySelector('img');
                if (hero) {
                    if (img.getAttribute('src') !== hero.img) { img.hidden = false; img.src = hero.img; }
                } else {
                    img.hidden = true;
                    img.removeAttribute('src');
                }
                btn.querySelector('b').textContent = hero ? hero.name : 'Pick ' + (i + 1);
                btn.querySelector('span').textContent = state.teams[side].players[i] || '';
                btn.disabled = !hero;
                btn.classList.toggle('on', !!hero && m.hero === id && m.side === side && m.game === state.tournament.game);
            });
        });
        document.querySelectorAll('.mvp-extra input').forEach(function (input) { input.disabled = !!m.kdaOnly; });

        // Winner choice: the MVP's own team unless set otherwise.
        const select = $('mvp-winner');
        const names = SIDES.map(function (side) { return state.teams[side].name; });
        const key = names.join('|') + '|' + m.team;
        if (select.dataset.key !== key) {
            select.dataset.key = key;
            select.textContent = '';
            select.add(new Option(m.team ? 'MVP\u2019s team (' + m.team + ')' : 'MVP\u2019s team', ''));
            names.forEach(function (name) { select.add(new Option(name, name)); });
        }
        if (select !== document.activeElement) select.value = names.indexOf(m.winner) >= 0 ? m.winner : '';
        select.disabled = !m.loop;
    }

    let onAirTimer = null;
    function clearOnAir() {
        clearTimeout(onAirTimer);
        document.querySelectorAll('.ebtn.live').forEach(function (b) { b.classList.remove('live'); });
    }

    function announce(btn) {
        const def = GameEvents.get(btn.dataset.event);
        Store.update(function (s) {
            s.event = { id: btn.dataset.event, side: btn.dataset.side, at: Store.now() };
            // Announcing an objective also counts it for that team.
            if (def && def.count && btn.dataset.side) {
                const stats = s.teams[btn.dataset.side].stats;
                stats[def.count] = clamp(stats[def.count] + 1, 0, 9);
            }
        });
        // Mark which one is on screen for as long as the banner stays up.
        clearOnAir();
        btn.classList.add('live');
        onAirTimer = setTimeout(clearOnAir, (Number(Store.get().banner.seconds) || 5) * 1000);
    }

    function hideBanner() {
        Store.update(function (s) { s.event = { id: '', side: '', at: Store.now() }; });
        clearOnAir();
    }

    function slotButton(side, type, i) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot ' + type;
        btn.dataset.side = side;
        btn.dataset.type = type;
        btn.dataset.i = i;
        btn.innerHTML = '<img alt="" hidden><span class="snum">' + (type === 'ban' ? 'Ban ' : 'Pick ') + (i + 1) + '</span><span class="sname"></span>';
        btn.querySelector('img').onerror = function () { this.hidden = true; };
        if (type === 'pick') btn.draggable = true;
        slotEls[type][side][i] = btn;
        return btn;
    }

    function buildBoard(side) {
        const board = $('board-' + side);
        board.innerHTML = '<div class="board-title" id="board-title-' + side + '"></div><div class="slots bans"></div><div class="slots picks"></div>';
        for (let i = 0; i < 5; i++) {
            board.querySelector('.bans').appendChild(slotButton(side, 'ban', i));
            const col = document.createElement('div');
            col.className = 'pick-col';
            col.appendChild(slotButton(side, 'pick', i));
            const nick = document.createElement('input');
            nick.type = 'text';
            nick.placeholder = 'Player ' + (i + 1);
            nick.setAttribute('aria-label', side + ' player ' + (i + 1) + ' nickname');
            nick.dataset.bind = 'teams.' + side + '.players.' + i;
            col.appendChild(nick);
            board.querySelector('.picks').appendChild(col);
        }
    }

    function buildPicker() {
        const roles = $('roles');
        [''].concat(Heroes.roles).forEach(function (role) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (role ? '' : ' on');
            chip.dataset.role = role;
            chip.textContent = role || 'All';
            roles.appendChild(chip);
        });
        const grid = $('hero-grid');
        Heroes.list.forEach(function (hero) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hero';
            btn.dataset.hero = hero.id;
            btn.title = hero.name + ' – ' + hero.roles.join(' / ');
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = '';
            img.onerror = function () { btn.classList.add('noimg'); };
            img.src = hero.img;
            const name = document.createElement('span');
            name.textContent = hero.name;
            btn.appendChild(img);
            btn.appendChild(name);
            btn.appendChild(document.createElement('em'));
            grid.appendChild(btn);
            heroEls[hero.id] = btn;
        });
    }

    function visibleHeroes() {
        const q = $('search').value.trim().toLowerCase();
        return Heroes.list.filter(function (hero) {
            const plain = hero.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const matches = !q || hero.name.toLowerCase().indexOf(q) >= 0 || plain.indexOf(q.replace(/[^a-z0-9]/g, '')) >= 0;
            return matches && (!roleFilter || hero.roles.indexOf(roleFilter) >= 0);
        });
    }

    function applyFilter() {
        const shown = {};
        visibleHeroes().forEach(function (hero) { shown[hero.id] = true; });
        Heroes.list.forEach(function (hero) { heroEls[hero.id].hidden = !shown[hero.id]; });
    }

    // ---- rendering -------------------------------------------------------
    function renderLogoPreview(el, src, fallback) {
        if (el.dataset.src === src) return;
        el.dataset.src = src;
        el.textContent = '';
        if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            el.appendChild(img);
        } else {
            el.textContent = fallback;
        }
    }

    // List of heroes each team already played this series (fearless mode).
    function renderPlayed(state, fearless) {
        const panel = $('played');
        panel.hidden = !fearless;
        if (!fearless) return;
        SIDES.forEach(function (side) {
            const box = $('played-' + side);
            const team = state.teams[side];
            const key = team.name + '|' + JSON.stringify(team.played);
            if (box.dataset.key === key) return;
            box.dataset.key = key;
            box.textContent = '';
            const title = document.createElement('div');
            title.className = 'played-title';
            title.textContent = (team.name || side) + ' – already played';
            box.appendChild(title);
            if (!team.played.length) {
                const none = document.createElement('div');
                none.className = 'hint';
                none.textContent = 'Nothing yet. Picks are added here when you press “Next game”.';
                box.appendChild(none);
            }
            team.played.forEach(function (entry, index) {
                const row = document.createElement('div');
                row.className = 'played-row';
                const label = document.createElement('span');
                label.textContent = 'Game ' + entry.game;
                row.appendChild(label);
                entry.heroes.forEach(function (id) {
                    const hero = Heroes.get(id);
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'pchip';
                    chip.dataset.side = side;
                    chip.dataset.entry = index;
                    chip.dataset.hero = id;
                    chip.title = 'Right-click to remove from the played list';
                    chip.textContent = hero ? hero.name : id;
                    row.appendChild(chip);
                });
                box.appendChild(row);
            });
        });
    }

    function renderTimer(state) {
        const step = Store.currentStep(state);
        const left = Store.timerLeft(state);
        const box = $('timer-box');
        box.textContent = step ? Math.ceil(left / 1000) : '–';
        box.classList.toggle('low', !!step && state.draft.timer.running && left <= 10000);
    }

    function render(state) {
        const d = state.draft;
        const seq = Store.sequence(d.banCount);
        const step = seq[d.step] || null;
        const t = target(state);
        const used = usedHeroes(state);

        renderSeason(state);   // builds its rows first, so the loop below fills them in
        renderHeroStats(state);
        document.querySelectorAll('[data-bind]').forEach(function (input) {
            if (input === document.activeElement && input.type !== 'checkbox') return;
            const value = getPath(state, input.dataset.bind);
            if (input.type === 'checkbox') input.checked = !!value;
            else if (input.value !== String(value == null ? '' : value)) input.value = value == null ? '' : value;
        });

        $('game-no').textContent = state.tournament.game;
        const lastGame = state.tournament.game >= state.tournament.bestOf;
        const need = Store.winsNeeded(state);
        const winner = seriesWinner(state);
        SIDES.forEach(function (side) {
            $('win-' + side).textContent = (state.teams[side].name || side) + ' won \u25b6';
            $('win-' + side).disabled = !!winner;
        });
        $('series-result').hidden = !winner;
        if (winner) {
            const loser = winner === 'blue' ? 'red' : 'blue';
            $('series-result').textContent = 'Series over \u2013 ' + state.teams[winner].name + ' win ' +
                state.teams[winner].score + '\u2013' + state.teams[loser].score + '.';
        }
        $('game-up').disabled = lastGame;
        $('next-game').disabled = seriesOver(state);
        $('next-game').title = winner ? state.teams[winner].name + ' already won the series.'
            : lastGame ? 'This is the last game of a best of ' + state.tournament.bestOf + '.' : '';
        document.querySelectorAll('[data-act="score-up"]').forEach(function (b) { b.disabled = !!winner; });
        document.querySelectorAll('[data-act="score-down"]').forEach(function (b) { b.disabled = state.teams[b.dataset.side].score <= 0; });
        document.querySelector('[data-act="game-down"]').disabled = state.tournament.game <= 1;
        document.querySelector('[data-act="step-prev"]').disabled = d.step <= 0;
        document.querySelector('[data-act="step-next"]').disabled = !step;
        renderLogoPreview($('tour-logo-preview'), state.tournament.logo || 'Assets/Other/tournamentlogo.png', '');
        const sb = state.scoreboard;
        $('sb-image-field').hidden = sb.middle !== 'image';
        renderLogoPreview($('sb-image-preview'), sb.image, 'None');
        $('sb-middle-hint').textContent = sb.layout !== 'bar' ? 'The centre only shows in the Bar layout. Split leaves it empty for the in-game score.'
            : sb.middle === 'image' && !sb.image ? 'Upload an image to show it in the centre of the bar.'
            : sb.middle === 'logo' ? 'Uses the tournament logo from the Setup tab.' : '';
        $('sb-middle-hint').hidden = !$('sb-middle-hint').textContent;

        $('series-label').textContent = 'Best of ' + state.tournament.bestOf;
        $('summary').textContent = 'Game ' + state.tournament.game + ' of ' + state.tournament.bestOf + '  \u00b7  ' +
            (state.teams.blue.tag || 'BLU') + ' ' + state.teams.blue.score + ' \u2013 ' + state.teams.red.score + ' ' + (state.teams.red.tag || 'RED');
        $('draft-done').hidden = !!step;
        renderMvp(state);
        $('design-hint').textContent = DESIGN_NOTES[state.design] || '';
        renderStageHint(state);
        const effect = state.tournament.effect || '';
        const known = GameEvents.effect(effect);
        document.querySelectorAll('.effect-select').forEach(function (select) {
            select.value = !known ? '' : known.group ? known.name : OTHER_EFFECT;
        });

        SIDES.forEach(function (side) {
            const team = state.teams[side];
            $('score-' + side).textContent = team.score;
            $('live-name-' + side).textContent = team.name || side;
            GameEvents.stats.forEach(function (stat) { $('stat-' + side + '-' + stat.id).textContent = team.stats[stat.id]; });
            $('ecol-title-' + side).textContent = team.name || side;
            renderLogoPreview($('logo-preview-' + side), team.logo, (team.tag || '?').toUpperCase());
            $('board-title-' + side).textContent = team.name || side;

            ['pick', 'ban'].forEach(function (type) {
                for (let i = 0; i < 5; i++) {
                    const btn = slotEls[type][side][i];
                    const hero = Heroes.get(d[type + 's'][side][i]);
                    const img = btn.querySelector('img');
                    if (hero) {
                        if (img.getAttribute('src') !== hero.img) { img.hidden = false; img.src = hero.img; }
                    } else {
                        img.hidden = true;
                        img.removeAttribute('src');
                    }
                    btn.querySelector('.sname').textContent = hero ? hero.name : '';
                    btn.classList.toggle('filled', !!hero);
                    btn.classList.toggle('current', !!step && step.type === type && step.side === side && step.slots.indexOf(i) >= 0);
                    btn.classList.toggle('target', !!t && t.type === type && t.side === side && t.i === i);
                    btn.hidden = type === 'ban' && i >= d.banCount;
                }
            });
        });

        const fearless = d.mode === 'fearless';
        const locked = Store.fearlessLocked(state, t);
        const playedIn = {};
        SIDES.forEach(function (side) {
            state.teams[side].played.forEach(function (entry) {
                entry.heroes.forEach(function (id) { playedIn[id] = 'G' + entry.game; });
            });
        });
        Heroes.list.forEach(function (hero) {
            const btn = heroEls[hero.id];
            btn.classList.toggle('used', !!used[hero.id]);
            btn.classList.toggle('locked', !!locked[hero.id]);
            btn.disabled = !!used[hero.id] || !!locked[hero.id];
            btn.querySelector('em').textContent = locked[hero.id] ? 'Played ' + playedIn[hero.id] : '';
        });
        $('scope-field').hidden = !fearless;
        $('clear-played').disabled = !state.teams.blue.played.length && !state.teams.red.played.length;
        renderPlayed(state, fearless);

        const box = $('phase-box');
        box.classList.toggle('blue', !!step && step.side === 'blue');
        box.classList.toggle('red', !!step && step.side === 'red');
        $('phase-step').textContent = step ? 'Phase ' + (d.step + 1) + ' of ' + seq.length : 'All phases done';
        $('phase-name').textContent = step
            ? state.teams[step.side].name + ' – ' + step.type + (step.slots.length > 1 ? ' × ' + step.slots.length : '')
            : 'Draft complete';

        $('timer-toggle').textContent = d.timer.running ? 'Pause timer' : 'Start timer';
        $('timer-toggle').disabled = !step;
        $('undo').disabled = !history.length;
        // Changing the ban count mid-draft would reshuffle the phase order.
        $('ban-count').disabled = d.step > 0;

        const hint = $('target-hint');
        if (t) {
            hint.textContent = 'Next hero goes to: ' + state.teams[t.side].name + ' ' + t.type + ' ' + (t.i + 1) +
                (selected ? ' (selected manually – click the slot again to cancel).' : '.') +
                ' Click any slot to change it, right-click to clear it, drag one pick onto another to swap them.';
        } else {
            hint.textContent = 'Draft complete. Click a slot to replace its hero, right-click to clear it, or drag one pick onto another to swap them.';
        }
        renderTimer(state);
    }

    // ---- events ----------------------------------------------------------
    function readImage(file, maxSize, done) {
        const reader = new FileReader();
        reader.onload = function () {
            const img = new Image();
            img.onload = function () {
                // Downscale so the shared state stays small.
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                done(canvas.toDataURL('image/png'));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    function slotOf(btn) {
        return { side: btn.dataset.side, type: btn.dataset.type, i: Number(btn.dataset.i) };
    }

    function bindEvents() {
        document.addEventListener('click', function (e) {
            const tab = e.target.closest('[data-tab], [data-goto]');
            if (tab) { showTab(tab.dataset.tab || tab.dataset.goto); return; }
            const eventBtn = e.target.closest('.ebtn');
            if (eventBtn) { announce(eventBtn); return; }
            if (e.target.closest('#event-hide')) { hideBanner(); return; }
            if (e.target.closest('#season-export')) { exportSeason(); return; }
            const mvpBtn = e.target.closest('.mvp-pick');
            if (mvpBtn) { if (!mvpBtn.disabled) pickMvp(mvpBtn.dataset.side, Number(mvpBtn.dataset.i)); return; }
            const actBtn = e.target.closest('[data-act]');
            if (actBtn) {
                const name = actBtn.dataset.act;
                if (needsConfirm[name] && !armed(actBtn)) return;
                const game = Store.get().tournament.game;
                Store.update(function (s) { actions[name](s, actBtn); });
                // A new game starts with its draft.
                if (Store.get().tournament.game > game) showTab('draft');
                return;
            }
            const slot = e.target.closest('.slot');
            if (slot) {
                const s = slotOf(slot);
                const same = selected && selected.side === s.side && selected.type === s.type && selected.i === s.i;
                selected = same ? null : s;
                render(Store.get());
                $('search').focus();
                return;
            }
            const hero = e.target.closest('.hero');
            if (hero && !hero.disabled) { lockHero(hero.dataset.hero); return; }
            const chip = e.target.closest('.chip');
            if (chip) {
                roleFilter = chip.dataset.role;
                document.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === chip); });
                applyFilter();
                return;
            }
            const copy = e.target.closest('[data-copy]');
            if (copy) {
                const text = $(copy.dataset.copy).textContent;
                const ok = function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1500); };
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { });
            }
        });

        document.addEventListener('contextmenu', function (e) {
            const chip = e.target.closest('.pchip');
            if (chip) {
                // Correct the played list by hand (e.g. a remade game).
                e.preventDefault();
                Store.update(function (s) {
                    const played = s.teams[chip.dataset.side].played;
                    const entry = played[Number(chip.dataset.entry)];
                    if (!entry) return;
                    entry.heroes = entry.heroes.filter(function (id) { return id !== chip.dataset.hero; });
                    if (!entry.heroes.length) played.splice(Number(chip.dataset.entry), 1);
                });
                return;
            }
            const slot = e.target.closest('.slot');
            if (!slot) return;
            e.preventDefault();
            clearSlot(slotOf(slot));
        });

        // Text, number, select and checkbox fields write straight to the state.
        function onField(e) {
            const input = e.target;
            if (!input.dataset || !input.dataset.bind) return;
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.hasAttribute('data-num')) {
                value = Number(value);
                if (!isFinite(value)) return;
                if (input.min !== '' && input.min !== undefined) value = Math.max(Number(input.min) || 0, value);
            }
            Store.update(function (s) {
                setPath(s, input.dataset.bind, value);
                // A stopped timer follows the configured phase length.
                if (input.dataset.bind === 'draft.banCount') {
                    resetDraft(s);
                    // Older snapshots follow the other phase order.
                    history.length = 0;
                }
                else if (input.dataset.bind === 'idle.minutes' && !s.idle.timer.running) {
                    s.idle.timer.remaining = clamp(value, 0, 180) * 60000;
                }
                // A shorter series cannot be on a game, or a score, past its end.
                else if (input.dataset.bind === 'tournament.bestOf') {
                    s.tournament.game = clamp(s.tournament.game, 1, value);
                    const need = Store.winsNeeded(s);
                    SIDES.forEach(function (side) { s.teams[side].score = clamp(s.teams[side].score, 0, need); });
                    // Both cannot have won the shorter series.
                    if (s.teams.blue.score >= need && s.teams.red.score >= need) s.teams.red.score = need - 1;
                }
                else if (/draft\.(banTime|pickTime)$/.test(input.dataset.bind) && !s.draft.timer.running) {
                    s.draft.timer.remaining = Store.stepDuration(s, Store.currentStep(s));
                }
            });
        }
        document.addEventListener('input', onField);
        document.addEventListener('change', function (e) {
            if (e.target.id === 'season-import') {
                if (e.target.files[0]) importSeason(e.target.files[0]);
                e.target.value = '';
                return;
            }
            if (e.target.id === 'mvp-winner') {
                const name = e.target.value;
                Store.update(function (s) { s.mvp.winner = name; });
                return;
            }
            if (e.target.classList.contains('effect-select')) {
                const name = e.target.value;
                if (name !== OTHER_EFFECT) Store.update(function (s) { s.tournament.effect = name; });
                return;
            }
            if (e.target.type === 'file') {
                const file = e.target.files[0];
                const side = e.target.dataset.logo;
                const forBar = e.target.dataset.image === 'scoreboard';
                if (!file) return;
                readImage(file, side ? 320 : 480, function (dataUrl) {
                    Store.update(function (s) {
                        if (forBar) s.scoreboard.image = dataUrl;
                        else if (side) s.teams[side].logo = dataUrl;
                        else s.tournament.logo = dataUrl;
                    });
                });
                e.target.value = '';
            }
        });

        // Drag one pick onto another pick of the same team to swap heroes.
        let dragging = null;
        document.addEventListener('dragstart', function (e) {
            const slot = e.target.closest && e.target.closest('.slot.pick');
            if (!slot) return;
            dragging = slotOf(slot);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', slot.dataset.i);
        });
        document.addEventListener('dragover', function (e) {
            const slot = e.target.closest && e.target.closest('.slot.pick');
            if (slot && dragging && slot.dataset.side === dragging.side) e.preventDefault();
        });
        document.addEventListener('drop', function (e) {
            const slot = e.target.closest && e.target.closest('.slot.pick');
            if (!slot || !dragging || slot.dataset.side !== dragging.side) return;
            e.preventDefault();
            const from = dragging.i, to = Number(slot.dataset.i), side = dragging.side;
            dragging = null;
            if (from === to) return;
            Store.update(function (s) {
                snapshot(s);
                const row = s.draft.picks[side];
                const tmp = row[from];
                row[from] = row[to];
                row[to] = tmp;
            });
        });
        document.addEventListener('dragend', function () { dragging = null; });

        const search = $('search');
        search.addEventListener('input', applyFilter);
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const used = usedHeroes(Store.get());
                const locked = Store.fearlessLocked(Store.get(), target(Store.get()));
                const first = visibleHeroes().filter(function (hero) { return !used[hero.id] && !locked[hero.id]; })[0];
                if (first && search.value.trim()) {
                    lockHero(first.id);
                    search.value = '';
                    applyFilter();
                }
            } else if (e.key === 'Escape') {
                search.value = '';
                applyFilter();
            }
        });

        document.addEventListener('keydown', function (e) {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
            if (e.key === '/') { e.preventDefault(); showTab('draft'); search.focus(); }
            else if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.altKey && !e.metaKey) showTab(TABS[Number(e.key) - 1]);
        });
    }

    // The control panel is the one that reacts when the clock runs out.
    function renderIdleClock(state) {
        const total = Math.ceil(Store.idleLeft(state) / 1000);
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        $('idle-left').textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        $('idle-left').classList.toggle('low', state.idle.timer.running && total <= 10);
        $('idle-toggle').textContent = state.idle.timer.running ? 'Pause' : 'Resume';
        $('idle-toggle').disabled = !state.idle.timer.running && Store.idleLeft(state) <= 0;
    }

    function watchTimer() {
        const state = Store.get();
        renderTimer(state);
        renderIdleClock(state);
        const d = state.draft;
        if (!d.timer.running || Store.timerLeft(state) > 0) return;
        Store.update(function (s) {
            if (s.draft.autoAdvance) setStep(s, s.draft.step + 1, s.draft.autoTimer);
            else s.draft.timer = { running: false, endsAt: 0, remaining: 0 };
        });
    }

    function showStatus(online, mode) {
        const el = $('status');
        const local = mode !== 'server';
        el.className = 'status ' + (local ? 'warn' : online ? 'ok' : 'bad');
        el.textContent = local ? 'Local mode – overlays only sync inside this browser'
            : online ? 'Connected to overlay server' : 'Overlay server not reachable';
        const base = location.href.replace(/[^/]*$/, '');
        $('url-draft').textContent = base + 'draft.html';
        $('url-scoreboard').textContent = base + 'scoreboard.html';
        $('url-mvp').textContent = base + 'mvp.html';
        $('url-idle').textContent = base + 'idle.html';
        if (local) {
            $('url-hint').textContent = 'OBS cannot sync with this page in local mode. Start “Start Overlay Server.bat” and open the control panel from the address it prints.';
        }
    }

    SIDES.forEach(function (side) { buildTeamCard(side); buildBoard(side); });
    buildPicker();
    buildEvents();
    buildEffects();
    SIDES.forEach(buildStats);
    SIDES.forEach(buildMvpPicks);
    showTab(savedTab() || 'setup');
    // How many files the Media stage has to play (served mode only).
    fetch('api/media', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) { if (Array.isArray(list)) { mediaCount = list.length; renderStageHint(Store.get()); } })
        .catch(function () { });
    bindEvents();
    Store.subscribe(render);
    Store.onStatus(showStatus);
    Store.init();
    setInterval(watchTimer, 100);
})();
