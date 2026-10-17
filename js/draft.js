// Draft overlay: renders picks, bans, phase and timer from the shared state.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const slots = { pick: { blue: [], red: [] }, ban: { blue: [], red: [] } };

    function el(tag, cls) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        return node;
    }

    function build() {
        Store.SIDES.forEach(function (side) {
            for (let i = 0; i < 5; i++) {
                const ban = el('div', 'ban');
                ban.appendChild(el('div', 'fallback'));
                $('bans-' + side).appendChild(ban);
                slots.ban[side].push(ban);

                const pick = el('div', 'pick');
                const order = el('div', 'order');
                order.textContent = i + 1;
                const label = el('div', 'label');
                const nick = el('div', 'nick');
                const face = el('img');   // the player's picture, beside their nickname
                face.alt = '';
                face.hidden = true;
                nick.appendChild(face);
                nick.appendChild(el('span'));
                label.appendChild(el('div', 'hero fit'));
                label.appendChild(nick);
                pick.appendChild(el('div', 'fallback'));
                pick.appendChild(order);
                pick.appendChild(label);
                $('picks-' + side).appendChild(pick);
                slots.pick[side].push(pick);
            }
        });
    }

    // Swap the portrait only when the hero actually changes so the entrance
    // animation plays once per lock-in.
    // The side pick cards show a wide band of each tall portrait. To keep the
    // face in it, every hero has the height of its face here, in % of the
    // portrait from the top (by its id from js/heroes.js), read off the art in
    // Assets/HeroPick. A hero not listed (a new one) is taken as 21.
    const FACE = {
        aamon: 20, akai: 34, aldous: 24, alice: 21, alpha: 28, alucard: 20, angela: 21, argus: 20,
        arlot: 21, atlas: 18, aulus: 30, aurora: 22, badang: 20, balmond: 26, bane: 28, barats: 22,
        baxia: 20, beatrix: 23, beleric: 37, benedetta: 24, brody: 21, bruno: 23, carmila: 21, cecilion: 19,
        chang_e: 27, chip: 22, chou: 17, cici: 24, claude: 19, clint: 21, cyclops: 34, diggie: 27,
        dyroth: 20, edith: 23, esmeralda: 22, estes: 20, eudora: 19, fanny: 23, faramis: 25, floryn: 22,
        franco: 27, fredrin: 23, freya: 21, gatotkaca: 26, gloo: 15, gord: 22, granger: 23, grock: 22,
        guinevere: 22, gusion: 24, hanabi: 25, hanzo: 33, harith: 20, harley: 26, hayabusa: 21, helcurt: 23,
        hilda: 24, hirara: 23, hylos: 18, irithel: 18, ixia: 24, jawhead: 8, johnson: 24, joy: 27,
        julian: 29, kadita: 21, kagura: 22, kaja: 24, kalea: 23, karina: 19, karrie: 30, khaleed: 22,
        khufra: 21, kimmy: 22, lancelot: 19, lapulapu: 24, layla: 24, leomord: 22, lesley: 21, ling: 22,
        lolita: 25, lukas: 21, lunox: 26, luoyi: 21, lylia: 31, marcel: 20, martis: 18, masha: 24,
        mathilda: 15, melissa: 21, minotour: 31, minsitthar: 22, miya: 21, moskov: 24, nana: 37, natalia: 22,
        nathan: 20, nolan: 21, novaria: 21, obsidia: 20, odette: 18, paquito: 22, parsha: 18, phoveus: 22,
        popolandkupa: 27, rafaela: 18, roger: 18, ruby: 24, saber: 28, selena: 18, silvanna: 19, sora: 27,
        sun: 18, suyou: 22, terizla: 20, thamuz: 15, tigreal: 20, uranus: 18, vale: 18, valentina: 18,
        valir: 22, vexana: 17, wanwan: 21, xavier: 16, xborg: 18, yin: 21, yisunshin: 19, yuzhong: 25,
        yve: 30, zetian: 23, zhask: 20, zhuxin: 22, zilong: 20
    };
    const FACE_DEFAULT = 21;

    // Aim a side card's art at the face: the band the card shows is centred on
    // it, as far as the portrait allows. Only the side layout crops this way.
    function aim(img) {
        const id = img.dataset.hero;
        const w = img.clientWidth, h = img.clientHeight;
        const nw = img.naturalWidth || 240, nh = img.naturalHeight || 390;
        if (!w || !h) return;
        const scaled = nh * Math.max(w / nw, h / nh);       // the portrait's height as drawn (object-fit: cover)
        if (scaled - h < 1) { img.style.setProperty('--focus', '50%'); return; }
        const face = (FACE[id] != null ? FACE[id] : FACE_DEFAULT) / 100;
        const at = Math.min(1, Math.max(0, (face * scaled - h / 2) / (scaled - h)));
        img.style.setProperty('--focus', (at * 100).toFixed(1) + '%');
    }

    function setHero(slot, heroId, isPick, traded) {
        const id = heroId || '';
        if (slot.dataset.hero === id) return;
        slot.dataset.hero = id;
        const old = slot.querySelector(':scope > img');
        if (old) old.remove();
        slot.classList.remove('noimg', 'flash', 'traded');
        const hero = Heroes.get(id);
        slot.classList.toggle('filled', !!hero);
        slot.querySelector('.fallback').textContent = hero ? hero.name : '';
        if (isPick) {
            const name = slot.querySelector('.hero');
            name.textContent = hero ? hero.name : '';
            Overlay.fitText(name, 26, 14);
        }
        if (!hero) return;
        const img = el('img');
        img.alt = hero.name;
        img.onerror = function () { slot.classList.add('noimg'); };
        img.src = hero.img;
        // aimed at the face once it is in place and its size is known (see FACE)
        img.dataset.hero = hero.id;
        img.addEventListener('load', function () { aim(img); });
        slot.insertBefore(img, slot.firstChild);
        if (isPick) {
            void slot.offsetWidth;
            // a new pick flashes; a traded hero waits for its card to fly in (see flyTrades)
            slot.classList.add(traded ? 'incoming' : 'flash');
        }
    }

    // A trade on stream: every hero that changed hands lifts off its old card,
    // arcs across to its new one and lands with a flash, one after another,
    // while the players' names stay where they are.
    function flyTrades(side, before, after, moved) {
        const stage = $('stage');
        const box = stage.getBoundingClientRect();
        const k = box.width / 1920 || 1;
        const cards = slots.pick[side];
        const sides = $('draft').dataset.layout === 'sides';
        const used = {};
        moved.forEach(function (to, n) {
            // where this hero was: the old slot holding it (a hero is only picked once per team)
            let from = -1;
            for (let j = 0; j < before.length; j++) if (before[j] === after[to] && !used[j] && j !== to) { from = j; break; }
            if (from < 0) { cards[to].classList.remove('incoming'); return; }
            used[from] = true;
            const hero = Heroes.get(after[to]);
            const a = cards[from].getBoundingClientRect(), b = cards[to].getBoundingClientRect();
            const fly = el('div', 'trade-fly ' + side);
            fly.style.left = (a.left - box.left) / k + 'px';
            fly.style.top = (a.top - box.top) / k + 'px';
            fly.style.width = a.width / k + 'px';
            fly.style.height = a.height / k + 'px';
            fly.style.backgroundImage = 'url("' + hero.img + '")';
            const label = el('b');
            label.textContent = hero.name;
            fly.appendChild(label);
            stage.appendChild(fly);
            const dx = (b.left - a.left) / k, dy = (b.top - a.top) / k;
            // an arc: up and over along the bottom row, out toward the middle down the sides
            const ax = sides ? (side === 'blue' ? 140 : -140) : 0, ay = sides ? 0 : -150;
            const tilt = (n % 2 ? -1 : 1) * 6;
            cards[from].classList.add('trading');
            cards[to].classList.add('trading');
            const run = fly.animate([
                { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 0.4, offset: 0 },
                { transform: 'translate(0, 0) scale(1.08) rotate(0deg)', opacity: 1, offset: 0.12 },
                { transform: 'translate(' + (dx / 2 + ax) + 'px, ' + (dy / 2 + ay) + 'px) scale(1.18) rotate(' + tilt + 'deg)', opacity: 1, offset: 0.55 },
                { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(1) rotate(0deg)', opacity: 1, offset: 1 }
            ], { duration: 1100, delay: 250 + n * 180, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'both' });
            run.onfinish = function () {
                fly.remove();
                cards[to].classList.remove('incoming', 'trading');
                cards[from].classList.remove('trading');
                void cards[to].offsetWidth;
                cards[to].classList.add('landed');
            };
        });
    }
    let lastPicks = null;     // the picks as last drawn, to tell a trade from a pick

    // Fearless row: one small tile per hero the team played in earlier games,
    // grouped by game so a game never splits across two lines.
    function renderPlayed(side, team) {
        const box = $('played-' + side);
        const key = JSON.stringify(team.played);
        if (box.dataset.key === key) return;
        box.dataset.key = key;
        box.textContent = '';
        team.played.forEach(function (entry) {
            const group = el('div', 'pgroup');
            const label = el('div', 'pgame');
            label.textContent = 'G' + entry.game;
            group.appendChild(label);
            box.appendChild(group);
            entry.heroes.forEach(function (id) {
                const hero = Heroes.get(id);
                if (!hero) return;
                const tile = el('div', 'ptile');
                const img = el('img');
                img.alt = hero.name;
                img.onerror = function () { tile.classList.add('noimg'); };
                img.src = hero.img;
                const fallback = el('div', 'fallback');
                fallback.textContent = hero.name;
                tile.appendChild(img);
                tile.appendChild(fallback);
                group.appendChild(tile);
            });
        });
    }

    function render(state) {
        const d = state.draft;
        const step = Store.currentStep(state);
        $('draft').classList.toggle('hidden', !d.visible);
        // The backdrop takes the waiting screen's look for the chosen design.
        Overlay.applyDesign($('dbg'), state.design, 'idle');
        $('dbg').classList.toggle('on', !!d.background && d.visible);
        const moved = Overlay.applyDraftLayout($('draft'), d.layout, state.design);
        const restyled = Overlay.applyDesign($('draft'), state.design, 'draft') || moved;
        $('fearless').classList.toggle('off', d.mode !== 'fearless');
        Store.SIDES.forEach(function (side) { renderPlayed(side, state.teams[side]); });

        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            const trade = lastPicks && Overlay.swapOf(lastPicks[side], d.picks[side]);
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name)) Overlay.fitText($('name-' + side), 44, 20);
            Overlay.renderPips($('pips-' + side), team.score, Store.winsNeeded(state));

            for (let i = 0; i < 5; i++) {
                const ban = slots.ban[side][i];
                ban.style.display = i < d.banCount ? '' : 'none';
                setHero(ban, d.bans[side][i], false);
                ban.classList.toggle('active', !!step && step.type === 'ban' && step.side === side && step.slots.indexOf(i) >= 0 && !d.bans[side][i]);

                const pick = slots.pick[side][i];
                pick.classList.remove('landed');
                setHero(pick, d.picks[side][i], true, !!trade && trade.indexOf(i) >= 0);
                pick.classList.toggle('active', !!step && step.type === 'pick' && step.side === side && step.slots.indexOf(i) >= 0 && !d.picks[side][i]);
                Overlay.setText(pick.querySelector('.nick span'), team.players[i] || '');
                const face = pick.querySelector('.nick img');
                if (team.players[i]) Overlay.setPlayerImage(face, state, team.players[i]);
                else face.hidden = true;
            }
            if (trade) flyTrades(side, lastPicks[side], d.picks[side], trade);
        });

        lastPicks = { blue: d.picks.blue.slice(), red: d.picks.red.slice() };

        if (Overlay.setText($('tour'), state.tournament.name)) Overlay.fitText($('tour'), 34, 16);
        if (Overlay.setText($('stage-name'), state.tournament.stage)) Overlay.fitText($('stage-name'), 18, 12);
        Overlay.setText($('meta'), Overlay.seriesText(state));
        Overlay.renderEffect($('fxp'), state.tournament.effect, true);

        const logo = state.tournament.logo || Overlay.DEFAULT_TOURNAMENT_LOGO;
        if ($('tlogo').getAttribute('src') !== logo) $('tlogo').src = logo;

        const center = $('center');
        center.classList.toggle('blue', !!step && step.side === 'blue');
        center.classList.toggle('red', !!step && step.side === 'red');
        Overlay.setText($('phase'), step ? (step.side + ' ' + step.type) : 'Draft complete');
        // Each design has different box widths, so measure the text again.
        if (restyled) refit();
        // the card's art box changes with the design and with a name bar, so aim every time
        Store.SIDES.forEach(function (side) {
            slots.pick[side].forEach(function (pick) { const img = pick.querySelector(':scope > img'); if (img) aim(img); });
        });
        CentreStage.render(state);
        tick();
    }

    // Sparks (or confetti, in the Championship design) for the backdrop.
    function buildSparks() {
        const box = $('dbg-sparks');
        for (let i = 0; i < 40; i++) {
            const spark = el('i');
            const size = 3 + Math.random() * 7;
            spark.style.left = (Math.random() * 100) + '%';
            spark.style.width = spark.style.height = size + 'px';
            spark.style.animationDuration = (7 + Math.random() * 9) + 's';
            spark.style.animationDelay = (-Math.random() * 16) + 's';
            box.appendChild(spark);
        }
    }

    function refit() {
        ['name-blue', 'name-red'].forEach(function (id) { Overlay.fitText($(id), 44, 20); });
        Overlay.fitText($('tour'), 34, 16);
        Overlay.fitText($('stage-name'), 18, 12);
        Store.SIDES.forEach(function (side) {
            slots.pick[side].forEach(function (pick) { Overlay.fitText(pick.querySelector('.hero'), 26, 14); });
        });
    }

    function tick() {
        CentreStage.tick();
        const state = Store.get();
        const step = Store.currentStep(state);
        const timer = $('timer');
        if (!step) {
            Overlay.setText(timer, 'VS');
            timer.classList.remove('low');
            $('bar').style.transform = 'scaleX(0)';
            return;
        }
        const left = Store.timerLeft(state);
        const total = Store.stepDuration(state, step) || 1;
        Overlay.setText(timer, String(Math.ceil(left / 1000)));
        timer.classList.toggle('low', state.draft.timer.running && left <= 10000);
        $('bar').style.transform = 'scaleX(' + Math.min(1, left / total) + ')';
    }

    Overlay.setupStage($('stage'));
    build();
    buildSparks();
    Store.subscribe(render);
    Store.init().then(function () {
        // Re-fit once the display font is in so widths are measured correctly.
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(refit);
        }
    });
    setInterval(tick, 100);
})();
