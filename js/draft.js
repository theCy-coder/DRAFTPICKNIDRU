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
    function setHero(slot, heroId, isPick) {
        const id = heroId || '';
        if (slot.dataset.hero === id) return;
        slot.dataset.hero = id;
        const old = slot.querySelector(':scope > img');
        if (old) old.remove();
        slot.classList.remove('noimg', 'flash');
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
        slot.insertBefore(img, slot.firstChild);
        if (isPick) {
            void slot.offsetWidth;
            slot.classList.add('flash');
        }
    }

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
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name)) Overlay.fitText($('name-' + side), 44, 20);
            Overlay.renderPips($('pips-' + side), team.score, Store.winsNeeded(state));

            for (let i = 0; i < 5; i++) {
                const ban = slots.ban[side][i];
                ban.style.display = i < d.banCount ? '' : 'none';
                setHero(ban, d.bans[side][i], false);
                ban.classList.toggle('active', !!step && step.type === 'ban' && step.side === side && step.slots.indexOf(i) >= 0 && !d.bans[side][i]);

                const pick = slots.pick[side][i];
                setHero(pick, d.picks[side][i], true);
                pick.classList.toggle('active', !!step && step.type === 'pick' && step.side === side && step.slots.indexOf(i) >= 0 && !d.picks[side][i]);
                Overlay.setText(pick.querySelector('.nick span'), team.players[i] || '');
                const face = pick.querySelector('.nick img');
                if (team.players[i]) Overlay.setPlayerImage(face, state, team.players[i]);
                else face.hidden = true;
            }
        });

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
