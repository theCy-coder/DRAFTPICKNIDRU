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
                // only the scores, so other edits to the season survive an undo
                scores: state.season.schedule.map(function (r) { return r.score; }),
                bracket: state.season.bracket.map(function (r) { return [r.sa, r.sb]; }),
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
        if (snap.series.scores && snap.series.scores.length === state.season.schedule.length) {
            state.season.schedule.forEach(function (r, i) { r.score = snap.series.scores[i]; });
        }
        if (snap.series.bracket && snap.series.bracket.length === state.season.bracket.length) {
            state.season.bracket.forEach(function (r, i) { r.sa = snap.series.bracket[i][0]; r.sb = snap.series.bracket[i][1]; });
        }
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
        // Empty a side: no team, tag, logo or players. The score is left alone.
        'team-clear': function (s, b) {
            const team = s.teams[b.dataset.side];
            team.name = '';
            team.tag = '';
            team.logo = '';
            team.players = ['', '', '', '', ''];
        },
        'tour-logo-clear': function (s) { s.tournament.logo = ''; },
        'sb-image-clear': function (s) { s.scoreboard.image = ''; },
        // Season tab
        'season-add': function (s, b) {
            const list = b.dataset.list;
            if (list === 'players') { s.season.players.push({ name: '', team: b.dataset.team || '', photo: '', show: 'default' }); return; }
            const row = {};
            SEASON_COLUMNS[list].forEach(function (col) { row[col.key] = ''; });
            s.season[list].push(row);
        },
        'season-team-add': function (s) { s.season.teams.push({ id: newId(), name: '', tag: '', logo: '' }); },
        // Removing a team leaves its players on the roster, without a team.
        'season-team-del': function (s, b) {
            const gone = s.season.teams.splice(Number(b.dataset.i), 1)[0];
            if (gone) s.season.players.forEach(function (p) { if (p.team === gone.id) p.team = ''; });
        },
        'season-team-logo-clear': function (s, b) { if (s.season.teams[Number(b.dataset.i)]) s.season.teams[Number(b.dataset.i)].logo = ''; },
        // Put the two teams of the current match, and their players, into the
        // season. Teams and players already there (by name) are left alone.
        'players-fill': function (s) {
            const have = {};
            s.season.players.forEach(function (p) { have[String(p.name || '').trim().toLowerCase()] = true; });
            SIDES.forEach(function (side) {
                const live = s.teams[side];
                const name = String(live.name || '').trim();
                if (!name) return;
                let team = s.season.teams.filter(function (t) { return String(t.name || '').trim().toLowerCase() === name.toLowerCase(); })[0];
                if (!team) {
                    team = { id: newId(), name: name, tag: live.tag || '', logo: live.logo || '' };
                    s.season.teams.push(team);
                }
                live.players.forEach(function (nick) {
                    const key = String(nick || '').trim().toLowerCase();
                    if (!key || have[key]) return;
                    have[key] = true;
                    s.season.players.push({ name: nick.trim(), team: team.id, photo: '' });
                });
            });
        },
        // Deleting the uploaded photo puts the player back on the default picture.
        'player-photo-clear': function (s, b) {
            const player = s.season.players[Number(b.dataset.i)];
            if (!player) return;
            player.photo = '';
            if ((player.show || 'own') === 'own') player.show = 'default';
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
            if (seriesWinner(s)) recordResult(s);
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
            // who is on this side right now
            '<div class="team-now">' +
            '  <div class="logo-preview" id="logo-preview-' + side + '"></div>' +
            '  <div><b id="team-now-name-' + side + '"></b><span id="team-now-tag-' + side + '"></span></div>' +
            '</div>' +
            // the one control: a team made on the Season tab brings its tag, logo and players
            '<div class="team-pick">' +
            '  <label class="field loader">Team<select data-load-team="' + side + '" aria-label="Team on the ' + side + ' side"></select></label>' +
            '  <button type="button" class="btn ghost" data-act="team-clear" data-side="' + side + '">Clear</button>' +
            '</div>' +
            '<p class="hint bad" data-clash hidden>The same team is on both sides. Pick a different team here or on the other side.</p>' +
            '<p class="hint" data-no-teams>No season teams yet. Add them on the Season tab to pick them here, or type this one in below.</p>' +
            // only for a one-off team that is not in the season
            '<details class="more" data-manual>' +
            '<summary>Type a team in by hand</summary>' +
            '<div class="inline">' +
            '  <label class="field grow">Team name<input type="text" data-bind="teams.' + side + '.name" placeholder="Team name"></label>' +
            '  <label class="field tag">Tag<input type="text" maxlength="4" data-bind="teams.' + side + '.tag" placeholder="TAG"></label>' +
            '</div>' +
            '<div class="field">Logo<div class="logo-row">' +
            '  <label class="btn">Upload<input type="file" accept="image/*" data-logo="' + side + '" hidden></label>' +
            '  <button type="button" class="btn ghost" data-act="logo-clear" data-side="' + side + '">Remove</button>' +
            '</div></div>' +
            '</details>';
    }

    // ---- tabs ------------------------------------------------------------
    // Each tab holds what one moment of the broadcast needs and nothing else.
    const TABS = ['setup', 'draft', 'live', 'settings', 'season'];
    const TAB_KEY = 'mlbb-overlay-tab';
    let currentTab = 'setup';

    // ---- hotkeys -----------------------------------------------------------
    // Live game: the keyboard's three letter rows are blue, red and the map,
    // with the same announcement in the same column for both teams.
    const EVENT_KEYS = {
        blue: { 'turtle-kill': 'q', 'lord-kill': 'w', 'tower-kill': 'e', 'first-blood': 'r', 'savage': 't', 'wipeout': 'y' },
        red: { 'turtle-kill': 'a', 'lord-kill': 's', 'tower-kill': 'd', 'first-blood': 'f', 'savage': 'g', 'wipeout': 'h' },
        '': { 'turtle-spawn': 'z', 'lord-spawn': 'x', 'lord-luminous': 'c' }
    };
    const HOTKEYS_KEY = 'mlbb-overlay-hotkeys';
    function hotkeysOn() { return $('hotkeys-on').checked; }

    // Returns true when the key did something.
    function hotkey(e, typing) {
        if (!hotkeysOn() || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return false;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (currentTab === 'draft') {
            // in the search box these only act while it is empty
            if (typing && (e.target.id !== 'search' || e.target.value)) return false;
            const act = key === ' ' ? 'timer-toggle' : key === 'ArrowRight' ? 'step-next' : key === 'ArrowLeft' ? 'step-prev' : '';
            const btn = act && document.querySelector('[data-panel="draft"] [data-act="' + act + '"]');
            if (!btn || btn.disabled) return false;
            btn.click();
            return true;
        }
        if (currentTab === 'live' && !typing) {
            if (key === 'Escape') { hideBanner(); return true; }
            const btn = document.querySelector('.ebtn[data-key="' + key + '"]');
            if (!btn) return false;
            announce(btn);
            return true;
        }
        return false;
    }

    function showTab(name) {
        if (TABS.indexOf(name) < 0) name = 'draft';
        currentTab = name;
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

    // Settings and Season are split into sub-tabs, so one group of cards is on
    // screen at a time. Each tab remembers the group it was left on.
    const SUB_KEY = 'mlbb-overlay-sub-';

    function showSub(group, name) {
        const panel = document.querySelector('[data-panel="' + group + '"]');
        const buttons = panel.querySelectorAll('[data-sub]');
        const names = Array.prototype.map.call(buttons, function (b) { return b.dataset.sub; });
        if (names.indexOf(name) < 0) name = names[0];
        panel.querySelectorAll('[data-subpanel]').forEach(function (p) { p.hidden = p.dataset.subpanel !== name; });
        buttons.forEach(function (b) {
            b.classList.toggle('on', b.dataset.sub === name);
            b.setAttribute('aria-selected', b.dataset.sub === name);
        });
        try { localStorage.setItem(SUB_KEY + group, name); } catch (e) { /* blocked */ }
    }

    function savedSub(group) {
        try { return localStorage.getItem(SUB_KEY + group); } catch (e) { return null; }
    }

    // The sticky header's height, for the screens that fill the rest of the window.
    function measureTop() {
        document.documentElement.style.setProperty('--top', $('topbar').offsetHeight + 'px');
    }

    // ---- announcements (Live tab) ----------------------------------------
    function eventButton(def, side) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ebtn';
        btn.dataset.event = def.id;
        btn.dataset.side = side || '';
        if (def.color) btn.style.setProperty('--team', def.color);
        btn.innerHTML = '<i>' + GameEvents.icons[def.icon] + '</i><span></span><kbd></kbd>';
        btn.querySelector('span').textContent = def.label;
        const key = EVENT_KEYS[side || ''][def.id] || '';
        btn.dataset.key = key;
        btn.querySelector('kbd').textContent = key.toUpperCase();
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
    const TEAM_CELL = { team: true, a: true, b: true };

    // A team is chosen, not typed, wherever the season already knows the teams.
    // A name that is not a season team (an old row, "TBD") stays selectable.
    function teamSelect(names, value, extra) {
        const select = document.createElement('select');
        select.add(new Option('Choose a team\u2026', ''));
        names.concat(extra || []).forEach(function (name) { select.add(new Option(name, name)); });
        if (value && names.indexOf(value) < 0 && (extra || []).indexOf(value) < 0) select.add(new Option(value + ' (not a season team)', value));
        return select;
    }

    function seasonTeamNames(state) {
        return state.season.teams.map(function (t) { return String(t.name || '').trim(); }).filter(Boolean);
    }

    function renderSeason(state) {
        const names = seasonTeamNames(state);
        Object.keys(SEASON_COLUMNS).forEach(function (list) {
            const box = $('season-' + list);
            const rows = state.season[list];
            // Dropdowns are rebuilt when the teams or a chosen team change; plain
            // text boxes only when a row is added or removed, so typing keeps its place.
            const key = !names.length ? String(rows.length) : rows.length + '|' + names.join('|') + '|' +
                rows.map(function (row) { return [row.team, row.a, row.b].join(','); }).join(';');
            if (box.dataset.count === key) return;
            box.dataset.count = key;
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
                    const pickTeam = TEAM_CELL[col.key] && names.length;
                    const input = pickTeam ? teamSelect(names, row[col.key], list === 'bracket' ? ['TBD'] : [])
                        : document.createElement('input');
                    if (!pickTeam) input.type = col.type || 'text';
                    input.style.flexGrow = col.grow;
                    input.setAttribute('aria-label', col.label);
                    input.dataset.bind = 'season.' + list + '.' + i + '.' + col.key;
                    if (col.key === 'team' || col.key === 'a' || col.key === 'b') input.setAttribute('list', 'season-team-names');
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

    // Crop a photo to an upright 4:5 portrait and shrink it: large enough to
    // lead the MVP screen, small enough that a full roster stays a light state. WebP keeps a cut-out's transparency.
    function readPhoto(file, done) {
        const reader = new FileReader();
        reader.onload = function () {
            const img = new Image();
            img.onload = function () {
                const W = 400, H = 500;
                const canvas = document.createElement('canvas');
                canvas.width = W;
                canvas.height = H;
                const scale = Math.max(W / img.width, H / img.height);
                const w = img.width * scale, h = img.height * scale;
                // centred across, biased to the top where the face is
                canvas.getContext('2d').drawImage(img, (W - w) / 2, (H - h) * 0.2, w, h);
                done(canvas.toDataURL('image/webp', 0.86));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    }

    function newId() { return 't' + Math.random().toString(36).slice(2, 9); }

    // A state saved before teams existed keeps each player's team as plain
    // text. Turn those names into real teams once, so nothing has to be retyped.
    function upgradeRoster() {
        const season = Store.get().season;
        const known = {};
        season.teams.forEach(function (t) { known[t.id] = true; });
        if (!season.players.some(function (p) { return p.team && !known[p.team]; })) return;
        Store.update(function (st) {
            const byName = {};
            st.season.teams.forEach(function (t) { byName[String(t.name || '').trim().toLowerCase()] = t; });
            st.season.players.forEach(function (player) {
                if (!player.team || st.season.teams.some(function (t) { return t.id === player.team; })) return;
                const name = String(player.team).trim();
                const key = name.toLowerCase();
                if (!byName[key]) {
                    const live = SIDES.map(function (side) { return st.teams[side]; })
                        .filter(function (t) { return String(t.name || '').trim().toLowerCase() === key; })[0];
                    byName[key] = { id: newId(), name: name, tag: live ? live.tag : '', logo: live ? live.logo : '' };
                    st.season.teams.push(byName[key]);
                }
                player.team = byName[key].id;
            });
        });
    }

    function button(cls, text, act, data) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.textContent = text;
        btn.dataset.act = act;
        Object.keys(data || {}).forEach(function (k) { btn.dataset[k] = data[k]; });
        return btn;
    }

    function uploadButton(text, key, index) {
        const label = document.createElement('label');
        label.className = 'btn';
        label.textContent = text;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        input.dataset[key] = index;
        label.appendChild(input);
        return label;
    }

    function textBox(bind, label, grow, maxLength) {
        const input = document.createElement('input');
        input.type = 'text';
        input.style.flexGrow = grow;
        input.setAttribute('aria-label', label);
        input.placeholder = label;
        if (maxLength) input.maxLength = maxLength;
        input.dataset.bind = bind;
        return input;
    }

    // Season teams: logo, name, tag. Only rebuilt when a team is added or
    // removed or a logo changes, so typing a name never loses its place.
    function renderSeasonTeams(state) {
        const box = $('season-teams');
        const teams = state.season.teams;
        const key = teams.map(function (t) { return t.id + ':' + (t.logo || '').length; }).join(',');
        if (box.dataset.key !== key) {
            box.dataset.key = key;
            box.textContent = '';
            if (!teams.length) {
                const none = document.createElement('p');
                none.className = 'hint';
                none.textContent = 'No teams yet. Add one, or pull in the two teams from the Setup tab.';
                box.appendChild(none);
            }
            teams.forEach(function (team, i) {
                const line = document.createElement('div');
                line.className = 'srow trow';
                const thumb = document.createElement('b');
                if (team.logo) {
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = team.logo;
                    thumb.appendChild(img);
                }
                line.appendChild(thumb);
                line.appendChild(textBox('season.teams.' + i + '.name', 'Team name', 4));
                line.appendChild(textBox('season.teams.' + i + '.tag', 'Tag', 1, 4));
                const tools = document.createElement('em');
                tools.appendChild(uploadButton('Logo', 'teamlogo', i));
                const clear = button('btn ghost', 'No logo', 'season-team-logo-clear', { i: i });
                clear.disabled = !team.logo;
                tools.appendChild(clear);
                const del = button('btn ghost danger', '\u00d7', 'season-team-del', { i: i });
                del.setAttribute('aria-label', 'Remove this team');
                tools.appendChild(del);
                line.appendChild(tools);
                box.appendChild(line);
            });
        }
        // team names offered while typing standings, schedule and bracket rows
        const names = teams.map(function (t) { return t.name; }).filter(Boolean);
        const list = $('season-team-names');
        if (list.dataset.key !== names.join('|')) {
            list.dataset.key = names.join('|');
            list.textContent = '';
            names.forEach(function (name) { const o = document.createElement('option'); o.value = name; list.appendChild(o); });
        }
    }

    const PHOTO_UPLOAD = '__upload';
    const PHOTO_DELETE = '__delete';

    // The roster, one group per team. Each row: photo, nickname, team dropdown.
    function renderSeasonPlayers(state) {
        const box = $('season-players');
        const teams = state.season.teams;
        const players = state.season.players;
        const key = JSON.stringify([teams.map(function (t) { return [t.id, t.name]; }),
            players.map(function (p) { return [p.team, (p.photo || '').length, p.show || '']; }),
            teams.map(function (t) { return (t.logo || '').length; })]);
        if (box.dataset.key === key) return;
        // rebuilding would move the cursor out of a box that is being typed in
        if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
        box.dataset.key = key;
        box.textContent = '';

        const known = {};
        teams.forEach(function (t) { known[t.id] = true; });
        const groups = teams.map(function (t) { return { id: t.id, name: t.name || 'Unnamed team', logo: t.logo }; })
            .concat([{ id: '', name: 'No team', logo: '' }]);
        groups.forEach(function (group) {
            const rows = [];
            players.forEach(function (player, i) {
                if ((known[player.team] ? player.team : '') === group.id) rows.push(i);
            });
            if (!group.id && !rows.length) return;

            const head = document.createElement('div');
            head.className = 'pgroup-head';
            const title = document.createElement('span');
            title.textContent = group.name + '  \u00b7  ' + rows.length + (rows.length === 1 ? ' player' : ' players');
            head.appendChild(title);
            if (group.id) head.appendChild(button('btn', '+ Add player', 'season-add', { list: 'players', team: group.id }));
            box.appendChild(head);

            rows.forEach(function (i) {
                const player = players[i];
                const line = document.createElement('div');
                line.className = 'srow prow';
                // the thumbnail is what the overlays will actually show
                const show = player.show || (player.photo ? 'own' : 'default');
                const team = teams.filter(function (t) { return t.id === player.team; })[0];
                const thumb = document.createElement('b');
                let src = 'Assets/Other/player-template.svg';
                if (show === 'none') src = '';
                else if (show === 'own' && player.photo) src = player.photo;
                else if (show === 'team' && team && team.logo) { src = team.logo; thumb.className = 'is-logo'; }
                if (src) {
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = src;
                    thumb.appendChild(img);
                } else {
                    thumb.className = 'is-none';
                    thumb.textContent = 'None';
                }
                line.appendChild(thumb);
                line.appendChild(textBox('season.players.' + i + '.name', 'Nickname, as on the Draft tab', 3, 40));
                const select = document.createElement('select');
                select.className = 'player-team';
                select.setAttribute('aria-label', 'Team');
                select.dataset.i = i;
                select.add(new Option('No team', ''));
                teams.forEach(function (t) { select.add(new Option(t.name || 'Unnamed team', t.id)); });
                select.value = known[player.team] ? player.team : '';
                line.appendChild(select);
                // what to show for this player
                const mode = document.createElement('select');
                mode.className = 'player-show';
                mode.setAttribute('aria-label', 'Picture shown for this player');
                mode.dataset.i = i;
                mode.add(new Option('Default picture', 'default'));
                mode.add(new Option(player.photo ? 'Own photo' : 'Own photo (upload one)', 'own'));
                mode.add(new Option(team && team.logo ? 'Team logo' : 'Team logo (team has none)', 'team'));
                mode.add(new Option('No picture', 'none'));
                mode.options[1].disabled = !player.photo;
                mode.options[2].disabled = !(team && team.logo);
                // the same dropdown also uploads or deletes the player's own photo
                const actions = document.createElement('optgroup');
                actions.label = 'Photo file';
                actions.appendChild(new Option(player.photo ? 'Upload a different photo\u2026' : 'Upload a photo\u2026', PHOTO_UPLOAD));
                const remove = new Option('Delete the uploaded photo', PHOTO_DELETE);
                remove.disabled = !player.photo;
                actions.appendChild(remove);
                mode.appendChild(actions);
                mode.value = show;
                mode.dataset.show = show;
                line.appendChild(mode);
                const file = document.createElement('input');
                file.type = 'file';
                file.accept = 'image/*';
                file.hidden = true;
                file.dataset.player = i;
                line.appendChild(file);
                const tools = document.createElement('em');
                const del = button('btn ghost danger', '\u00d7', 'season-del', { list: 'players', i: i });
                del.setAttribute('aria-label', 'Remove this player');
                tools.appendChild(del);
                line.appendChild(tools);
                box.appendChild(line);
            });
            if (!rows.length) {
                const none = document.createElement('p');
                none.className = 'hint pgroup-empty';
                none.textContent = 'No players yet.';
                box.appendChild(none);
            }
        });
        if (!teams.length && !players.length) {
            const none = document.createElement('p');
            none.className = 'hint';
            none.textContent = 'No players yet. Everyone shows the template portrait until you add them here.';
            box.appendChild(none);
        }
    }

    // "Use a season team" on the Setup tab: its options follow the team list.
    function renderTeamLoaders(state) {
        const teams = state.season.teams.filter(function (t) { return t.name; });
        const key = teams.map(function (t) { return t.id + t.name; }).join('|');
        document.querySelectorAll('select[data-load-team]').forEach(function (select) {
            const card = select.closest('.card');
            if (select.dataset.key !== key) {
                select.dataset.key = key;
                select.textContent = '';
                select.add(new Option(teams.length ? 'Choose a team\u2026' : 'No season teams yet', ''));
                teams.forEach(function (t) { select.add(new Option(t.name, t.id)); });
                select.disabled = !teams.length;
                card.querySelector('[data-no-teams]').hidden = !!teams.length;
                // with nothing to choose from, typing is the only way in
                card.querySelector('[data-manual]').open = !teams.length;
            }
            // a team cannot play itself: the one on the other side is greyed out
            const side = select.dataset.loadTeam;
            const other = state.teams[side === 'blue' ? 'red' : 'blue'].name;
            Array.prototype.forEach.call(select.options, function (option) {
                if (!option.value) return;
                const team = teams.filter(function (t) { return t.id === option.value; })[0];
                const taken = !!team && sameName(team.name, other);
                option.disabled = taken;
                option.textContent = team ? team.name + (taken ? '  (on the other side)' : '') : option.textContent;
            });
            // show the season team that is on this side, if it is one
            const match = teams.filter(function (t) { return sameName(t.name, state.teams[side].name); })[0];
            if (select !== document.activeElement) select.value = match ? match.id : '';
            const clash = !!state.teams[side].name && sameName(state.teams[side].name, other);
            card.querySelector('[data-clash]').hidden = !clash;
        });
        syncSides(state);
    }

    // Copy a season team, with its first five players, onto one side.
    function sameName(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

    function seasonTeamByName(state, name) {
        return state.season.teams.filter(function (t) { return t.name && sameName(t.name, name); })[0] || null;
    }

    // The nicknames of a season team's players, in the order they were entered.
    function rosterOf(state, team) {
        return !team ? [] : state.season.players.filter(function (p) { return p.team === team.id && p.name; })
            .map(function (p) { return p.name; });
    }

    function putTeam(st, side, team) {
        st.teams[side].name = team.name;
        st.teams[side].tag = team.tag || '';
        st.teams[side].logo = team.logo || '';
        const roster = rosterOf(st, team);
        st.teams[side].players = [0, 1, 2, 3, 4].map(function (i) { return roster[i] || ''; });
    }

    function loadSeasonTeam(side, id) {
        Store.update(function (st) {
            const team = st.season.teams.filter(function (t) { return t.id === id; })[0];
            if (!team || sameName(team.name, st.teams[side === 'blue' ? 'red' : 'blue'].name)) return;
            putTeam(st, side, team);
        });
    }

    // A side that carries a season team's name also carries that team's tag
    // and logo, so the two never drift apart. Runs after a render, not inside one.
    let sidesTimer = null;
    function staleSides(state) {
        return SIDES.filter(function (side) {
            const team = seasonTeamByName(state, state.teams[side].name);
            return team && ((team.tag || '') !== state.teams[side].tag || (team.logo || '') !== state.teams[side].logo);
        });
    }
    function syncSides(state) {
        if (sidesTimer || !staleSides(state).length) return;
        sidesTimer = setTimeout(function () {
            sidesTimer = null;
            if (!staleSides(Store.get()).length) return;
            Store.update(function (st) {
                staleSides(st).forEach(function (side) {
                    const team = seasonTeamByName(st, st.teams[side].name);
                    st.teams[side].tag = team.tag || '';
                    st.teams[side].logo = team.logo || '';
                });
            });
        }, 0);
    }

    // One choice sets the whole match: both teams with their rosters, and the
    // round name when the bracket has the same pairing.
    function loadMatch(index) {
        Store.update(function (st) {
            const match = st.season.schedule[index];
            if (!match) return;
            [['blue', match.a], ['red', match.b]].forEach(function (pair) {
                putTeam(st, pair[0], seasonTeamByName(st, pair[1]) || { name: pair[1] });
            });
            const round = st.season.bracket.filter(function (r) {
                return r.round && ((sameName(r.a, match.a) && sameName(r.b, match.b)) || (sameName(r.a, match.b) && sameName(r.b, match.a)));
            })[0];
            if (round) st.tournament.stage = round.round;
        });
    }

    // ---- results: the series writes itself into the season -----------------
    function blank(v) { return !String(v == null ? '' : v).trim(); }

    // 1 when the row is blue v red as set up now, -1 when it is the other way round.
    function facing(state, row) {
        const blue = state.teams.blue.name, red = state.teams.red.name;
        if (!blue || !red) return 0;
        return sameName(row.a, blue) && sameName(row.b, red) ? 1 : sameName(row.a, red) && sameName(row.b, blue) ? -1 : 0;
    }

    function pairKey(a, b) {
        return [String(a || '').trim().toLowerCase(), String(b || '').trim().toLowerCase()].sort().join(' | ');
    }

    // Which schedule rows are playoff matches: for each pairing in the bracket,
    // that pairing's latest scheduled matches, one per bracket row.
    function playoffRows(season) {
        const want = {};
        season.bracket.forEach(function (r) { if (r.a && r.b) want[pairKey(r.a, r.b)] = (want[pairKey(r.a, r.b)] || 0) + 1; });
        const out = {};
        Object.keys(want).forEach(function (key) {
            season.schedule.map(function (r, i) { return { r: r, i: i }; })
                .filter(function (x) { return x.r.a && x.r.b && pairKey(x.r.a, x.r.b) === key; })
                .sort(function (x, y) { return String(y.r.when).localeCompare(String(x.r.when)) || y.i - x.i; })
                .slice(0, want[key]).forEach(function (x) { out[x.i] = true; });
        });
        return out;
    }

    // When the series is decided: its score goes into the first unplayed
    // schedule row for these two teams, and into the bracket if it is a playoff.
    function recordResult(s) {
        const playoff = playoffRows(s.season);
        const open = s.season.schedule.map(function (r, i) { return { r: r, i: i }; })
            .filter(function (x) { return facing(s, x.r) && blank(x.r.score); })
            .sort(function (x, y) { return String(x.r.when).localeCompare(String(y.r.when)) || x.i - y.i; })[0];
        if (open) {
            const way = facing(s, open.r);
            open.r.score = (way > 0 ? s.teams.blue.score : s.teams.red.score) + ' \u2013 ' + (way > 0 ? s.teams.red.score : s.teams.blue.score);
        }
        if (open && !playoff[open.i]) return;
        const tie = s.season.bracket.filter(function (r) { return facing(s, r) && blank(r.sa) && blank(r.sb); })[0];
        if (tie) {
            const way = facing(s, tie);
            tie.sa = String(way > 0 ? s.teams.blue.score : s.teams.red.score);
            tie.sb = String(way > 0 ? s.teams.red.score : s.teams.blue.score);
        }
    }

    // Is the finished series in the schedule? Shown next to "Series over".
    function resultSaved(state) {
        return state.season.schedule.some(function (r) {
            const way = facing(state, r);
            const m = /(\d+)\D+(\d+)/.exec(r.score || '');
            return way && m && Number(m[way > 0 ? 1 : 2]) === state.teams.blue.score && Number(m[way > 0 ? 2 : 1]) === state.teams.red.score;
        });
    }

    // The table, from every scored match that is not a playoff.
    function computeStandings(state) {
        const season = state.season;
        const playoff = playoffRows(season);
        const rows = {};
        const row = function (name) {
            const team = seasonTeamByName(state, name);
            const key = String(team ? team.name : name).trim().toLowerCase();
            if (!rows[key]) rows[key] = { team: team ? team.name : String(name).trim(), w: 0, l: 0, gw: 0, gl: 0 };
            return rows[key];
        };
        seasonTeamNames(state).forEach(row);
        season.schedule.forEach(function (r, i) {
            const m = /(\d+)\D+(\d+)/.exec(r.score || '');
            if (playoff[i] || !m || !r.a || !r.b || Number(m[1]) === Number(m[2])) return;
            const a = row(r.a), b = row(r.b), ga = Number(m[1]), gb = Number(m[2]);
            a.gw += ga; a.gl += gb; b.gw += gb; b.gl += ga;
            if (ga > gb) { a.w++; b.l++; } else { b.w++; a.l++; }
        });
        const per = Math.max(0, Number(season.winPoints) || 0);
        return Object.keys(rows).map(function (k) { return rows[k]; })
            .sort(function (x, y) { return y.w - x.w || (y.gw - y.gl) - (x.gw - x.gl) || x.team.localeCompare(y.team); })
            .map(function (r) { return { team: r.team, w: String(r.w), l: String(r.l), pts: String(r.w * per) }; });
    }

    // Keep the stored table equal to the worked-out one, so the overlays and
    // an export always carry it. Runs after a render, never inside one.
    let standingsTimer = null;
    function syncStandings(state) {
        const auto = !!state.season.auto;
        $('season-standings').inert = auto;
        $('season-standings').classList.toggle('auto', auto);
        $('standings-add').hidden = auto;
        $('win-points-field').hidden = !auto;
        $('standings-hint').textContent = auto
            ? 'Worked out for you from the Schedule tab. Enter or change a score there and this table follows.'
            : 'Typed by hand. Shown sorted by points, then wins; leave points empty if you only track wins and losses.';
        if (!auto || standingsTimer) return;
        const table = computeStandings(state);
        if (!table.length || JSON.stringify(table) === JSON.stringify(state.season.standings)) return;
        standingsTimer = setTimeout(function () {
            standingsTimer = null;
            const now = Store.get();
            if (!now.season.auto) return;
            const fresh = computeStandings(now);
            if (fresh.length && JSON.stringify(fresh) !== JSON.stringify(now.season.standings)) {
                Store.update(function (s) { s.season.standings = fresh; });
            }
        }, 0);
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function shortWhen(when) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(when || '');
        return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ', ' + m[4] : '';
    }

    // Setup tab: the season's schedule as a dropdown, matches still to play first.
    function renderMatchLoader(state) {
        const select = $('load-match');
        const rows = state.season.schedule.map(function (m, i) { return { m: m, i: i }; })
            .filter(function (r) { return r.m.a && r.m.b; })
            .sort(function (x, y) { return (x.m.score ? 1 : 0) - (y.m.score ? 1 : 0) || String(x.m.when).localeCompare(String(y.m.when)); });
        $('load-match-field').hidden = !rows.length;
        const key = rows.map(function (r) { return [r.i, r.m.a, r.m.b, r.m.when, r.m.score].join(','); }).join(';');
        if (select.dataset.key !== key) {
            select.dataset.key = key;
            select.textContent = '';
            select.add(new Option('Choose a match\u2026', ''));
            rows.forEach(function (r) {
                const when = shortWhen(r.m.when);
                select.add(new Option(r.m.a + ' vs ' + r.m.b + (when ? '  \u00b7  ' + when : '') + (r.m.score ? '  \u00b7  played ' + r.m.score : ''), r.i));
            });
        }
        if (select === document.activeElement) return;
        // show the scheduled match that is set up right now, if it is one
        const on = rows.filter(function (r) {
            return !r.m.score && sameName(r.m.a, state.teams.blue.name) && sameName(r.m.b, state.teams.red.name);
        })[0] || rows.filter(function (r) {
            return !r.m.score && sameName(r.m.a, state.teams.red.name) && sameName(r.m.b, state.teams.blue.name);
        })[0];
        select.value = on ? String(on.i) : '';
    }

    // Draft tab: with a season roster for the team on a side, each nickname is
    // picked from it; without one it is typed, as before.
    function renderRosters(state) {
        SIDES.forEach(function (side) {
            const roster = rosterOf(state, seasonTeamByName(state, state.teams[side].name));
            const players = state.teams[side].players;
            const key = roster.join('|') + '||' + players.join('|');
            const board = $('board-' + side);
            if (board.dataset.roster === key) return;
            board.dataset.roster = key;
            board.querySelectorAll('.pick-col').forEach(function (col, i) {
                const input = col.querySelector('input');
                const select = col.querySelector('select');
                input.hidden = !!roster.length;
                select.hidden = !roster.length;
                select.textContent = '';
                select.add(new Option('Player ' + (i + 1), ''));
                roster.forEach(function (name) { select.add(new Option(name, name)); });
                if (players[i] && roster.indexOf(players[i]) < 0) select.add(new Option(players[i], players[i]));
                select.value = players[i] || '';
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
        if (Array.isArray(src.teams)) {
            found = true;
            next.teams = src.teams.filter(function (row) { return row && typeof row === 'object'; }).slice(0, 64).map(function (row) {
                const logo = typeof row.logo === 'string' && /^data:image\//.test(row.logo) && row.logo.length < 600000 ? row.logo : '';
                return { id: /^[a-z0-9]{2,12}$/i.test(String(row.id)) ? String(row.id) : newId(),
                    name: String(row.name == null ? '' : row.name).slice(0, 80), tag: String(row.tag == null ? '' : row.tag).slice(0, 4), logo: logo };
            });
        }
        if (Array.isArray(src.players)) {
            found = true;
            next.players = src.players.filter(function (row) { return row && typeof row === 'object'; }).slice(0, 200).map(function (row) {
                const photo = typeof row.photo === 'string' && /^data:image\//.test(row.photo) && row.photo.length < 400000 ? row.photo : '';
                const show = ['default', 'own', 'team', 'none'].indexOf(row.show) >= 0 ? row.show : (photo ? 'own' : 'default');
                return { name: String(row.name == null ? '' : row.name).slice(0, 40), team: String(row.team == null ? '' : row.team).slice(0, 80), photo: photo, show: show };
            });
        }
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
        if (typeof src.auto === 'boolean') next.auto = src.auto;
        if (isFinite(Number(src.winPoints)) && Number(src.winPoints) >= 0) next.winPoints = Math.min(99, Number(src.winPoints));
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
            upgradeRoster();   // a file from before teams existed names each player's team in text
            seasonNote('Imported ' + file.name + ': ' + season.standings.length + ' standings rows, ' +
                season.schedule.length + ' schedule rows, ' + season.bracket.length + ' bracket rows, ' + season.heroes.length + ' hero records, ' + season.teams.length + ' teams, ' + season.players.length + ' players.');
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
            const pickNick = document.createElement('select');   // the same field, chosen from the roster
            pickNick.setAttribute('aria-label', side + ' player ' + (i + 1));
            pickNick.dataset.bind = 'teams.' + side + '.players.' + i;
            pickNick.hidden = true;
            col.appendChild(pickNick);
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
        const key = src || '\n' + fallback;   // without a logo, the text is what changes
        if (el.dataset.src === key) return;
        el.dataset.src = key;
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
        renderSeasonTeams(state);
        renderSeasonPlayers(state);
        renderTeamLoaders(state);
        renderMatchLoader(state);
        renderRosters(state);
        syncStandings(state);
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
                state.teams[winner].score + '\u2013' + state.teams[loser].score + '.' +
                (resultSaved(state) ? ' Saved to the season schedule.' : '');
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
            $('team-now-name-' + side).textContent = team.name || 'No team yet';
            document.querySelector('[data-act="team-clear"][data-side="' + side + '"]').disabled = !team.name && !team.tag && !team.logo;
            $('team-now-tag-' + side).textContent = team.tag || '';
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

        // the same two facts in the header strip, whichever tab is open
        $('now-phase').textContent = step ? $('phase-name').textContent : 'Complete';
        $('now-draft').className = 'now' + (step ? ' ' + step.side : '');
        // how many rows each Season sub-tab holds, so an empty one is obvious
        document.querySelectorAll('[data-subnav="season"] [data-sub]').forEach(function (b) {
            const list = state.season[b.dataset.sub];
            if (Array.isArray(list)) b.dataset.n = list.length;
        });

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
            const sub = e.target.closest('[data-sub]');
            if (sub) { showSub(sub.closest('[data-subnav]').dataset.subnav, sub.dataset.sub); return; }
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
            if (e.target.classList.contains('player-show')) {
                const index = Number(e.target.dataset.i);
                const show = e.target.value;
                if (show === PHOTO_UPLOAD || show === PHOTO_DELETE) {
                    // these two are actions, not choices: put the dropdown back first
                    e.target.value = e.target.dataset.show;
                    if (show === PHOTO_UPLOAD) e.target.closest('.prow').querySelector('input[type="file"]').click();
                    else Store.update(function (s) { actions['player-photo-clear'](s, e.target); });
                    return;
                }
                Store.update(function (s) { if (s.season.players[index]) s.season.players[index].show = show; });
                return;
            }
            if (e.target.classList.contains('player-team')) {
                const index = Number(e.target.dataset.i);
                const id = e.target.value;
                Store.update(function (s) { if (s.season.players[index]) s.season.players[index].team = id; });
                return;
            }
            if (e.target.dataset.loadTeam) {
                if (e.target.value) loadSeasonTeam(e.target.dataset.loadTeam, e.target.value);
                return;
            }
            if (e.target.id === 'load-match') {
                if (e.target.value !== '') loadMatch(Number(e.target.value));
                return;
            }
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
            if (e.target.type === 'file' && e.target.dataset.teamlogo !== undefined) {
                const index = Number(e.target.dataset.teamlogo);
                if (e.target.files[0]) {
                    readImage(e.target.files[0], 320, function (dataUrl) {
                        Store.update(function (s) { if (s.season.teams[index]) s.season.teams[index].logo = dataUrl; });
                    });
                }
                e.target.value = '';
                return;
            }
            if (e.target.type === 'file' && e.target.dataset.player !== undefined) {
                const index = Number(e.target.dataset.player);
                if (e.target.files[0]) {
                    readPhoto(e.target.files[0], function (dataUrl) {
                        // a new photo is what you want shown
                        Store.update(function (s) {
                            if (!s.season.players[index]) return;
                            s.season.players[index].photo = dataUrl;
                            s.season.players[index].show = 'own';
                        });
                    });
                }
                e.target.value = '';
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

        // Space on a focused button would also press that button when the key
        // comes back up; on the Draft tab the key belongs to the timer alone.
        document.addEventListener('keyup', function (e) {
            if (e.key === ' ' && currentTab === 'draft' && hotkeysOn() && (e.target.tagName || '').toLowerCase() === 'button') e.preventDefault();
        });

        document.addEventListener('keydown', function (e) {
            const tag = (e.target.tagName || '').toLowerCase();
            const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
            if (hotkey(e, typing)) { e.preventDefault(); return; }
            if (typing) return;
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
        $('url-loading').textContent = base + 'loading.html';
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
    // control.html#live or control.html#season/players opens straight on that screen
    const linked = location.hash.slice(1).split('/');
    try { $('hotkeys-on').checked = localStorage.getItem(HOTKEYS_KEY) !== 'off'; } catch (e) { /* blocked */ }
    $('hotkeys-on').addEventListener('change', function () {
        document.body.classList.toggle('no-keys', !this.checked);
        try { localStorage.setItem(HOTKEYS_KEY, this.checked ? 'on' : 'off'); } catch (e) { /* blocked */ }
    });
    document.body.classList.toggle('no-keys', !$('hotkeys-on').checked);
    showTab(linked[0] || savedTab() || 'setup');
    document.querySelectorAll('[data-subnav]').forEach(function (nav) {
        showSub(nav.dataset.subnav, (nav.dataset.subnav === linked[0] && linked[1]) || savedSub(nav.dataset.subnav));
    });
    measureTop();
    window.addEventListener('resize', measureTop);
    // How many files the Media stage has to play (served mode only).
    fetch('api/media', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) { if (Array.isArray(list)) { mediaCount = list.length; renderStageHint(Store.get()); } })
        .catch(function () { });
    bindEvents();
    Store.subscribe(render);
    Store.onStatus(showStatus);
    Store.init().then(upgradeRoster);
    setInterval(watchTimer, 100);
})();
