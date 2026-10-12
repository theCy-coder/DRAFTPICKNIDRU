// Result screen: what just happened, for the scene after a game.
//
//   game      the game that has just finished: who won, both drafts, the
//             objectives and the series score
//   mvp       that game's MVP: the MVP overlay itself, as a slide
//   champion  once a team has won the series: the winner, the final score and
//             how each game went
//   finals    the MVP of the whole series, when one has been named
//
// It takes turns through whichever of these exist. Add ?view=game, mvp,
// champion or finals to the address to hold one. Every game is recorded by the
// control panel when "who won" is pressed (state.series.games).
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const SIDES = Store.SIDES;
    const pinned = new URLSearchParams(location.search).get('view');

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }
    function same(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
    let order = 0;
    function step(node) { node.style.setProperty('--d', (order++ * 0.08).toFixed(2) + 's'); return node; }

    // A team's logo by name: the two sides now, then the season's teams, then its tag.
    function logoFor(state, name, tag) {
        const box = el('div', 'rs-logo');
        const live = SIDES.map(function (s) { return state.teams[s]; }).filter(function (t) { return same(t.name, name); })[0];
        const season = state.season.teams.filter(function (t) { return same(t.name, name); })[0];
        Overlay.renderLogo(box, { logo: (live && live.logo) || (season && season.logo) || '', tag: tag || (live && live.tag) || (season && season.tag) || '', name: name });
        return box;
    }

    function seriesWinner(state) {
        const need = Store.winsNeeded(state);
        return SIDES.filter(function (s) { return state.teams[s].score >= need; })[0] || null;
    }

    // ---- the game that just finished ---------------------------------------
    function gameView(state, game) {
        order = 0;
        const view = el('div', 'rs-game');
        const head = step(el('div', 'rs-head'));
        head.appendChild(el('i', '', [state.tournament.name, state.tournament.stage].filter(Boolean).join('  ·  ')));
        head.appendChild(el('b', '', 'Game ' + game.game + ' result'));
        view.appendChild(head);

        const row = el('div', 'rs-row');
        SIDES.forEach(function (side, n) {
            const team = game[side];
            const panel = el('div', 'rs-team ' + side + (team.won ? ' won' : ' lost'));
            const top = step(el('div', 'rs-teamtop'));
            top.appendChild(logoFor(state, team.name, team.tag));
            const text = el('div', 'rs-teamtext');
            text.appendChild(el('b', String(team.name).length > 14 ? 'long' : '', team.name));
            text.appendChild(el('span', team.won ? 'badge' : '', team.won ? 'Winner' : 'Defeated'));
            top.appendChild(text);
            panel.appendChild(top);

            const picks = el('div', 'rs-picks');
            for (let i = 0; i < 5; i++) {
                const hero = Heroes.get(team.picks[i]);
                const card = step(el('div', 'rs-pick' + (hero ? '' : ' empty')));
                if (hero) {
                    const img = el('img');
                    img.alt = '';
                    img.src = hero.img;
                    card.appendChild(img);
                }
                const label = el('div', 'rs-picklabel');
                label.appendChild(el('b', '', hero ? hero.name : '–'));
                if (team.players[i]) label.appendChild(el('span', '', team.players[i]));
                card.appendChild(label);
                picks.appendChild(card);
            }
            panel.appendChild(picks);

            const foot = step(el('div', 'rs-foot'));
            const bans = el('div', 'rs-bans');
            bans.appendChild(el('i', '', 'Bans'));
            team.bans.map(function (id) { return Heroes.get(id); }).filter(Boolean).forEach(function (hero) {
                const b = el('span', 'rs-ban');
                const img = el('img');
                img.alt = hero.name;
                img.src = hero.img;
                b.appendChild(img);
                bans.appendChild(b);
            });
            foot.appendChild(bans);
            const stats = el('div', 'rs-stats');
            GameEvents.stats.forEach(function (stat) {
                const item = el('span');
                item.innerHTML = GameEvents.icons[stat.icon];
                item.appendChild(el('b', '', String(team.stats[stat.id] || 0)));
                item.appendChild(el('i', '', stat.label));
                stats.appendChild(item);
            });
            foot.appendChild(stats);
            panel.appendChild(foot);

            if (n === 1) row.appendChild(middle(state, game));
            row.appendChild(panel);
        });
        view.appendChild(row);
        return view;
    }

    // Between the two teams: the series score after this game.
    function middle(state, game) {
        const mid = step(el('div', 'rs-mid'));
        mid.appendChild(el('i', '', 'Series'));
        const score = el('div', 'rs-score');
        score.appendChild(el('b', 'blue', String(game.blue.score)));
        score.appendChild(el('span', '', '–'));
        score.appendChild(el('b', 'red', String(game.red.score)));
        mid.appendChild(score);
        mid.appendChild(el('span', 'rs-bo', 'Best of ' + state.tournament.bestOf));
        return mid;
    }

    // ---- the series winner ---------------------------------------------------
    function championView(state, side) {
        order = 0;
        const team = state.teams[side];
        const loser = state.teams[side === 'blue' ? 'red' : 'blue'];
        const view = el('div', 'rs-champ ' + side);
        const final = /final/i.test(state.tournament.stage || '') && !/semi|quarter/i.test(state.tournament.stage || '');
        view.appendChild(step(el('i', 'rs-kicker', [state.tournament.name, state.tournament.stage].filter(Boolean).join('  ·  '))));
        view.appendChild(step(el('div', 'rs-crown', final ? 'Champions' : 'Series winner')));
        const logo = step(logoFor(state, team.name, team.tag));
        logo.classList.add('big');
        view.appendChild(logo);
        view.appendChild(step(el('div', 'rs-champname fit', team.name)));
        const line = step(el('div', 'rs-final'));
        line.appendChild(el('b', '', team.score + ' – ' + loser.score));
        line.appendChild(el('span', '', 'over ' + loser.name));
        view.appendChild(line);

        const roster = team.players.filter(Boolean);
        if (roster.length) view.appendChild(step(el('div', 'rs-roster', roster.join('   ·   '))));

        // how each game went, when the games were recorded
        const games = state.series.games.filter(function (g) { return same(g.blue.name, team.name) || same(g.red.name, team.name); });
        if (games.length) {
            const strip = step(el('div', 'rs-games'));
            games.forEach(function (g) {
                const won = same(g.winner, team.name);
                const chip = el('span', 'rs-chip' + (won ? ' won' : ''));
                chip.appendChild(el('i', '', 'G' + g.game));
                chip.appendChild(el('b', '', won ? (team.tag || team.name) : (loser.tag || loser.name)));
                strip.appendChild(chip);
            });
            view.appendChild(strip);
        }
        return view;
    }

    // ---- the MVP of the series ---------------------------------------------
    // What a player did across the recorded games: the hero each game, whether
    // it was won, and how often they were that game's MVP.
    function seriesOf(state, name) {
        const out = { games: [], mvps: 0, team: '', tag: '', side: '' };
        state.series.games.forEach(function (g) {
            if (g.mvp && same(g.mvp.player, name)) out.mvps++;
            SIDES.forEach(function (side) {
                const at = g[side].players.map(function (p) { return String(p || '').trim().toLowerCase(); }).indexOf(String(name).trim().toLowerCase());
                if (at < 0) return;
                out.team = g[side].name;
                out.tag = g[side].tag;
                out.games.push({ game: g.game, hero: Heroes.get(g[side].picks[at]), won: g[side].won, mvp: !!g.mvp && same(g.mvp.player, name) });
            });
        });
        // a player typed in after the games still gets their team from the sides now
        SIDES.forEach(function (side) {
            if (state.teams[side].players.some(function (p) { return same(p, name); })) { out.side = side; if (!out.team) { out.team = state.teams[side].name; out.tag = state.teams[side].tag; } }
        });
        if (!out.side) out.side = same(out.team, state.teams.red.name) ? 'red' : 'blue';
        return out;
    }

    function finalsView(state) {
        order = 0;
        const name = state.series.mvp;
        const info = seriesOf(state, name);
        const final = /final/i.test(state.tournament.stage || '') && !/semi|quarter/i.test(state.tournament.stage || '');
        const view = el('div', 'rs-fmvp ' + info.side);

        // the player's own picture; without one, the hero they played most recently
        const pic = Overlay.playerPicture(state, name);
        const real = pic.src && !pic.logo && pic.src !== Overlay.PLAYER_TEMPLATE;
        const lastHero = info.games.map(function (g) { return g.hero; }).filter(Boolean).pop();
        const photo = step(el('div', 'rs-fphoto' + (real ? '' : ' hero')));
        const img = el('img');
        img.alt = '';
        img.src = real ? pic.src : lastHero ? lastHero.img : (pic.src || Overlay.PLAYER_TEMPLATE);
        photo.appendChild(img);
        view.appendChild(photo);

        const text = el('div', 'rs-ftext');
        text.appendChild(step(el('i', 'rs-kicker', [state.tournament.name, state.tournament.stage].filter(Boolean).join('  ·  '))));
        text.appendChild(step(el('div', 'rs-crown', final ? 'Finals MVP' : 'Series MVP')));
        text.appendChild(step(el('div', 'rs-fname fit', name)));
        const team = step(el('div', 'rs-fteam'));
        team.appendChild(logoFor(state, info.team, info.tag));
        team.appendChild(el('b', '', info.team));
        text.appendChild(team);

        const won = info.games.filter(function (g) { return g.won; }).length;
        const tiles = step(el('div', 'rs-ftiles'));
        [[String(info.mvps), info.mvps === 1 ? 'game MVP' : 'game MVPs', info.mvps > 0],
            [won + ' – ' + (info.games.length - won), 'games won – lost', info.games.length > 0],
            [String(new Set(info.games.map(function (g) { return g.hero && g.hero.id; }).filter(Boolean)).size), 'different heroes', info.games.length > 0]
        ].forEach(function (t) {
            if (!t[2]) return;      // nothing recorded for it: leave the tile out
            const tile = el('div', 'rs-ftile');
            tile.appendChild(el('b', '', t[0]));
            tile.appendChild(el('span', '', t[1]));
            tiles.appendChild(tile);
        });
        if (tiles.children.length) text.appendChild(tiles);

        if (info.games.some(function (g) { return g.hero; })) {
            const row = step(el('div', 'rs-fheroes'));
            info.games.forEach(function (g) {
                if (!g.hero) return;
                const cell = el('div', 'rs-fhero' + (g.won ? ' won' : '') + (g.mvp ? ' mvp' : ''));
                const face = el('span', 'rs-face');
                const pic2 = el('img');
                pic2.alt = '';
                pic2.src = g.hero.img;
                face.appendChild(pic2);
                cell.appendChild(face);
                cell.appendChild(el('b', '', g.hero.name));
                cell.appendChild(el('span', '', 'G' + g.game + '  ·  ' + (g.won ? 'Won' : 'Lost') + (g.mvp ? '  ·  MVP' : '')));
                row.appendChild(cell);
            });
            text.appendChild(row);
        }
        view.appendChild(text);
        return view;
    }

    // The game's MVP is the MVP overlay itself, loaded fresh so its entrance plays.
    function mvpView() {
        const frame = el('iframe', 'rs-frame');
        const design = new URLSearchParams(location.search).get('design');
        frame.src = 'mvp.html?embed=1' + (design ? '&design=' + encodeURIComponent(design) : '');
        frame.setAttribute('scrolling', 'no');
        return frame;
    }

    // Nothing to report yet: the matchup, so the scene is never blank.
    function waitingView(state) {
        order = 0;
        const view = el('div', 'rs-wait');
        view.appendChild(step(el('i', 'rs-kicker', [state.tournament.name, state.tournament.stage].filter(Boolean).join('  ·  '))));
        const row = step(el('div', 'rs-waitrow'));
        SIDES.forEach(function (side, n) {
            if (n) row.appendChild(el('span', 'rs-vs', 'VS'));
            const t = el('div', 'rs-waitteam ' + side);
            t.appendChild(logoFor(state, state.teams[side].name, state.teams[side].tag));
            t.appendChild(el('b', '', state.teams[side].name));
            row.appendChild(t);
        });
        view.appendChild(row);
        view.appendChild(step(el('div', 'rs-waitnote', 'Game ' + state.tournament.game + '  ·  the result appears here when it ends')));
        return view;
    }

    // ---- which view, and when to change -------------------------------------
    let shown = '';        // 'game' | 'champion' | 'wait'
    let shownAt = 0;
    let signature = '';

    const BUILD = {
        game: function (state) { const g = state.series.games; return gameView(state, g[g.length - 1]); },
        mvp: function () { return mvpView(); },
        champion: function (state) { return championView(state, seriesWinner(state)); },
        finals: function (state) { return finalsView(state); },
        wait: function (state) { return waitingView(state); }
    };

    // Which slides there is something for, in the order they are shown: the
    // series first once it is decided, then the game just finished.
    function views(state) {
        const list = [];
        const games = state.series.games;
        const last = games[games.length - 1];
        if (seriesWinner(state)) {
            list.push('champion');
            if (state.series.mvp) list.push('finals');
        }
        if (last) {
            list.push('game');
            if (Heroes.get(state.mvp.hero) && state.mvp.game === last.game) list.push('mvp');
        }
        if (BUILD[pinned] && pinned !== 'wait') return list.indexOf(pinned) >= 0 ? [pinned] : ['wait'];
        return list.length ? list : ['wait'];
    }

    function show(state, name) {
        shown = name;
        shownAt = Date.now();
        const box = $('view');
        box.textContent = '';
        const node = BUILD[name](state);
        box.appendChild(node);
        $('res').classList.toggle('champion', name === 'champion' || name === 'finals');
        $('res').classList.toggle('framed', name === 'mvp');
        node.querySelectorAll('.rs-champname').forEach(function (n) { Overlay.fitText(n, 190, 70); });
        node.querySelectorAll('.rs-fname').forEach(function (n) { Overlay.fitText(n, 170, 60); });
    }

    function render(state) {
        Overlay.applyDesign($('res'), state.design, 'idle');
        const now = JSON.stringify([state.design, state.series.games, state.series.mvp, state.mvp.hero, state.mvp.game, SIDES.map(function (s) {
            const t = state.teams[s];
            return [t.name, t.tag, t.score, t.players, (t.logo || '').length];
        }), state.tournament.name, state.tournament.stage, state.tournament.bestOf, state.tournament.game]);
        const list = views(state);
        if (now === signature && list.indexOf(shown) >= 0) return;
        const first = signature === '';
        signature = now;
        if (!first && shown === 'mvp' && list.indexOf('mvp') >= 0) return;   // that slide keeps itself current
        show(state, list.indexOf(shown) >= 0 ? shown : list[0]);
    }

    function tick() {
        const state = Store.get();
        const list = views(state);
        const seconds = Math.max(5, Math.min(120, Number(state.result && state.result.seconds) || 12));
        if (list.length > 1 && Date.now() - shownAt >= seconds * 1000) show(state, list[(list.indexOf(shown) + 1) % list.length]);
    }

    function decorate() {
        const sparks = $('idle-sparks');
        for (let i = 0; i < 40; i++) {
            const spark = document.createElement('i');
            const size = 3 + Math.random() * 7;
            spark.style.left = (Math.random() * 100) + '%';
            spark.style.width = spark.style.height = size + 'px';
            spark.style.animationDuration = (7 + Math.random() * 9) + 's';
            spark.style.animationDelay = (-Math.random() * 16) + 's';
            sparks.appendChild(spark);
        }
        // confetti for the winner: falls only while the champion view is up
        const confetti = $('confetti');
        const colours = ['#ffd766', '#ffffff', 'var(--blue)', 'var(--red)', '#f0a92b'];
        for (let i = 0; i < 70; i++) {
            const bit = document.createElement('i');
            bit.style.left = (Math.random() * 100) + '%';
            bit.style.background = colours[i % colours.length];
            bit.style.width = (8 + Math.random() * 10) + 'px';
            bit.style.height = (12 + Math.random() * 16) + 'px';
            bit.style.animationDuration = (4 + Math.random() * 5) + 's';
            bit.style.animationDelay = (-Math.random() * 9) + 's';
            confetti.appendChild(bit);
        }
    }

    Overlay.setupStage($('stage'));
    decorate();
    Store.init().then(function () {
        Store.subscribe(render);
        render(Store.get());
        setInterval(tick, 300);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
            document.querySelectorAll('.rs-champname').forEach(function (n) { Overlay.fitText(n, 190, 70); });
        });
    });
})();
