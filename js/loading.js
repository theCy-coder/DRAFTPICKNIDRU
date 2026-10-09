// Loading screen: the minutes between the end of the draft and the start of
// the game. The ten picked heroes stay on screen the whole time, blue along
// the top and red along the bottom; each card takes turns showing the hero,
// the player and the hero's season record. The space between them rotates
// through slides built from what is already known: how the two drafts
// compare, the bans, both teams' season and the most contested heroes.
// A slide with nothing to show is skipped.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const SIDES = Store.SIDES;
    const FACE_SECONDS = 6;   // how long a card shows the hero, then the player, then the record

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }
    function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
    function pct(part, whole) { return whole ? Math.round(part / whole * 100) : 0; }

    // Each part of a slide comes in a beat after the one before it.
    let order = 0;
    function step(node, extra) {
        node.style.setProperty('--d', (order++ * 0.09 + (extra || 0)).toFixed(2) + 's');
        return node;
    }

    // A number that counts up to its value once the slide is on screen.
    function counter(value, suffix, cls) {
        const node = el('b', 'ld-count' + (cls ? ' ' + cls : ''), '0' + (suffix || ''));
        node.dataset.count = value;
        node.dataset.suffix = suffix || '';
        return node;
    }
    function runCounters(root) {
        root.querySelectorAll('[data-count]').forEach(function (node) {
            const to = Number(node.dataset.count) || 0;
            // start as the part of the slide it sits in arrives
            const host = node.closest('[style*="--d"]');
            const delay = (host ? parseFloat(host.style.getPropertyValue('--d')) || 0 : 0) * 1000 + 250;
            const start = performance.now() + delay;
            (function frame(now) {
                const t = Math.min(1, Math.max(0, (now - start) / 900));
                node.textContent = Math.round(to * (1 - Math.pow(1 - t, 3))) + node.dataset.suffix;
                if (t < 1 && node.isConnected) requestAnimationFrame(frame);
            })(performance.now());
        });
    }

    function logo(team, cls) {
        const box = el('div', 'ld-logo ' + (cls || ''));
        Overlay.renderLogo(box, team);
        return box;
    }
    function heroImg(hero, cls) {
        const img = el('img', cls || '');
        img.alt = '';
        if (hero) img.src = hero.img;
        return img;
    }
    function heading(kicker, title) {
        const head = step(el('div', 'ld-head'));
        head.appendChild(el('i', '', kicker));
        head.appendChild(el('b', '', title));
        return head;
    }
    function teamHead(state, side, note) {
        const team = state.teams[side];
        const head = step(el('div', 'ld-teamhead'));
        head.appendChild(logo(team, 'small'));
        const text = el('div');
        text.appendChild(el('b', '', team.name || side));
        if (note) text.appendChild(el('span', '', note));
        head.appendChild(text);
        return head;
    }
    function halves(build) {
        const wrap = el('div', 'ld-halves');
        SIDES.forEach(function (side) {
            const half = el('div', 'ld-half ' + side);
            build(half, side);
            wrap.appendChild(half);
        });
        return wrap;
    }

    // ---- the season, worked out -------------------------------------------
    function heroRow(state, id) {
        return state.season.heroes.filter(function (r) { return r.id === id; })[0] || null;
    }
    // Every game has ten picks, so the picks give the number of games counted.
    function gamesCounted(state) {
        return Math.round(state.season.heroes.reduce(function (sum, r) { return sum + (r.p || 0); }, 0) / 10);
    }
    function score(text) {
        const m = /(\d+)\D+(\d+)/.exec(text || '');
        return m ? [Number(m[1]), Number(m[2])] : null;
    }
    // A team's finished matches, oldest first: { won, gf, ga, vs, when }.
    function matchesOf(state, name) {
        return state.season.schedule.map(function (r) {
            const s = score(r.score);
            const home = same(r.a, name), away = same(r.b, name);
            if (!s || s[0] === s[1] || (!home && !away) || !name) return null;
            return { won: home ? s[0] > s[1] : s[1] > s[0], gf: home ? s[0] : s[1], ga: home ? s[1] : s[0], vs: home ? r.b : r.a, when: r.when || '' };
        }).filter(Boolean).sort(function (x, y) { return String(x.when).localeCompare(String(y.when)); });
    }
    function rankOf(state, name) {
        const table = state.season.standings.filter(function (r) { return r.team; }).slice().sort(function (x, y) {
            return (Number(y.pts) || 0) - (Number(x.pts) || 0) || (Number(y.w) || 0) - (Number(x.w) || 0);
        });
        for (let i = 0; i < table.length; i++) if (same(table[i].team, name)) return { place: i + 1, of: table.length, row: table[i] };
        return null;
    }
    function ordinal(n) { return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
    function picksOf(state, side) { return state.draft.picks[side].map(function (id) { return Heroes.get(id); }); }
    function bansOf(state, side) { return state.draft.bans[side].slice(0, state.draft.banCount).map(function (id) { return Heroes.get(id); }).filter(Boolean); }

    // ---- lineup ratings ----------------------------------------------------
    // What a draft is built to do, on a 1 to 3 scale. These are estimates from
    // each hero's class (js/hero-ratings.js), not figures from the game.
    const METRICS = HeroRatings.metrics;
    const ROLE_TAG = { Tank: 'TNK', Fighter: 'FTR', Assassin: 'ASN', Mage: 'MAG', Marksman: 'MM', Support: 'SUP' };

    function rateLineup(state, side) {
        const heroes = picksOf(state, side).filter(Boolean);
        const score = METRICS.map(function (m, i) {
            return heroes.length ? heroes.reduce(function (sum, hero) { return sum + HeroRatings.of(hero)[i]; }, 0) / heroes.length : 0;
        });
        let p = 0, w = 0;
        heroes.forEach(function (hero) { const r = heroRow(state, hero.id); if (r) { p += r.p; w += r.w; } });
        const winRate = p ? pct(w, p) : null;
        // out of 10: mostly what the draft can do, partly how its heroes have fared
        const shape = score.reduce(function (sum, v) { return sum + v; }, 0) / score.length / 3;
        const rating = 10 * (winRate == null ? shape : shape * 0.6 + winRate / 100 * 0.4);
        return { score: score, winRate: winRate, rating: rating };
    }

    // ---- the two rows of picks, always on screen ---------------------------
    // Each card has three faces laid over each other: the hero, the player's
    // photo and the hero's season record. `data-face` on the root picks one.
    function buildStrip(state, side) {
        const games = gamesCounted(state);
        const row = $('strip-' + side);
        row.textContent = '';
        picksOf(state, side).forEach(function (hero, i) {
            const nick = state.teams[side].players[i];
            const card = el('div', 'ld-pick' + (hero ? '' : ' empty'));
            card.style.setProperty('--i', i);
            const art = el('div', 'ld-pickart');
            art.appendChild(heroImg(hero, 'ld-hero'));
            // before the draft reaches this slot the card says so, instead of sitting blank
            if (!hero) art.appendChild(el('div', 'ld-wait', 'Pick ' + (i + 1)));

            // the player, when there is a picture to show
            const pic = nick ? Overlay.playerPicture(state, nick) : { src: '' };
            if (pic.src) {
                const face = el('div', 'ld-face player' + (pic.logo ? ' is-logo' : ''));
                // the whole portrait, over a blurred copy that fills the wide card
                ['ld-blur', ''].forEach(function (cls) {
                    const img = el('img', cls);
                    img.alt = '';
                    img.src = pic.src;
                    face.appendChild(img);
                });
                face.appendChild(el('span', '', 'Player'));
                art.appendChild(face);
                card.classList.add('has-player');
            }

            // the hero's season so far, once the season has counted a game
            if (hero && games) {
                const r = heroRow(state, hero.id);
                const face = el('div', 'ld-face rate');
                if (r && r.p) {
                    face.appendChild(el('b', '', pct(r.w, r.p) + '%'));
                    face.appendChild(el('i', '', 'win rate'));
                    face.appendChild(el('span', '', r.w + ' W – ' + (r.p - r.w) + ' L'));
                    face.appendChild(el('em', '', 'Picked ' + pct(r.p, games) + '%  ·  Banned ' + pct(r.b, games) + '%'));
                } else {
                    face.appendChild(el('b', 'new', 'New'));
                    face.appendChild(el('i', '', 'first pick this season'));
                    if (r && r.b) face.appendChild(el('em', '', 'Banned ' + pct(r.b, games) + '%'));
                }
                art.appendChild(face);
                card.classList.add('has-rate');
            }
            card.appendChild(art);

            const bar = el('div', 'ld-pickbar');
            bar.appendChild(el('i', '', hero ? ROLE_TAG[hero.roles[0]] || '' : String(i + 1)));
            bar.appendChild(el('b', '', nick || (hero ? hero.name : 'Pick ' + (i + 1))));
            if (nick) bar.appendChild(el('span', '', hero ? hero.name : 'Not picked yet'));
            card.appendChild(bar);
            row.appendChild(card);
        });
    }

    // ---- centre slides ----------------------------------------------------
    const SLIDES = [
        // The two contenders, face to face.
        { id: 'versus', has: function () { return true; }, build: function (state, box) {
            const t = state.tournament;
            const wrap = el('div', 'ld-versus');
            SIDES.forEach(function (side, n) {
                const team = state.teams[side];
                const block = el('div', 'ld-vteam ' + side);
                block.appendChild(logo(team, 'big'));
                const text = el('div', 'ld-vtext');
                text.appendChild(el('div', 'ld-vname fit', team.name || side));
                const rank = rankOf(state, team.name);
                const played = matchesOf(state, team.name);
                const wins = played.filter(function (m) { return m.won; }).length;
                const line = el('div', 'ld-vline');
                if (played.length) {
                    line.appendChild(el('span', '', wins + ' W  –  ' + (played.length - wins) + ' L'));
                    line.appendChild(el('span', 'gold', pct(wins, played.length) + '% win rate'));
                }
                if (rank) line.appendChild(el('span', '', ordinal(rank.place) + ' in the standings'));
                text.appendChild(line);
                block.appendChild(text);
                if (n === 1) {
                    const mid = el('div', 'ld-vmid');
                    mid.appendChild(el('div', 'ld-vtour', t.name || ''));
                    const sc = el('div', 'ld-vscore');
                    sc.appendChild(el('b', 'blue', String(state.teams.blue.score)));
                    sc.appendChild(el('span', 'ld-vs', 'VS'));
                    sc.appendChild(el('b', 'red', String(state.teams.red.score)));
                    mid.appendChild(sc);
                    mid.appendChild(el('div', 'ld-vcap', [t.stage, 'Game ' + t.game, 'Best of ' + t.bestOf].filter(Boolean).join('  ·  ')));
                    wrap.appendChild(mid);
                }
                wrap.appendChild(block);
            });
            box.appendChild(wrap);
            box.querySelectorAll('.ld-vname').forEach(function (n) { Overlay.fitText(n, 96, 44); });
        } },

        // How the two lineups compare.
        { id: 'analysis', has: function (state) { return SIDES.some(function (s) { return picksOf(state, s).some(Boolean); }); }, build: function (state, box) {
            const lineup = {};
            SIDES.forEach(function (side) { lineup[side] = rateLineup(state, side); });
            const summary = function (side) {
                const team = state.teams[side];
                const block = step(el('div', 'ld-sum ' + side));
                block.appendChild(logo(team, 'mid'));
                const lines = el('div', 'ld-sumlines');
                const other = lineup[side === 'blue' ? 'red' : 'blue'];
                [['Lineup rating', lineup[side].rating.toFixed(1), lineup[side].rating > other.rating],
                    ['Draft win rate', lineup[side].winRate == null ? '–' : lineup[side].winRate + '%', lineup[side].winRate != null && (other.winRate == null || lineup[side].winRate > other.winRate)]
                ].forEach(function (row) {
                    const line = el('div', 'ld-sumline' + (row[2] ? ' up' : ''));
                    line.appendChild(el('span', '', row[0]));
                    line.appendChild(el('b', '', row[1]));
                    lines.appendChild(line);
                });
                block.appendChild(lines);
                return block;
            };
            const mid = el('div', 'ld-compare');
            mid.appendChild(summary('blue'));
            const bars = el('div', 'ld-vsbars');
            METRICS.forEach(function (metric, i) {
                const a = lineup.blue.score[i], b = lineup.red.score[i];
                const line = step(el('div', 'ld-vsbar' + (a > b ? ' blue-up' : b > a ? ' red-up' : '')));
                line.appendChild(el('i', '', metric));
                line.appendChild(el('b', 'blue', a.toFixed(2)));
                const tracks = el('div', 'ld-vstracks');
                [['blue', a], ['red', b]].forEach(function (pair) {
                    const track = el('div', 'ld-vstrack ' + pair[0]);
                    const fill = el('span');
                    fill.style.setProperty('--w', Math.round(pair[1] / 3 * 100) + '%');
                    track.appendChild(fill);
                    tracks.appendChild(track);
                });
                line.appendChild(tracks);
                line.appendChild(el('b', 'red', b.toFixed(2)));
                bars.appendChild(line);
            });
            mid.appendChild(bars);
            mid.appendChild(summary('red'));
            box.appendChild(mid);
        } },

        // What each team took away, and how feared it is.
        { id: 'bans', has: function (state) { return SIDES.some(function (s) { return bansOf(state, s).length; }); }, build: function (state, box) {
            const games = gamesCounted(state);
            box.appendChild(heading('Taken off the table', 'The bans'));
            box.appendChild(halves(function (half, side) {
                const row = el('div', 'ld-bans');
                bansOf(state, side).forEach(function (hero) {
                    const r = heroRow(state, hero.id);
                    const card = step(el('div', 'ld-ban'));
                    const pic = el('div', 'ld-banpic');
                    pic.appendChild(heroImg(hero));
                    card.appendChild(pic);
                    card.appendChild(el('b', '', hero.name));
                    if (games && r && r.b) {
                        card.appendChild(counter(pct(r.b, games), '%'));
                        card.appendChild(el('i', '', 'ban rate'));
                    } else if (games) {
                        card.appendChild(el('b', 'ld-count new', 'New'));
                        card.appendChild(el('i', '', 'first ban'));
                    }
                    row.appendChild(card);
                });
                half.appendChild(row);
            }));
        } },

        // The road here: results, form and the meetings between the two.
        { id: 'season', has: function (state) { return SIDES.some(function (s) { return matchesOf(state, state.teams[s].name).length; }); }, build: function (state, box) {
            const wrap = el('div', 'ld-season');
            const h2h = matchesOf(state, state.teams.blue.name).filter(function (m) { return same(m.vs, state.teams.red.name); });
            SIDES.forEach(function (side, n) {
                const team = state.teams[side];
                const played = matchesOf(state, team.name);
                const wins = played.filter(function (m) { return m.won; }).length;
                const gf = played.reduce(function (s, m) { return s + m.gf; }, 0), ga = played.reduce(function (s, m) { return s + m.ga; }, 0);
                const rank = rankOf(state, team.name);
                const half = el('div', 'ld-half ' + side);
                half.appendChild(teamHead(state, side, rank ? ordinal(rank.place) + ' of ' + rank.of + ' in the standings' : 'Season so far'));
                const tiles = el('div', 'ld-tiles');
                [[counter(pct(wins, played.length), '%'), 'match win rate'],
                    [el('b', 'ld-count', wins + ' – ' + (played.length - wins)), 'matches won – lost'],
                    [el('b', 'ld-count', gf + ' – ' + ga), 'games won – lost']].forEach(function (pair) {
                    const tile = step(el('div', 'ld-tile'));
                    tile.appendChild(pair[0]);
                    tile.appendChild(el('i', '', pair[1]));
                    tiles.appendChild(tile);
                });
                half.appendChild(tiles);
                const last = step(el('div', 'ld-last'));
                last.appendChild(el('span', '', 'Last ' + Math.min(5, played.length)));
                played.slice(-5).forEach(function (m) { last.appendChild(el('b', m.won ? 'w' : 'l', m.won ? 'W' : 'L')); });
                if (played.length) half.appendChild(last);
                if (n === 1) {
                    const mid = step(el('div', 'ld-h2h'));
                    mid.appendChild(el('i', '', 'Earlier meetings'));
                    const bw = h2h.filter(function (m) { return m.won; }).length;
                    const big = el('div', 'ld-h2hscore');
                    // each number sits over its own team's tag, so it cannot be read the wrong way round
                    const tag = function (s) { return String(state.teams[s].tag || state.teams[s].name || s).slice(0, 5).toUpperCase(); };
                    [['blue', bw], ['red', h2h.length - bw]].forEach(function (pair, k) {
                        if (k) big.appendChild(el('span', '', '–'));
                        const cell = el('div', pair[0]);
                        cell.appendChild(el('b', '', String(pair[1])));
                        cell.appendChild(el('u', '', tag(pair[0])));
                        big.appendChild(cell);
                    });
                    mid.appendChild(big);
                    mid.appendChild(el('span', '', h2h.length ? 'matches won this season, before today' : 'First meeting this season'));
                    h2h.slice(-2).forEach(function (m) {
                        mid.appendChild(el('em', m.won ? 'blue' : 'red', tag(m.won ? 'blue' : 'red') + ' won ' + Math.max(m.gf, m.ga) + ' – ' + Math.min(m.gf, m.ga)));
                    });
                    wrap.appendChild(mid);
                }
                wrap.appendChild(half);
            });
            box.appendChild(wrap);
        } },

        // The heroes everybody wants or fears.
        { id: 'meta', has: function (state) { return gamesCounted(state) > 0; }, build: function (state, box) {
            const games = gamesCounted(state);
            const top = state.season.heroes.filter(function (r) { return Heroes.get(r.id) && (r.p || r.b); })
                .sort(function (x, y) { return (y.p + y.b) - (x.p + x.b) || y.p - x.p; }).slice(0, 6);
            const here = {};
            SIDES.forEach(function (side) {
                state.draft.picks[side].forEach(function (id) { if (id) here[id] = side; });
                state.draft.bans[side].forEach(function (id) { if (id && !here[id]) here[id] = 'ban'; });
            });
            box.appendChild(heading(games + ' games played', 'Most contested heroes'));
            const row = el('div', 'ld-meta');
            top.forEach(function (r, i) {
                const hero = Heroes.get(r.id);
                const card = step(el('div', 'ld-metacard' + (here[r.id] ? ' ' + here[r.id] : '')));
                card.appendChild(el('span', 'ld-rank', String(i + 1)));
                card.appendChild(heroImg(hero));
                const text = el('div', 'ld-metatext');
                text.appendChild(el('b', '', hero.name));
                text.appendChild(counter(Math.min(100, pct(r.p + r.b, games)), '%'));
                text.appendChild(el('i', '', 'picked or banned'));
                const split = el('div', 'ld-split');
                [['Pick', pct(r.p, games)], ['Ban', pct(r.b, games)], ['Win', r.p ? pct(r.w, r.p) : null]].forEach(function (pair) {
                    const cell = el('div');
                    cell.appendChild(el('b', '', pair[1] == null ? '–' : pair[1] + '%'));
                    cell.appendChild(el('i', '', pair[0]));
                    split.appendChild(cell);
                });
                text.appendChild(split);
                card.appendChild(text);
                if (here[r.id]) card.appendChild(el('em', '', here[r.id] === 'ban' ? 'Banned this game' : 'In this game'));
                row.appendChild(card);
            });
            box.appendChild(row);
        } }
    ];

    // ---- rotation ---------------------------------------------------------
    let current = -1;      // index into SLIDES
    let shownAt = 0;
    let signature = '';
    let face = 0;
    let faceAt = Date.now();

    function seconds(state) { return Math.max(4, Math.min(60, Number(state.loading && state.loading.seconds) || 9)); }
    function available(state) { return SLIDES.filter(function (s) { return s.has(state); }); }

    // What everything is built from; a change redraws what is on screen.
    function sign(state) {
        return JSON.stringify([state.design, state.draft.picks, state.draft.bans, state.draft.banCount,
            SIDES.map(function (s) { const t = state.teams[s]; return [t.name, t.tag, t.score, t.players, (t.logo || '').length]; }),
            state.season.heroes.length, state.season.schedule.map(function (r) { return r.score; }), state.season.standings.length,
            state.season.players.map(function (p) { return [p.name, p.show, (p.photo || '').length]; }),
            state.tournament.name, state.tournament.stage, state.tournament.game, state.tournament.bestOf]);
    }

    function show(state, slide) {
        const box = $('slides');
        const old = box.lastElementChild;
        if (old) {
            old.classList.add('out');
            setTimeout(function () { old.remove(); }, 520);
        }
        const node = el('div', 'ld-slide ' + slide.id);
        order = 0;
        slide.build(state, node);
        box.appendChild(node);
        runCounters(node);

        const fill = $('bar');
        fill.style.animation = 'none';
        void fill.offsetWidth;   // restart the progress bar
        fill.style.animation = 'ld-progress ' + seconds(state) + 's linear both';
        shownAt = Date.now();
    }

    function next(state) {
        const list = available(state);
        const at = list.indexOf(SLIDES[current]);
        const slide = list[(at + 1) % list.length];
        current = SLIDES.indexOf(slide);
        show(state, slide);
    }

    function render(state) {
        Overlay.applyDesign($('load'), state.design, 'idle');
        const now = sign(state);
        if (now === signature && current >= 0) return;
        signature = now;
        SIDES.forEach(function (side) { buildStrip(state, side); });
        if (current < 0) { next(state); return; }
        const slide = SLIDES[current];
        if (slide.has(state)) show(state, slide); else next(state);
    }

    function tick() {
        const state = Store.get();
        if (current >= 0 && Date.now() - shownAt >= seconds(state) * 1000) next(state);
        if (Date.now() - faceAt >= FACE_SECONDS * 1000) {
            faceAt = Date.now();
            face = (face + 1) % 3;
            $('load').dataset.face = face;
        }
    }

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

    Overlay.setupStage($('stage'));
    buildSparks();
    $('load').dataset.face = 0;
    Store.init().then(function () {
        Store.subscribe(render);
        render(Store.get());
        setInterval(tick, 250);
    });
})();
