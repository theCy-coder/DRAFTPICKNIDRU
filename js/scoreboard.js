// In-game scoreboard overlay: team names, logos and the series score.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };

    // Announcement banner. It plays when a new event arrives and ignores one
    // that is already old, so reloading the page never replays the last one.
    let lastEventAt = null;
    let hideTimer = null;

    function renderEvent(state) {
        const box = $('evt');
        const size = Math.max(40, Math.min(200, Number(state.banner.scale) || 100)) / 100;
        box.querySelector('.evt-box').style.zoom = size;
        // Frame only: the announcement slides out under the corner card, off the action
        const corner = state.scoreboard.layout === 'promo' && state.scoreboard.visible;
        box.classList.toggle('at-corner', corner);
        box.style.setProperty('--side', promoBox(state.scoreboard).side + 'px');
        box.style.top = (corner ? cornerStack(state) : Math.max(Number(state.banner.top) || 0, clearOfBar(state, true))) + 'px';
        const e = state.event;
        if (e.at === lastEventAt) return;
        lastEventAt = e.at;
        clearTimeout(hideTimer);
        const def = GameEvents.get(e.id);
        if (!def || Store.now() - e.at > 3000) { box.classList.remove('show'); return; }

        const team = def.team && state.teams[e.side];
        const icon = $('evt-icon');
        if (def.img) {
            icon.textContent = '';
            const img = document.createElement('img');
            img.src = def.img;
            img.alt = '';
            icon.appendChild(img);
        } else {
            icon.innerHTML = GameEvents.icons[def.icon] || '';
        }
        $('evt-title').textContent = def.title;
        $('evt-sub').textContent = team ? team.name : '';
        box.className = 'evt enter-' + (def.enter || 'rise') + (team ? ' ' + e.side : '');
        if (!team && def.color) box.style.setProperty('--team', def.color);
        else box.style.removeProperty('--team');
        void box.offsetWidth; // restart the animations
        box.classList.add('show');
        hideTimer = setTimeout(function () { box.classList.remove('show'); }, (Number(state.banner.seconds) || 5) * 1000);
    }

    // In the Frame layout, how far down the screen the top bar reaches (with the
    // objective counters that hang under it, when asked), so pop-ups start below it.
    // Under the corner card, and under the effect panel when that hangs there too.
    function cornerStack(state) {
        const scale = $('stage').getBoundingClientRect().width / 1920 || 1;
        let top = clearOfBar(state, 'corner');
        const fxp = $('fxp');
        if (fxp.classList.contains('show') && !fxp.classList.contains('left')) top = Math.max(top, Math.round(fxp.getBoundingClientRect().bottom / scale) + 10);
        return top;
    }
    function clearOfBar(state, withCounters) {
        const sb = state.scoreboard;
        // Frame only: clear of the top border (a pause banner) or of the corner card
        if (sb.layout === 'promo' && sb.visible) { const b = promoBox(sb); return (withCounters === 'corner' ? b.ch : b.top) + 12; }
        if (sb.layout !== 'frame' || !sb.visible) return 0;
        const scale = $('stage').getBoundingClientRect().width / 1920 || 1;
        let bottom = $('band-top').getBoundingClientRect().bottom;
        if (withCounters && sb.showStats) bottom = Math.max(bottom, $('stats-blue').getBoundingClientRect().bottom);
        return Math.round(bottom / scale) + 10;
    }

    // A technical pause or a break: a banner with a running clock.
    const HOLDS = {
        pause: { title: 'Technical pause', sub: 'The game is paused' },
        'break': { title: 'Break', sub: 'Back shortly' }
    };
    function renderHold(state) {
        const box = $('hold');
        const def = HOLDS[state.pause.kind];
        box.classList.toggle('show', !!def && state.scoreboard.visible);
        if (!def) return;
        box.className = 'hold show ' + state.pause.kind + (state.scoreboard.visible ? '' : ' off');
        box.classList.toggle('show', state.scoreboard.visible);
        Overlay.applyDesign(box, state.design, 'scoreboard');
        Overlay.setText($('hold-title'), def.title);
        Overlay.setText($('hold-sub'), def.sub);
        const total = Math.max(0, Math.floor((Store.now() - state.pause.at) / 1000));
        const m = Math.floor(total / 60), sec = total % 60;
        Overlay.setText($('hold-clock'), (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec);
        // under the top bar in the Frame layout, otherwise where the banners go
        box.style.top = Math.max(Number(state.banner.top) || 0, clearOfBar(state, true)) + 'px';
    }

    // Turrets / turtles / lords taken by a team this game.
    function renderStats(box, stats) {
        if (!box.children.length) {
            GameEvents.stats.forEach(function (stat) {
                const item = document.createElement('span');
                item.innerHTML = GameEvents.icons[stat.icon] + '<b></b>';
                box.appendChild(item);
            });
        }
        GameEvents.stats.forEach(function (stat, i) { Overlay.setText(box.children[i].lastChild, String(stats[stat.id])); });
    }

    // One team's players down an edge of the screen: a name strip in the team
    // colour over the hero's portrait and name.
    function renderSide(box, state, side) {
        const sb = state.scoreboard;
        const team = state.teams[side];
        const picks = state.draft.picks[side];
        const any = team.players.some(Boolean) || picks.some(Boolean);
        box.classList.toggle('on', !!sb.sides && sb.visible && any);
        box.style.top = (Number(sb.sidesTop) || 0) + 'px';
        const width = Math.max(140, Math.min(600, Number(sb.sidesWidth) || 180));
        box.style.width = width + 'px';
        box.classList.toggle('wide', width >= 240);   // room for larger names
        // moved in toward the centre when the capture does not reach the screen edge
        box.style[side === 'blue' ? 'left' : 'right'] = Math.max(0, Math.min(800, Number(sb.sidesEdge) || 0)) + 'px';
        box.style.setProperty('--row', Math.max(56, Math.min(200, Number(sb.sidesRow) || 89)) + 'px');
        Overlay.applyDesign(box, state.design, 'scoreboard');
        const key = JSON.stringify([picks, team.players]);
        if (box.dataset.key === key) return;
        box.dataset.key = key;
        box.textContent = '';
        for (let i = 0; i < 5; i++) {
            const hero = Heroes.get(picks[i]);
            const row = document.createElement('div');
            row.className = 'sl-row' + (hero ? '' : ' empty');
            const head = document.createElement('div');
            head.className = 'sl-head';
            const num = document.createElement('i');
            num.textContent = String(i + 1);
            head.appendChild(num);
            const name = document.createElement('b');
            name.textContent = team.players[i] || 'Player ' + (i + 1);
            if (name.textContent.length > 10) name.className = name.textContent.length > 15 ? 'longer' : 'long';
            head.appendChild(name);
            row.appendChild(head);
            const body = document.createElement('div');
            body.className = 'sl-body';
            const art = document.createElement('div');
            art.className = 'sl-art';
            if (hero) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = hero.img;
                art.appendChild(img);
            }
            body.appendChild(art);
            const text = document.createElement('div');
            text.className = 'sl-text';
            const what = document.createElement('b');
            what.textContent = hero ? hero.name : 'No hero yet';
            if (what.textContent.length > 9) what.className = 'long';
            text.appendChild(what);
            if (hero) text.appendChild(Overlay.roleIcons(hero.roles));
            body.appendChild(text);
            row.appendChild(body);
            box.appendChild(row);
        }
    }

    // ---- bottom bar: what the season already knows, a page at a time ---------
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }
    function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
    function scoreOf(text) { return Overlay.matchResult(text); }   // null until somebody has won
    function dayOf(when) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(when || ''); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : ''; }
    function clockOf(when) { const m = /T(\d{2}:\d{2})/.exec(when || ''); return m ? m[1] : ''; }
    // Schedule times are Philippine wall-clock time, so "today" is the PH date.
    function today() { return new Date(Store.now() + 8 * 3600000).toISOString().slice(0, 10); }
    function fixtures(state) {
        return state.season.schedule.filter(function (r) { return r.a && r.b; })
            .slice().sort(function (x, y) { return String(x.when).localeCompare(String(y.when)); });
    }
    function playing(state, row) {
        const blue = state.teams.blue.name, red = state.teams.red.name;
        return (same(row.a, blue) && same(row.b, red)) || (same(row.a, red) && same(row.b, blue));
    }
    function teamMark(state, name) {
        const box = el('span', 'bb-logo');
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
    function sideOf(state, name) {
        return same(name, state.teams.blue.name) ? ' blue' : same(name, state.teams.red.name) ? ' red' : '';
    }
    // One match as a card: when it is (or "Final"), the two teams, the score or VS.
    function matchCard(state, row, label) {
        const s = scoreOf(row.score);
        const card = el('div', 'bb-item match' + (s ? ' done' : ''));
        const when = el('span', 'bb-when');
        when.appendChild(el('b', '', label || dayOf(row.when)));
        when.appendChild(el('i', '', s ? 'Final' : clockOf(row.when)));
        card.appendChild(when);
        [['a', row.a, s ? s[0] > s[1] : false], ['b', row.b, s ? s[1] > s[0] : false]].forEach(function (t, n) {
            if (n) card.appendChild(el('em', '', s ? s[0] + ' – ' + s[1] : 'VS'));
            const side = el('span', 'bb-side ' + t[0] + sideOf(state, t[1]) + (s && !t[2] ? ' lost' : ''));
            side.appendChild(teamMark(state, t[1]));
            side.appendChild(el('b', String(t[1]).length > 10 ? 'long' : '', t[1]));
            card.appendChild(side);
        });
        return card;
    }

    function heroPage(side) {
        return { id: 'heroes-' + side, kicker: '', title: 'Hero win rates', build: function (state) {
            const games = Math.round(state.season.heroes.reduce(function (sum, r) { return sum + (r.p || 0); }, 0) / 10);
            const players = state.teams[side].players;
            const picks = state.draft.picks[side].map(function (id, i) { return { hero: Heroes.get(id), player: players[i] || '' }; })
                .filter(function (p) { return p.hero; });
            if (!picks.length) return [];
            this.kicker = state.teams[side].name || side;
            // Before the season has a counted game there are no records to show,
            // so the page is the lineup itself: who is on which hero.
            this.title = games ? 'Hero win rates' : 'The lineup';
            return picks.map(function (pick) {
                const hero = pick.hero;
                const r = state.season.heroes.filter(function (row) { return row.id === hero.id; })[0];
                const card = el('div', 'bb-item hero ' + side);
                const face = el('span', 'bb-face');
                const img = el('img');
                img.alt = '';
                img.src = hero.img;
                face.appendChild(img);
                card.appendChild(face);
                const text = el('span', 'bb-rtext');
                text.appendChild(el('b', '', hero.name));
                if (!games) {
                    if (pick.player) text.appendChild(el('em', 'who', pick.player));
                    text.appendChild(Overlay.roleIcons(hero.roles));
                    card.appendChild(text);
                    return card;
                }
                // a percentage only from three games on; before that the record itself
                if (r && r.p >= 3) {
                    text.appendChild(el('em', '', Math.round(r.w / r.p * 100) + '%'));
                    text.appendChild(el('span', '', 'win rate  ·  ' + r.w + 'W – ' + (r.p - r.w) + 'L'));
                } else if (r && r.p) {
                    text.appendChild(el('em', '', r.w + ' – ' + (r.p - r.w)));
                    text.appendChild(el('span', '', 'won – lost this season'));
                } else {
                    text.appendChild(el('em', 'new', 'New'));
                    text.appendChild(el('span', '', 'first pick this season'));
                }
                if (r && r.b && games >= 3) text.appendChild(el('span', '', 'banned in ' + Math.round(r.b / games * 100) + '% of games'));   // never banned: say nothing
                card.appendChild(text);
                return card;
            });
        } };
    }

    // Each page gives its cards; a page with none is skipped.
    const INFO = [
        // Always there, so the bar is never empty: the two teams, their players
        // and where the series stands.
        { id: 'series', kicker: 'This match', title: 'The series', build: function (state) {
            const t = state.tournament;
            const need = Store.winsNeeded(state);
            const cards = Store.SIDES.map(function (side) {
                const team = state.teams[side];
                const card = el('div', 'bb-item team ' + side);
                const mark = el('span', 'bb-logo');
                Overlay.renderLogo(mark, team);
                card.appendChild(mark);
                const text = el('span', 'bb-rtext');
                text.appendChild(el('b', String(team.name).length > 14 ? 'long' : '', team.name || side));
                const roster = team.players.filter(Boolean).join('  ·  ');
                if (roster) text.appendChild(el('span', '', roster));
                card.appendChild(text);
                card.appendChild(el('em', '', String(team.score)));
                return card;
            });
            const mid = el('div', 'bb-item stand');
            mid.appendChild(el('b', '', 'Game ' + t.game));
            mid.appendChild(el('span', '', 'Best of ' + t.bestOf + '  ·  first to ' + need));
            if (t.stage) mid.appendChild(el('i', '', t.stage));
            return [cards[0], mid, cards[1]];
        } },
        { id: 'next', kicker: 'Schedule', title: 'Coming up', build: function (state) {
            return fixtures(state).filter(function (r) { return !scoreOf(r.score) && !playing(state, r) && Overlay.stillAhead(r); }).slice(0, 4)
                .map(function (r) { return matchCard(state, r, String(r.when).slice(0, 10) === today() ? 'Today' : ''); });
        } },
        { id: 'results', kicker: 'Season', title: 'Latest results', build: function (state) {
            return fixtures(state).filter(function (r) { return scoreOf(r.score); }).slice(-4).reverse()
                .map(function (r) { return matchCard(state, r); });
        } },
        { id: 'h2h', kicker: 'These two teams', title: 'Earlier meetings', build: function (state) {
            const met = fixtures(state).filter(function (r) { return scoreOf(r.score) && playing(state, r); });
            if (!met.length) return [];
            let blue = 0, red = 0;
            met.forEach(function (r) {
                const s = scoreOf(r.score);
                const aWon = s[0] > s[1];
                if (same(aWon ? r.a : r.b, state.teams.blue.name)) blue++; else red++;
            });
            const tally = el('div', 'bb-item tally');
            const b = el('span', 'bb-tside blue');
            b.appendChild(el('b', '', String(blue)));
            b.appendChild(el('i', '', state.teams.blue.tag || state.teams.blue.name));
            const r = el('span', 'bb-tside red');
            r.appendChild(el('b', '', String(red)));
            r.appendChild(el('i', '', state.teams.red.tag || state.teams.red.name));
            tally.appendChild(b);
            tally.appendChild(el('em', '', 'matches won'));
            tally.appendChild(r);
            return [tally].concat(met.slice(-3).reverse().map(function (row) { return matchCard(state, row); }));
        } },
        { id: 'standings', kicker: 'Season', title: 'Standings', build: function (state) {
            if (!Overlay.hasStandings(state)) return [];
            return state.season.standings.filter(function (r) { return r.team; }).slice().sort(function (x, y) {
                return (Number(y.pts) || 0) - (Number(x.pts) || 0) || (Number(y.w) || 0) - (Number(x.w) || 0);
            }).slice(0, 6).map(function (r, i) {
                const card = el('div', 'bb-item rank' + sideOf(state, r.team));
                card.appendChild(el('i', 'bb-pos', String(i + 1)));
                card.appendChild(teamMark(state, r.team));
                const text = el('span', 'bb-rtext');
                text.appendChild(el('b', '', r.team));
                text.appendChild(el('span', '', (r.w || 0) + ' W – ' + (r.l || 0) + ' L' + (Number(r.pts) > 0 ? '  ·  ' + r.pts + ' pts' : '')));
                card.appendChild(text);
                return card;
            });
        } },
        // The heroes in this game, a team at a time, with their season record.
        // Nothing before the draft has picks, or before the season has counted a game.
        heroPage('blue'),
        heroPage('red')
    ];

    let infoId = '';       // the page on screen
    let infoAt = 0;
    let infoKey = '';

    function showInfo(state, page) {
        const box = $('bb-page');
        box.textContent = '';
        infoId = page ? page.def.id : '';
        infoAt = Date.now();
        $('band-bottom').classList.toggle('has-page', !!page);
        if (!page) return;
        const title = el('div', 'bb-title');
        title.appendChild(el('i', '', page.def.kicker));
        title.appendChild(el('b', '', page.def.title));
        box.appendChild(title);
        const items = el('div', 'bb-items n' + page.items.length + ' ' + page.def.id.split('-')[0]);
        page.items.forEach(function (node, i) {
            node.style.setProperty('--d', (0.12 + i * 0.09).toFixed(2) + 's');
            items.appendChild(node);
        });
        box.appendChild(items);
        fitInfo();
    }

    // Every page sits in the same bar, whatever height it was given: the
    // cards keep their size and edges, and what is inside one is scaled down
    // when it would not fit. So a page with more in it is never cut at the
    // bottom, and the bar looks the same from one page to the next.
    // Boxes are compared as laid out (offset...), which an entrance animation
    // does not move and a tall letter does not stretch.
    function outside(node, box, across) {
        const cs = getComputedStyle(box);
        const top = box.offsetTop + parseFloat(cs.paddingTop), bottom = box.offsetTop + box.offsetHeight - parseFloat(cs.paddingBottom);
        const left = box.offsetLeft + parseFloat(cs.paddingLeft), right = box.offsetLeft + box.offsetWidth - parseFloat(cs.paddingRight);
        return node.offsetTop < top - 1.5 || node.offsetTop + node.offsetHeight > bottom + 1.5
            || (across && (node.offsetLeft < left - 1.5 || node.offsetLeft + node.offsetWidth > right + 1.5));
    }
    function spills(box) { return box.scrollHeight > box.clientHeight + 0.5; }
    function fitInfo() {
        const page = $('bb-page');
        const title = page.querySelector('.bb-title');
        const items = page.querySelector('.bb-items');
        if (!title || !items || !items.clientHeight) return;
        const scale = function (nodes, k) { nodes.forEach(function (n) { n.style.zoom = k < 1 ? k : ''; }); };
        const words = Array.prototype.slice.call(title.children);
        let k = 1;
        scale(words, k);
        // the title moves as one piece, so its words are measured where they are drawn
        const loose = function (word) {
            const a = word.getBoundingClientRect(), b = title.getBoundingClientRect();
            return a.height > 0 && (a.top < b.top - 0.5 || a.bottom > b.bottom + 0.5 || a.left < b.left - 0.5 || a.right > b.right + 0.5);
        };
        while (k > 0.4 && words.some(loose)) { k -= 0.04; scale(words, k); }
        const cards = Array.prototype.slice.call(items.children);
        const inside = [];
        cards.forEach(function (card) { Array.prototype.push.apply(inside, card.children); });
        k = 1;
        scale(inside, k);
        while (k > 0.4 && cards.some(function (card) { return outside(card, items, false) || spills(card); })) { k -= 0.04; scale(inside, k); }
    }

    // Called on every change and twice a second: keeps the page current, and
    // moves on when its time is up.
    function renderInfo(state, turn) {
        const sb = state.scoreboard;
        const on = sb.layout === 'frame' && sb.visible && sb.frameInfo;
        if (!on) { if (infoId) showInfo(state, null); infoKey = ''; return; }
        const pages = INFO.map(function (def) { return { def: def, items: def.build(state) }; })
            .filter(function (p) { return p.items.length; });
        const key = JSON.stringify([state.season.schedule, state.season.standings, state.season.heroes.length, state.draft.picks,
            state.tournament.game, state.tournament.bestOf, state.tournament.stage, state.teams.blue.score, state.teams.red.score,
            (state.teams.blue.logo || '').length, (state.teams.red.logo || '').length,
            state.teams.blue.players, state.teams.red.players,
            state.teams.blue.name, state.teams.red.name, state.teams.blue.tag, state.teams.red.tag]);
        const at = pages.map(function (p) { return p.def.id; }).indexOf(infoId);
        const seconds = Math.max(4, Math.min(120, Number(sb.frameSeconds) || 10));
        if (!pages.length) { if (infoId) showInfo(state, null); infoKey = key; return; }
        if (at < 0) { showInfo(state, pages[0]); infoKey = key; return; }
        if (turn && pages.length > 1 && Date.now() - infoAt >= seconds * 1000) { showInfo(state, pages[(at + 1) % pages.length]); infoKey = key; return; }
        if (key !== infoKey) { infoKey = key; showInfo(state, pages[at]); }
    }

    // The frame: bar heights, the scoreboard scaled to fill the top one.
    // A team name: one line if it can be, otherwise two lines as large as the
    // plate has room for (its height is capped in the stylesheet).
    function fitName(box) {
        Overlay.fitText(box, 38, 18);
        if (!box.classList.contains('fit-wrap')) return;
        const fits = function () { return box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1; };
        let size = parseFloat(box.style.fontSize) || 13;
        box.style.overflowWrap = 'normal';       // while growing, a word is never split
        while (size < 28) {
            box.style.fontSize = (size + 1) + 'px';
            if (!fits()) { box.style.fontSize = size + 'px'; break; }
            size += 1;
        }
        box.style.overflowWrap = '';
    }

    let frameSized = '';
    function renderFrame(state, board, frame) {
        const sb = state.scoreboard;
        const top = Math.max(40, Math.min(400, Number(sb.frameTop) || 108));
        const bottom = Math.max(0, Math.min(600, Number(sb.frameBottom) || top * 2));
        const bandTop = $('band-top'), bandBottom = $('band-bottom');
        bandTop.classList.toggle('on', frame && sb.visible);
        bandBottom.classList.toggle('on', frame && sb.visible && bottom > 0);
        if (!frame) { board.style.zoom = ''; board.style.width = ''; return 0; }
        bandTop.style.height = top + 'px';
        bandBottom.style.height = bottom + 'px';
        bandBottom.classList.toggle('low', bottom < 150);
        Overlay.applyDesign(bandTop, state.design, 'scoreboard');
        Overlay.applyDesign(bandBottom, state.design, 'scoreboard');
        // Scale the plates up to the bar, within reason. Their own height
        // differs by design (64 px in most, less in Studio).
        const base = parseFloat(getComputedStyle(board.querySelector('.team')).height) || 64;
        let k = Math.min(top / base, 1.9);
        board.style.zoom = k;
        board.style.width = (1920 / k) + 'px';
        // ... and back down if a design's plates would no longer fit across the screen
        while (k > 1 && board.scrollWidth > board.clientWidth + 1) {
            k -= 0.05;
            board.style.zoom = k;
            board.style.width = (1920 / k) + 'px';
        }
        const logo = state.tournament.logo || Overlay.DEFAULT_TOURNAMENT_LOGO;
        if ($('bb-logo').getAttribute('src') !== logo) $('bb-logo').src = logo;
        Overlay.setText($('bb-series'), (state.tournament.stage ? state.tournament.stage + '  ·  ' : '') + Overlay.seriesText(state));
        renderInfo(state, false);
        const sized = top + '|' + bottom + '|' + bandBottom.dataset.design + '|' + sb.visible;
        if (sized !== frameSized) { frameSized = sized; fitInfo(); }
        frameFit = { k: k, base: base, top: top };
        return (top - base * k) / 2 / k;      // centres the plates in a bar taller than they can grow
    }

    // Plates scaled right up leave little room for a long team name. Before a
    // name goes onto two lines the plates give some of that size back.
    let frameFit = null, settledKey = '', settledK = 1;
    function settleFrame(state, board, frame) {
        if (!frame || !frameFit) { settledKey = ''; return; }
        const names = ['name-blue', 'name-red'].map($);
        const size = function (k) {
            board.style.zoom = k;
            board.style.width = (1920 / k) + 'px';
            board.style.top = ((frameFit.top - frameFit.base * k) / 2 / k) + 'px';
        };
        const t = state.tournament, sb = state.scoreboard;
        const key = [board.dataset.design, frameFit.top, frameFit.k, state.teams.blue.name, state.teams.red.name, t.name, t.stage, t.game, t.bestOf,
            sb.showInfo, sb.showStats, sb.middle].join('|');
        if (key === settledKey) { size(settledK); return; }
        let k = frameFit.k;
        names.forEach(fitName);
        const least = Math.max(1, frameFit.k * 0.7);
        while (k - 0.1 >= least && names.some(function (n) { return n.classList.contains('fit-wrap'); })) {
            k -= 0.1;
            size(k);
            names.forEach(fitName);
        }
        settledKey = key;
        settledK = k;
    }

    // ---- Frame only (layout 'promo') ------------------------------------------
    // No scoreboard: the borders a phone capture leaves are covered in artwork,
    // the game itself (minimap, its own score, hero lists) is left alone, and a
    // corner card hides the game's settings buttons. Everything in it moves.
    const PROMO_BG = 'Assets/Other/1630-pattern.jpg';
    const PROMO_LOGO = 'Assets/Other/1630-logo.png';
    let promoKey = '', tickerKey = '', cornerKey = '', cornerAt = 0, cornerIndex = 0;
    function promoBox(sb) {
        const n = function (v, d, lo, hi) { v = v === '' || v == null ? NaN : Number(v); return Math.max(lo, Math.min(hi, isNaN(v) ? d : v)); };
        return {
            top: n(sb.promoTop, 108, 0, 400), bottom: n(sb.promoBottom, 108, 0, 400), side: n(sb.promoSide, 25, 0, 400),
            cw: n(sb.promoCorner, 420, 0, 960), ch: n(sb.promoCornerH, 190, 0, 600)
        };
    }
    // What the marquee says: a message of your own, the next matches, the
    // latest results, the top of the standings and the socials.
    function tickerItems(state) {
        const sb = state.scoreboard;
        const items = [];
        if (sb.promoMessage) items.push(['', sb.promoMessage]);
        fixtures(state).filter(function (r) { return !scoreOf(r.score) && !playing(state, r) && Overlay.stillAhead(r); }).slice(0, 3)
            .forEach(function (r) { items.push(['Next', r.a + ' vs ' + r.b + (r.when ? '  ·  ' + dayOf(r.when) + (clockOf(r.when) ? ', ' + clockOf(r.when) : '') : '')]); });
        fixtures(state).filter(function (r) { return scoreOf(r.score); }).slice(-3).reverse()
            .forEach(function (r) { const sc = scoreOf(r.score); items.push(['Result', r.a + '  ' + sc[0] + ' – ' + sc[1] + '  ' + r.b]); });
        if (Overlay.hasStandings(state)) {
            const table = state.season.standings.filter(function (r) { return r.team; }).slice().sort(function (x, y) {
                return (Number(y.pts) || 0) - (Number(x.pts) || 0) || (Number(y.w) || 0) - (Number(x.w) || 0);
            }).slice(0, 4);
            items.push(['Standings', table.map(function (r, i) { return (i + 1) + '. ' + r.team; }).join('  ·  ')]);
        }
        if (sb.promoSocials) items.push(['Follow', sb.promoSocials]);
        if (!items.length) items.push(['', [sb.promoName, state.tournament.name].filter(Boolean).join('  ·  ')]);
        return items;
    }
    // The marquee runs at the same speed whatever its length (px a second).
    // It is started only once it is on screen and its length can be measured:
    // the text comes in from the right-hand edge, then loops without a seam.
    const TICKER_SPEED = 110;
    let tickerRunning = false;
    function startTicker() {
        const run = $('pf-run'), track = run.parentNode;
        const length = run.scrollWidth / 2, room = track.clientWidth;
        if (!length || !room) return;              // not on screen yet: tried again on the next render
        run.getAnimations().forEach(function (a) { a.cancel(); });
        tickerRunning = true;
        const enter = run.animate([{ transform: 'translateX(' + room + 'px)' }, { transform: 'translateX(0)' }],
            { duration: room / TICKER_SPEED * 1000, easing: 'linear' });
        enter.onfinish = function () {
            run.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + -length + 'px)' }],
                { duration: length / TICKER_SPEED * 1000, iterations: Infinity, easing: 'linear' });
        };
    }
    function renderTicker(state) {
        const items = tickerItems(state);
        const key = JSON.stringify(items);
        if (key === tickerKey) { if (!tickerRunning) startTicker(); return; }
        tickerKey = key;
        const run = $('pf-run');
        run.textContent = '';
        // the list twice over, so the loop has no seam
        for (let k = 0; k < 2; k++) {
            items.forEach(function (it) {
                const item = el('span', 'pf-item');
                if (it[0]) item.appendChild(el('u', '', it[0]));
                item.appendChild(document.createTextNode(it[1]));
                run.appendChild(item);
            });
        }
        tickerRunning = false;
        startTicker();
    }
    // The corner card takes turns: the production, the tournament, the socials.
    function renderCorner(state) {
        const sb = state.scoreboard, t = state.tournament;
        const faces = [
            { logo: sb.promoLogo || PROMO_LOGO, title: sb.promoName || '', sub: sb.promoName ? 'presents' : '', mark: true },
            { logo: t.logo || Overlay.DEFAULT_TOURNAMENT_LOGO, title: t.name || '', sub: t.stage || state.season.title || '' }
        ];
        if (sb.promoSocials) faces.push({ title: 'Follow us', sub: sb.promoSocials });
        const key = JSON.stringify(faces.map(function (f) { return [String(f.logo || '').length, String(f.logo || '').slice(-30), f.title, f.sub]; }));
        const box = $('pf-corner');
        if (key !== cornerKey) {
            cornerKey = key;
            box.textContent = '';
            faces.forEach(function (f) {
                const face = el('div', 'pf-face' + (f.mark ? ' mark' : ''));
                if (f.logo) { const img = el('img'); img.alt = ''; img.src = f.logo; face.appendChild(img); }
                const text = el('span', 'pf-ftext');
                if (f.title) text.appendChild(el('b', '', f.title));
                if (f.sub) text.appendChild(el('i', '', f.sub));
                face.appendChild(text);
                box.appendChild(face);
            });
            cornerIndex = 0;
            cornerAt = Date.now();
        }
        const seconds = Math.max(3, Math.min(60, Number(sb.promoSeconds) || 6));
        if (Date.now() - cornerAt >= seconds * 1000) { cornerIndex = (cornerIndex + 1) % box.children.length; cornerAt = Date.now(); }
        Array.prototype.forEach.call(box.children, function (face, i) {
            face.classList.toggle('on', i === cornerIndex);
        });
    }
    function renderPromo(state, on) {
        const promo = $('promo');
        promo.classList.toggle('on', on);
        if (!on) { tickerRunning = false; return; }     // shown again later: the marquee starts afresh
        const sb = state.scoreboard, t = state.tournament;
        Overlay.applyDesign(promo, state.design, 'scoreboard');
        const b = promoBox(sb);
        promo.style.setProperty('--top', b.top + 'px');
        promo.style.setProperty('--bottom', b.bottom + 'px');
        promo.style.setProperty('--side', b.side + 'px');
        promo.style.setProperty('--cw', b.cw + 'px');
        promo.style.setProperty('--ch', b.ch + 'px');
        const bg = sb.promoBg || PROMO_BG;
        const key = bg.length + bg.slice(-40);
        if (key !== promoKey) { promoKey = key; $('pf-bg').style.backgroundImage = 'url("' + bg + '")'; }

        Overlay.renderLogo($('pf-tlogo'), { logo: t.logo || Overlay.DEFAULT_TOURNAMENT_LOGO, tag: '' });
        if (Overlay.setText($('pf-tname'), t.name || '')) Overlay.fitText($('pf-tname'), 30, 16);
        Overlay.setText($('pf-tsub'), [state.season.title && !same(state.season.title, t.name) ? state.season.title : '', t.stage].filter(Boolean).join('  ·  '));

        // the match: tags, the series score and the game, once both teams are set
        const blue = state.teams.blue, red = state.teams.red;
        const named = !!(blue.name && red.name);
        $('pf-match').hidden = !named;
        if (named) {
            Overlay.setText($('pf-blue'), blue.tag || blue.name);
            Overlay.setText($('pf-red'), red.tag || red.name);
            Overlay.setText($('pf-score'), blue.score + ' – ' + red.score);
            Overlay.setText($('pf-game'), 'Game ' + t.game + '  ·  Best of ' + t.bestOf);
        }
        const mark = sb.promoLogo || PROMO_LOGO;
        if ($('pf-tagimg').getAttribute('src') !== mark) $('pf-tagimg').src = mark;
        Overlay.setText($('pf-tagname'), String(sb.promoName || '').split(' ')[0]);
        renderTicker(state);
        renderCorner(state);
    }

    // ?layout=frame (or split, bar) on the address previews a layout in this
    // window only, the way ?design= does for the look.
    const layoutOverride = new URLSearchParams(location.search).get('layout');
    function withOverride(state) {
        if (['split', 'bar', 'frame', 'promo'].indexOf(layoutOverride) < 0 || state.scoreboard.layout === layoutOverride) return state;
        const copy = Object.assign({}, state);
        copy.scoreboard = Object.assign({}, state.scoreboard, { layout: layoutOverride });
        return copy;
    }

    function render(state) {
        state = withOverride(state);
        const sb = state.scoreboard;
        const board = $('sb');
        const frame = sb.layout === 'frame';
        const promo = sb.layout === 'promo';
        const split = sb.layout !== 'bar' && !frame && !promo;
        board.classList.toggle('split', split);
        board.classList.toggle('bar', !split);
        board.classList.toggle('frame', frame);
        board.classList.toggle('hidden', !sb.visible || promo);
        renderPromo(state, promo && sb.visible);
        board.classList.toggle('no-info', !sb.showInfo);
        board.classList.toggle('no-stats', !sb.showStats);
        const restyled = Overlay.applyDesign(board, state.design, 'scoreboard');
        const lift = renderFrame(state, board, frame);
        Store.SIDES.forEach(function (side) { renderSide($('side-' + side), state, side); });
        board.style.top = frame ? lift + 'px' : (Number(sb.top) || 0) + 'px';
        // In split mode the middle is an empty gap that the game's own
        // kill/gold HUD shows through.
        $('middle').style.width = split ? (Number(sb.gap) || 0) + 'px' : '';
        // The Bar layout can show the tournament logo or a custom image in
        // its centre instead of the text.
        const src = split ? '' : sb.middle === 'logo' ? (state.tournament.logo || Overlay.DEFAULT_TOURNAMENT_LOGO)
            : sb.middle === 'image' ? sb.image : '';
        const img = $('mid-img');
        img.hidden = !src;
        if (src && img.getAttribute('src') !== src) img.src = src;
        board.classList.toggle('mid-image', !!src);

        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name) || restyled) fitName($('name-' + side));
            Overlay.renderPips($('pips-' + side), team.score, Store.winsNeeded(state));
            renderStats($('stats-' + side), team.stats);
            const score = $('score-' + side);
            if (Overlay.setText(score, String(team.score)) && score.dataset.ready) {
                score.classList.remove('bump');
                void score.offsetWidth;
                score.classList.add('bump');
            }
            score.dataset.ready = '1';
        });

        const t = state.tournament;
        const title = t.stage ? t.name + ' · ' + t.stage : t.name;
        Overlay.setText($('tab-blue'), title);
        Overlay.setText($('tab-red'), Overlay.seriesText(state));
        if (Overlay.setText($('tour'), t.name) || restyled) Overlay.fitText($('tour'), 26, 14);
        Overlay.setText($('series'), (t.stage ? t.stage + ' · ' : '') + Overlay.seriesText(state));
        // Its box changes with the layout and the design, so measure it every time.
        Overlay.fitText($('series'), 18, 11);
        settleFrame(state, board, frame);
        const fxp = $('fxp');
        // Size, and how far in from the edge. The Frame layout's bar runs edge to
        // edge, so there the panel hangs flush under its end.
        const fxSize = Math.max(40, Math.min(200, Number(sb.effectScale) || 100)) / 100;
        const edge = (frame ? 0 : Math.max(0, Number(sb.effectEdge) || 0)) / fxSize + 'px';
        const onLeft = sb.effectSide === 'left';
        fxp.classList.toggle('left', onLeft);
        fxp.style.zoom = fxSize;
        fxp.style.left = onLeft ? edge : 'auto';
        fxp.style.right = onLeft ? 'auto' : edge;
        fxp.style.top = Math.max(Number(sb.effectTop) || 0, clearOfBar(state, sb.layout === 'promo' ? 'corner' : false)) / fxSize + 'px';
        if (sb.layout === 'promo') {
            // Frame only: the panel keeps to the border, clear of the game
            const side = promoBox(sb).side / fxSize + 'px';
            fxp.style.left = onLeft ? side : 'auto';
            fxp.style.right = onLeft ? 'auto' : side;
        }
        Overlay.renderEffect(fxp, t.effect, sb.visible && sb.showEffect);
        renderEvent(state);
        renderHold(state);
    }

    Overlay.setupStage($('stage'));
    Store.subscribe(render);
    setInterval(function () {
        const state = withOverride(Store.get());
        renderInfo(state, true);
        renderHold(state);
        if (state.scoreboard.layout === 'promo' && state.scoreboard.visible) { renderCorner(state); if (!tickerRunning) startTicker(); }
    }, 500);
    Store.init().then(function () {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                ['name-blue', 'name-red'].forEach(function (id) { fitName($(id)); });
            });
        }
    });
})();
