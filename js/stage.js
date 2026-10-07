// Centre stage: fills the gap in the middle of the draft overlay when the
// picks are stacked down the left and right edges. Chosen in Settings:
//   story - follows the draft: matchup card, whose turn it is, a spotlight on
//           every pick and ban with that hero's season record, then both lineups
//   info  - rotates the season pages (standings, schedule, bracket)
//   media - plays the videos and images in Assets/Media
//   off   - leaves the gap clear, for player cameras
(function (global) {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const SPOT_MS = 4500;      // how long a pick or ban stays in the spotlight
    const ROWS = 7;            // table rows per season page

    let root = null;
    let current = '';
    let previous = null;       // picks and bans at the last render, to spot a new one
    let spot = null;
    let spotTimer = null;
    let pages = [];
    let pagesKey = '';
    let pageIndex = 0;
    let pageTimer = null;
    let pageSeconds = 10;
    let media = null;          // file list from the server, null until asked
    let mediaIndex = -1;
    let mediaTimer = null;

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function build() {
        root = $('cstage');
        root.innerHTML =
            '<div class="cs-panel cs-match" data-name="match">' +
            '  <div class="cs-side blue"><div class="logo" id="cs-logo-blue"></div><div class="cs-team fit" id="cs-name-blue"></div></div>' +
            '  <div class="cs-versus"><div class="cs-series"><b class="blue" id="cs-score-blue"></b><span>VS</span><b class="red" id="cs-score-red"></b></div><div class="cs-sub" id="cs-match-sub"></div></div>' +
            '  <div class="cs-side red"><div class="logo" id="cs-logo-red"></div><div class="cs-team fit" id="cs-name-red"></div></div>' +
            '</div>' +
            '<div class="cs-panel cs-turn" data-name="turn">' +
            '  <div class="logo" id="cs-turn-logo"></div>' +
            '  <div class="cs-turn-team fit" id="cs-turn-team"></div>' +
            '  <div class="cs-turn-act" id="cs-turn-act"></div>' +
            '  <div class="cs-turn-clock" id="cs-turn-clock"></div>' +
            '</div>' +
            '<div class="cs-panel cs-spot" data-name="spot">' +
            '  <div class="cs-card"><img id="cs-spot-img" alt=""></div>' +
            '  <div class="cs-spot-text">' +
            '    <div class="cs-spot-tag" id="cs-spot-tag"></div>' +
            '    <div class="cs-spot-hero fit" id="cs-spot-hero"></div>' +
            '    <div class="cs-spot-roles" id="cs-spot-roles"></div>' +
            '    <div class="cs-spot-by fit" id="cs-spot-by"></div>' +
            '    <div class="cs-spot-stat" id="cs-spot-stat"></div>' +
            '  </div>' +
            '</div>' +
            '<div class="cs-panel cs-lineup" data-name="lineup">' +
            '  <div class="cs-lineup-title">Lineups</div>' +
            '  <div class="cs-lineup-cols"><div class="cs-lineup-col blue" id="cs-lineup-blue"></div><div class="cs-lineup-col red" id="cs-lineup-red"></div></div>' +
            '</div>' +
            '<div class="cs-panel cs-info" data-name="info"><div class="cs-info-title" id="cs-info-title"></div><div class="cs-info-bar"><i id="cs-info-bar"></i></div><div class="cs-info-body" id="cs-info-body"></div></div>' +
            '<div class="cs-panel cs-media" data-name="media" id="cs-media"></div>';
    }

    function show(name) {
        if (current === name) return;
        current = name;
        root.querySelectorAll('.cs-panel').forEach(function (panel) { panel.classList.toggle('on', panel.dataset.name === name); });
    }

    // ---- story ------------------------------------------------------------
    function slots(state) {
        const out = {};
        Store.SIDES.forEach(function (side) {
            ['pick', 'ban'].forEach(function (type) {
                state.draft[type + 's'][side].forEach(function (id, i) { out[side + '|' + type + '|' + i] = id || ''; });
            });
        });
        return out;
    }

    // A slot that just went from empty (or another hero) to a hero is a lock-in.
    function findLockIn(state) {
        const now = slots(state);
        let found = null;
        if (previous) {
            Object.keys(now).forEach(function (key) {
                if (now[key] && now[key] !== previous[key]) {
                    const parts = key.split('|');
                    found = { hero: now[key], side: parts[0], type: parts[1], i: Number(parts[2]) };
                }
            });
        }
        previous = now;
        return found;
    }

    function renderSpot(state) {
        const hero = Heroes.get(spot.hero);
        if (!hero) return;
        const team = state.teams[spot.side];
        const banned = spot.type === 'ban';
        const panel = root.querySelector('.cs-spot');
        panel.classList.toggle('is-ban', banned);
        panel.classList.toggle('blue', spot.side === 'blue');
        panel.classList.toggle('red', spot.side === 'red');
        $('cs-spot-img').src = hero.img;
        $('cs-spot-tag').textContent = banned ? 'Banned' : 'Picked';
        $('cs-spot-hero').textContent = hero.name;
        Overlay.fitText($('cs-spot-hero'), 150, 60);
        $('cs-spot-roles').textContent = hero.roles.join(' · ');
        const player = !banned && team.players[spot.i];
        $('cs-spot-by').textContent = (player ? player + ' · ' : 'by ') + team.name;
        Overlay.fitText($('cs-spot-by'), 54, 26);
        spotStat(state, spot.hero, banned);
        // replay the entrance for every lock-in
        panel.classList.remove('pop');
        void panel.offsetWidth;
        panel.classList.add('pop');
    }

    function renderMatch(state) {
        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            Overlay.renderLogo($('cs-logo-' + side), team);
            if (Overlay.setText($('cs-name-' + side), team.name)) Overlay.fitText($('cs-name-' + side), 76, 34);
            Overlay.setText($('cs-score-' + side), String(team.score));
        });
        const t = state.tournament;
        Overlay.setText($('cs-match-sub'), (t.stage ? t.stage + ' · ' : '') + 'Game ' + t.game + ' · Best of ' + t.bestOf);
    }

    function renderTurn(state, step) {
        const team = state.teams[step.side];
        const panel = root.querySelector('.cs-turn');
        panel.classList.toggle('blue', step.side === 'blue');
        panel.classList.toggle('red', step.side === 'red');
        Overlay.renderLogo($('cs-turn-logo'), team);
        if (Overlay.setText($('cs-turn-team'), team.name)) Overlay.fitText($('cs-turn-team'), 110, 44);
        Overlay.setText($('cs-turn-act'), step.type === 'ban' ? 'is banning' : (step.slots.length > 1 ? 'picks two' : 'is picking'));
    }

    // ---- season hero records ------------------------------------------------
    function heroRecord(state, id) {
        return state.season.heroes.filter(function (row) { return row.id === id; })[0] || null;
    }
    function winRate(row) { return row && row.p ? Math.round(row.w / row.p * 100) : null; }

    // The line under a spotlighted hero. Nothing is claimed until the season
    // has at least one counted game.
    function spotStat(state, id, banned) {
        const box = $('cs-spot-stat');
        box.textContent = '';
        if (!state.season.heroes.length) return;
        const row = heroRecord(state, id);
        const add = function (big, small) {
            const cell = el('div', 'cs-stat');
            cell.appendChild(el('b', '', big));
            cell.appendChild(el('i', '', small));
            box.appendChild(cell);
        };
        if (!row || (!row.p && !row.b)) { add('New', banned ? 'first ban this season' : 'first pick this season'); return; }
        if (row.p) {
            add(winRate(row) + '%', 'win rate');
            add(row.w + ' \u2013 ' + (row.p - row.w), 'won \u2013 lost');
        } else {
            add('0', 'times picked');
        }
        add(String(row.b), row.b === 1 ? 'ban' : 'bans');
    }

    // After the draft: who is playing what, and how that hero has done this
    // season. The team's own record comes from the standings when its name
    // is listed there.
    function renderLineup(state) {
        Store.SIDES.forEach(function (side) {
            const box = $('cs-lineup-' + side);
            const team = state.teams[side];
            const picks = state.draft.picks[side];
            const standing = state.season.standings.filter(function (r) {
                return String(r.team || '').trim().toLowerCase() === team.name.trim().toLowerCase();
            })[0];
            const record = standing && (String(standing.w).trim() || String(standing.l).trim())
                ? (standing.w || 0) + ' \u2013 ' + (standing.l || 0) : '';
            const key = JSON.stringify([team.name, team.players, picks, record, state.season.heroes]);
            if (box.dataset.key === key) return;
            box.dataset.key = key;
            box.textContent = '';
            const head = el('div', 'cs-lineup-team');
            head.appendChild(el('span', '', team.name));
            if (record) head.appendChild(el('b', '', record));
            box.appendChild(head);
            picks.forEach(function (id, i) {
                const hero = Heroes.get(id);
                if (!hero) return;
                const row = el('div', 'cs-lineup-row');
                const face = el('div', 'cs-face');
                const img = el('img');
                img.alt = '';
                img.src = hero.img;
                face.appendChild(img);
                row.appendChild(face);
                const who = el('div', 'cs-who');
                who.appendChild(el('b', '', team.players[i] || hero.name));
                who.appendChild(el('i', '', team.players[i] ? hero.name : hero.roles.join(' \u00b7 ')));
                row.appendChild(who);
                const rec = heroRecord(state, id);
                const stat = el('div', 'cs-rec');
                if (rec && rec.p) {
                    stat.appendChild(el('b', '', winRate(rec) + '%'));
                    stat.appendChild(el('i', '', rec.w + ' \u2013 ' + (rec.p - rec.w)));
                } else if (state.season.heroes.length) {
                    stat.appendChild(el('b', 'new', 'New'));
                    stat.appendChild(el('i', '', 'this season'));
                }
                row.appendChild(stat);
                box.appendChild(row);
            });
        });
    }

    // ---- season info -------------------------------------------------------
    function filled(row, keys) { return keys.some(function (k) { return String(row[k] == null ? '' : row[k]).trim(); }); }
    function num(v) { const n = Number(v); return isFinite(n) && String(v).trim() !== '' ? n : null; }
    function chunk(list, size) {
        const out = [];
        for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
        return out;
    }

    // Schedule times are stored as Philippine wall-clock time ("2026-10-10T18:00")
    // and printed as written, so they read the same on any computer. Older
    // free-text values are shown unchanged.
    const WHEN = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/;
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function formatWhen(value) {
        const m = WHEN.exec(value || '');
        if (!m) return value || '';
        const day = DAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
        const hour = Number(m[4]);
        return day + ' ' + Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ', ' + (hour % 12 || 12) + ':' + m[5] + (hour >= 12 ? ' PM' : ' AM');
    }

    function standingsPages(season) {
        const rows = season.standings.filter(function (r) { return filled(r, ['team']); });
        const usesPoints = rows.some(function (r) { return num(r.pts) !== null; });
        rows.sort(function (a, b) {
            return ((num(b.pts) || 0) - (num(a.pts) || 0)) || ((num(b.w) || 0) - (num(a.w) || 0)) || ((num(a.l) || 0) - (num(b.l) || 0));
        });
        return chunk(rows.map(function (r, i) { return { rank: i + 1, row: r }; }), ROWS).map(function (part) {
            return { title: 'Standings', build: function (body) {
                const table = el('div', 'cs-table standings' + (usesPoints ? '' : ' no-pts'));
                const head = el('div', 'cs-tr head');
                ['#', 'Team', 'W', 'L'].concat(usesPoints ? ['Pts'] : []).forEach(function (h) { head.appendChild(el('span', '', h)); });
                table.appendChild(head);
                part.forEach(function (item) {
                    const tr = el('div', 'cs-tr' + (item.rank === 1 ? ' lead' : ''));
                    [item.rank, item.row.team, item.row.w, item.row.l].concat(usesPoints ? [item.row.pts] : []).forEach(function (v) {
                        tr.appendChild(el('span', '', String(v == null ? '' : v)));
                    });
                    table.appendChild(tr);
                });
                body.appendChild(table);
            } };
        });
    }

    function schedulePages(season, state) {
        const rows = season.schedule.filter(function (r) { return filled(r, ['a', 'b']); });
        // Dated matches in date order; anything undated keeps its place at the end.
        rows.sort(function (a, b) {
            const da = WHEN.test(a.when || ''), db = WHEN.test(b.when || '');
            return da && db ? (a.when < b.when ? -1 : a.when > b.when ? 1 : 0) : (da ? -1 : db ? 1 : 0);
        });
        // The match on screen right now is "Live"; the first other match still
        // to be played is "Next".
        const names = Store.SIDES.map(function (side) { return state.teams[side].name.trim().toLowerCase(); });
        const open = rows.filter(function (r) { return !String(r.score || '').trim(); });
        const live = open.filter(function (r) {
            const pair = [String(r.a || '').trim().toLowerCase(), String(r.b || '').trim().toLowerCase()];
            return (pair[0] === names[0] && pair[1] === names[1]) || (pair[0] === names[1] && pair[1] === names[0]);
        })[0];
        const next = open.filter(function (r) { return r !== live; })[0];
        return chunk(rows, ROWS).map(function (part) {
            return { title: 'Schedule \u00b7 PH time', build: function (body) {
                const table = el('div', 'cs-table schedule');
                part.forEach(function (r) {
                    const played = !!String(r.score || '').trim();
                    const tr = el('div', 'cs-tr' + (r === live ? ' live' : r === next ? ' next' : played ? ' played' : ''));
                    tr.appendChild(el('span', 'when', formatWhen(r.when)));
                    tr.appendChild(el('span', 'a', r.a || ''));
                    const score = el('span', 'score');
                    score.appendChild(el('em', '', r.score || (r === live ? 'Live' : r === next ? 'Next' : 'vs')));
                    tr.appendChild(score);
                    tr.appendChild(el('span', 'b', r.b || ''));
                    table.appendChild(tr);
                });
                body.appendChild(table);
            } };
        });
    }

    function bracketPages(season) {
        const rows = season.bracket.filter(function (r) { return filled(r, ['a', 'b']); });
        if (!rows.length) return [];
        const rounds = [];
        rows.forEach(function (r) {
            const name = String(r.round || '').trim() || 'Bracket';
            let round = rounds.filter(function (x) { return x.name === name; })[0];
            if (!round) { round = { name: name, matches: [] }; rounds.push(round); }
            round.matches.push(r);
        });
        return chunk(rounds, 4).map(function (part) {
            return { title: 'Bracket', build: function (body) {
                const grid = el('div', 'cs-bracket');
                part.forEach(function (round) {
                    const col = el('div', 'cs-round');
                    col.appendChild(el('div', 'cs-round-name', round.name));
                    const ties = el('div', 'cs-ties');
                    col.appendChild(ties);
                    round.matches.slice(0, 4).forEach(function (m) {
                        const sa = num(m.sa), sb = num(m.sb);
                        const box = el('div', 'cs-tie' + (sa === null || sb === null ? ' open' : ''));
                        [[m.a, m.sa, sa !== null && sb !== null && sa > sb], [m.b, m.sb, sa !== null && sb !== null && sb > sa]].forEach(function (side) {
                            const line = el('div', 'cs-tie-row' + (side[2] ? ' win' : ''));
                            line.appendChild(el('span', '', side[0] || 'TBD'));
                            line.appendChild(el('b', '', String(side[1] == null ? '' : side[1])));
                            box.appendChild(line);
                        });
                        ties.appendChild(box);
                    });
                    grid.appendChild(col);
                });
                body.appendChild(grid);
            } };
        });
    }

    function heroPages(state) {
        const rows = state.season.heroes.filter(function (r) { return r.p || r.b; })
            .sort(function (a, b) { return (b.p + b.b) - (a.p + a.b) || b.w - a.w; }).slice(0, ROWS * 2);
        return chunk(rows, ROWS).map(function (part) {
            return { title: 'Most contested heroes', build: function (body) {
                const table = el('div', 'cs-table heroes');
                const head = el('div', 'cs-tr head');
                ['Hero', 'Picked', 'Win rate', 'Banned'].forEach(function (h) { head.appendChild(el('span', '', h)); });
                table.appendChild(head);
                part.forEach(function (r) {
                    const hero = Heroes.get(r.id);
                    const tr = el('div', 'cs-tr');
                    const name = el('span', 'hero');
                    if (hero) { const img = el('img'); img.alt = ''; img.src = hero.img; name.appendChild(img); }
                    name.appendChild(document.createTextNode(hero ? hero.name : r.id));
                    tr.appendChild(name);
                    tr.appendChild(el('span', '', String(r.p)));
                    tr.appendChild(el('span', 'rate', r.p ? winRate(r) + '%' : '\u2013'));
                    tr.appendChild(el('span', '', String(r.b)));
                    table.appendChild(tr);
                });
                body.appendChild(table);
            } };
        });
    }

    function showPage() {
        if (!pages.length) return;
        const page = pages[pageIndex % pages.length];
        const panel = root.querySelector('.cs-info');
        const body = $('cs-info-body');
        body.textContent = '';
        $('cs-info-title').textContent = page.title;
        page.build(body);
        panel.classList.remove('turn');
        // restart the countdown bar; it only runs when there is another page to come
        const bar = $('cs-info-bar');
        bar.style.animation = 'none';
        void panel.offsetWidth;
        panel.classList.add('turn');
        bar.style.animation = pages.length > 1 ? 'cs-bar ' + pageSeconds + 's linear both' : 'none';
    }

    function renderInfo(state) {
        const season = state.season;
        const seconds = Math.max(4, Number(season.seconds) || 10);
        const key = JSON.stringify([season.standings, season.schedule, season.bracket, season.heroes, seconds,
            state.teams.blue.name, state.teams.red.name]);
        if (key === pagesKey) return;
        pagesKey = key;
        pages = standingsPages(season).concat(schedulePages(season, state), bracketPages(season), heroPages(state));
        pageSeconds = seconds;
        pageIndex = 0;
        clearInterval(pageTimer);
        showPage();
        pageTimer = setInterval(function () { pageIndex += 1; showPage(); }, seconds * 1000);
    }

    // ---- media ------------------------------------------------------------
    function loadMedia() {
        media = [];
        fetch('api/media', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) { media = Array.isArray(list) ? list : []; if (media.length && current === 'media') nextMedia(); })
            .catch(function () { media = []; });
    }

    function nextMedia() {
        clearTimeout(mediaTimer);
        if (!media || !media.length) return;
        mediaIndex = (mediaIndex + 1) % media.length;
        const src = media[mediaIndex];
        const box = $('cs-media');
        box.textContent = '';
        if (/\.(mp4|webm)$/i.test(src)) {
            const video = el('video');
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;
            video.loop = media.length === 1;
            video.onended = nextMedia;
            video.onerror = function () { mediaTimer = setTimeout(nextMedia, 1000); };
            video.src = src;
            box.appendChild(video);
        } else {
            const img = el('img');
            img.alt = '';
            img.src = src;
            box.appendChild(img);
            if (media.length > 1) mediaTimer = setTimeout(nextMedia, 8000);
        }
    }

    // ---- main -------------------------------------------------------------
    function render(state) {
        if (!root) build();
        const sides = $('draft').dataset.layout === 'sides';
        const mode = sides ? (state.draft.stage || 'off') : 'off';
        const lockIn = findLockIn(state);
        root.classList.toggle('hidden', mode === 'off');
        if (mode === 'off') { show(''); return; }

        renderMatch(state);
        if (mode === 'story') {
            if (lockIn) {
                spot = lockIn;
                renderSpot(state);
                clearTimeout(spotTimer);
                spotTimer = setTimeout(function () { spot = null; render(Store.get()); }, SPOT_MS);
            }
            const step = Store.currentStep(state);
            const any = Object.keys(previous).some(function (k) { return previous[k]; });
            if (spot) show('spot');
            else if (!step) { renderLineup(state); show(any ? 'lineup' : 'match'); }
            else if (state.draft.step === 0 && !any && !state.draft.timer.running) show('match');
            else { renderTurn(state, step); show('turn'); }
        } else if (mode === 'info') {
            renderInfo(state);
            show(pages.length ? 'info' : 'match');
        } else if (mode === 'media') {
            if (media === null) loadMedia();
            if (media && media.length && current !== 'media') { show('media'); nextMedia(); }
            else if (!media || !media.length) show('match');
        }
        tick();
    }

    function tick() {
        if (!root || current !== 'turn') return;
        const state = Store.get();
        const left = Store.timerLeft(state);
        const clock = $('cs-turn-clock');
        Overlay.setText(clock, String(Math.ceil(left / 1000)));
        clock.classList.toggle('low', state.draft.timer.running && left <= 10000);
    }

    global.CentreStage = { render: render, tick: tick };
})(window);
