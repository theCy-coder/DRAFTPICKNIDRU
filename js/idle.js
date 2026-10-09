// Waiting screen: who is playing, the series score so far and a countdown,
// for the minutes before a game starts. Run from the Setup tab.
//
// Like a broadcast pre-show it never sits still: the matchup takes turns with
// the day's schedule and the standings, the countdown stays in view on every
// page, and a ticker along the bottom runs results and what is coming up.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }
    function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

    // Gold sparks drifting up the screen. Built once, at random spots.
    function buildSparks() {
        const box = $('idle-sparks');
        for (let i = 0; i < 40; i++) {
            const spark = document.createElement('i');
            const size = 3 + Math.random() * 7;
            spark.style.left = (Math.random() * 100) + '%';
            spark.style.width = spark.style.height = size + 'px';
            spark.style.animationDuration = (7 + Math.random() * 9) + 's';
            spark.style.animationDelay = (-Math.random() * 16) + 's';
            box.appendChild(spark);
        }
    }

    function renderRoster(list, players, state) {
        const names = players.filter(function (name) { return name; });
        const photos = names.map(function (name) { return Overlay.playerPicture(state, name); });
        const key = names.join('|') + '|' + photos.map(function (pic) { return pic.src.length + pic.src.slice(-24) + pic.logo; }).join('|');
        if (list.dataset.key === key) return;
        list.dataset.key = key;
        list.textContent = '';
        names.forEach(function (name, i) {
            const item = document.createElement('li');
            if (photos[i].src) {
                const img = document.createElement('img');
                img.alt = '';
                if (photos[i].logo) img.className = 'is-logo';
                img.src = photos[i].src;
                item.appendChild(img);
            }
            item.appendChild(document.createTextNode(name));
            list.appendChild(item);
        });
    }

    // ---- the season, for the info pages and the ticker -----------------------
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Schedule times are Philippine wall-clock time, so "today" is the PH date.
    function today() { return new Date(Store.now() + 8 * 3600000).toISOString().slice(0, 10); }
    function clockOf(when) { const m = /T(\d{2}:\d{2})/.exec(when || ''); return m ? m[1] : ''; }
    function dayOf(when) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(when || '');
        return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : '';
    }
    function played(row) { return /\d+\D+\d+/.test(row.score || ''); }
    function matches(state) {
        return state.season.schedule.filter(function (r) { return r.a && r.b; })
            .slice().sort(function (x, y) { return String(x.when).localeCompare(String(y.when)); });
    }
    function onNow(state, row) {
        const blue = state.teams.blue.name, red = state.teams.red.name;
        return !played(row) && ((same(row.a, blue) && same(row.b, red)) || (same(row.a, red) && same(row.b, blue)));
    }
    function teamLogo(state, name) {
        const box = el('span', 'ip-logo');
        const team = state.season.teams.filter(function (t) { return same(t.name, name); })[0];
        if (team && team.logo) {
            const img = el('img');
            img.alt = '';
            img.src = team.logo;
            box.appendChild(img);
        } else {
            box.textContent = String(team && team.tag ? team.tag : name).slice(0, 4).toUpperCase();
        }
        return box;
    }

    // Today's matches; on a day with none, the next few still to play.
    function schedulePage(state) {
        const all = matches(state);
        let rows = all.filter(function (r) { return String(r.when).slice(0, 10) === today(); });
        let title = 'Today’s matches';
        if (!rows.length) { rows = all.filter(function (r) { return !played(r); }); title = 'Coming up'; }
        rows = rows.slice(0, 6);
        if (!rows.length) return null;
        const page = el('div', 'ip');
        page.appendChild(el('div', 'ip-title', title));
        let nextMarked = false;
        rows.forEach(function (r, i) {
            const live = onNow(state, r);
            const next = !live && !played(r) && !nextMarked;
            if (next) nextMarked = true;
            const line = el('div', 'ip-match' + (live ? ' live' : '') + (played(r) ? ' done' : ''));
            line.style.setProperty('--d', (0.15 + i * 0.09).toFixed(2) + 's');
            line.appendChild(el('span', 'ip-when', (title === 'Coming up' ? dayOf(r.when) + '  ' : '') + clockOf(r.when)));
            const a = el('span', 'ip-team a');
            a.appendChild(el('b', '', r.a));
            a.appendChild(teamLogo(state, r.a));
            line.appendChild(a);
            line.appendChild(el('span', 'ip-score', played(r) ? r.score : 'VS'));
            const b = el('span', 'ip-team b');
            b.appendChild(teamLogo(state, r.b));
            b.appendChild(el('b', '', r.b));
            line.appendChild(b);
            line.appendChild(el('span', 'ip-badge', live ? 'Up next' : played(r) ? 'Final' : next ? 'Later' : ''));
            page.appendChild(line);
        });
        return page;
    }

    function standingsPage(state) {
        const rows = state.season.standings.filter(function (r) { return r.team; }).slice().sort(function (x, y) {
            return (Number(y.pts) || 0) - (Number(x.pts) || 0) || (Number(y.w) || 0) - (Number(x.w) || 0);
        }).slice(0, 8);
        if (!rows.length) return null;
        const page = el('div', 'ip');
        page.appendChild(el('div', 'ip-title', 'Standings'));
        const head = el('div', 'ip-row head');
        ['', 'Team', 'W', 'L', 'Pts'].forEach(function (h) { head.appendChild(el('span', '', h)); });
        page.appendChild(head);
        rows.forEach(function (r, i) {
            const side = same(r.team, state.teams.blue.name) ? ' blue' : same(r.team, state.teams.red.name) ? ' red' : '';
            const line = el('div', 'ip-row' + side);
            line.style.setProperty('--d', (0.15 + i * 0.07).toFixed(2) + 's');
            line.appendChild(el('span', 'ip-rank', String(i + 1)));
            const team = el('span', 'ip-team');
            team.appendChild(teamLogo(state, r.team));
            team.appendChild(el('b', '', r.team));
            line.appendChild(team);
            line.appendChild(el('span', '', r.w || '0'));
            line.appendChild(el('span', '', r.l || '0'));
            line.appendChild(el('span', 'ip-pts', r.pts || '–'));
            page.appendChild(line);
        });
        return page;
    }

    // ---- pages: the matchup, then whatever the season can fill ---------------
    const PAGES = ['match', 'schedule', 'standings'];
    const BUILD = { schedule: schedulePage, standings: standingsPage };
    let page = 'match';
    let pageAt = Date.now();

    function pageSeconds(state) { return Math.max(5, Math.min(120, Number(state.idle.pageSeconds) || 12)); }

    function showPage(state, name) {
        const node = name === 'match' ? null : BUILD[name](state);
        if (name !== 'match' && !node) return false;
        page = name;
        pageAt = Date.now();
        const box = $('page');
        box.textContent = '';
        if (node) box.appendChild(node);
        $('idle').classList.toggle('info', !!node);
        return true;
    }

    function nextPage(state) {
        const at = PAGES.indexOf(page);
        for (let i = 1; i <= PAGES.length; i++) {
            const name = PAGES[(at + i) % PAGES.length];
            if (name === page) break;
            if (showPage(state, name)) return;
        }
        pageAt = Date.now();   // nothing else to show: stay on the matchup
        if (page !== 'match') showPage(state, 'match');
    }

    // ---- ticker ------------------------------------------------------------
    function tickerItems(state) {
        const all = matches(state);
        const items = [];
        all.filter(played).slice(-6).reverse().forEach(function (r) { items.push(['Result', r.a + '  ' + r.score + '  ' + r.b]); });
        all.filter(function (r) { return !played(r) && !onNow(state, r); }).slice(0, 3).forEach(function (r) {
            items.push(['Coming up', r.a + ' vs ' + r.b + (r.when ? '  ·  ' + dayOf(r.when) + ', ' + clockOf(r.when) : '')]);
        });
        if (state.idle.message) items.unshift(['', state.idle.message]);
        return items;
    }

    function renderTicker(state) {
        const items = state.idle.ticker ? tickerItems(state) : [];
        // a bottom line with nothing else to run stays a plain, still line
        const run = items.length > 1 || (items.length === 1 && items[0][0]);
        const key = run ? JSON.stringify(items) : '';
        const bar = $('ticker');
        $('idle').classList.toggle('has-ticker', !!run);
        Overlay.setText($('msg'), run ? '' : state.idle.message);
        if (bar.dataset.key === key) return;
        bar.dataset.key = key;
        const track = $('ticker-run');
        track.textContent = '';
        if (!run) return;
        // the list twice over, so the loop has no seam
        for (let copy = 0; copy < 2; copy++) {
            items.forEach(function (item) {
                const cell = el('span', 'tk');
                if (item[0]) cell.appendChild(el('i', '', item[0]));
                cell.appendChild(el('b', '', item[1]));
                track.appendChild(cell);
            });
        }
        // a steady reading speed however long the list is
        track.style.animationDuration = Math.max(20, track.scrollWidth / 2 / 110) + 's';
    }

    let pagesKey = '';
    function render(state) {
        const restyled = Overlay.applyDesign($('idle'), state.design, 'idle');

        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name) || restyled) Overlay.fitText($('name-' + side), 92, 40);
            Overlay.setText($('score-' + side), String(team.score));
            renderRoster($('roster-' + side), team.players, state);
        });

        const t = state.tournament;
        if (Overlay.setText($('tour'), t.name) || restyled) Overlay.fitText($('tour'), 54, 26);
        Overlay.setText($('stage-name'), t.stage);
        const logo = t.logo || Overlay.DEFAULT_TOURNAMENT_LOGO;
        if ($('tlogo').getAttribute('src') !== logo) $('tlogo').src = logo;
        Overlay.setText($('series'), 'Best of ' + t.bestOf + ' · Game ' + t.game);

        if (Overlay.setText($('title'), state.idle.title) || restyled) Overlay.fitText($('title'), 60, 30);
        Overlay.setText($('chip-title'), state.idle.title);
        renderTicker(state);

        // an info page on screen follows the season as it is edited
        const key = JSON.stringify([state.idle.rotate, state.season.schedule, state.season.standings, state.teams.blue.name, state.teams.red.name]);
        if (key !== pagesKey) {
            pagesKey = key;
            if (page !== 'match' && (!state.idle.rotate || !showPage(state, page))) showPage(state, 'match');
        }
        tick();
    }

    function tick() {
        const state = Store.get();
        const clock = $('clock');
        const left = Store.idleLeft(state);
        const total = Math.ceil(left / 1000);
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        const text = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        const low = state.idle.timer.running && left > 0 && left <= 10000;
        [clock, $('chip-clock')].forEach(function (node) {
            node.hidden = !state.idle.showTimer;
            Overlay.setText(node, text);
            node.classList.toggle('low', low);
            node.classList.toggle('done', left <= 0);
        });

        if (!state.idle.rotate) return;
        // the last seconds belong to the matchup and the big clock
        if (low && page !== 'match') { showPage(state, 'match'); return; }
        if (!low && Date.now() - pageAt >= pageSeconds(state) * 1000) nextPage(state);
    }

    Overlay.setupStage($('stage'));
    buildSparks();
    Store.subscribe(render);
    Store.init().then(function () {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                ['name-blue', 'name-red'].forEach(function (id) { Overlay.fitText($(id), 92, 40); });
                Overlay.fitText($('tour'), 54, 26);
                Overlay.fitText($('title'), 60, 30);
            });
        }
    });
    setInterval(tick, 200);
})();
