// MVP overlay: a full-screen card for the player of the game. Everything on
// it comes from the MVP card on the control panel's Live tab.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const KDA = ['k', 'd', 'a'];
    let shown = '';   // which MVP is on screen, so the entrance replays for a new one

    function isCount(v) { return /^\d+$/.test(String(v)); }

    // Gold sparks drifting up the screen. Built once, at random spots.
    function buildSparks() {
        const box = $('mvp-sparks');
        for (let i = 0; i < 34; i++) {
            const spark = document.createElement('i');
            const size = 3 + Math.random() * 7;
            spark.style.left = (Math.random() * 100) + '%';
            spark.style.width = spark.style.height = size + 'px';
            spark.style.animationDuration = (6 + Math.random() * 8) + 's';
            spark.style.animationDelay = (-Math.random() * 14) + 's';
            box.appendChild(spark);
        }
    }

    // Roll a number up from zero when the MVP first appears.
    function countUp(el, to) {
        const start = performance.now() + 900;   // after the tiles have landed
        const length = 900;
        el.textContent = '0';
        function frame(now) {
            if (el.dataset.target !== String(to)) return;   // changed meanwhile
            const t = Math.min(1, Math.max(0, (now - start) / length));
            el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function renderNumbers(m, animate) {
        KDA.forEach(function (key) {
            const el = $('mvp-' + key);
            const value = m[key] === '' ? '-' : String(m[key]);
            const changed = el.dataset.target !== value;
            el.dataset.target = value;
            if (animate && isCount(value)) countUp(el, Number(value));
            else if (changed || animate) el.textContent = value;
        });
        $('mvp-kda').hidden = m.k === '' && m.d === '' && m.a === '';

        // KDA ratio, shown only when all three are plain numbers.
        const full = KDA.every(function (key) { return isCount(m[key]); });
        $('mvp-ratio-box').hidden = !full;
        if (full) {
            const ratio = (Number(m.k) + Number(m.a)) / Math.max(1, Number(m.d));
            Overlay.setText($('mvp-ratio'), ratio.toFixed(1).replace(/\.0$/, ''));
        }

        let extras = 0;
        $('mvp-stats').querySelectorAll('[data-stat]').forEach(function (box) {
            const value = m.kdaOnly ? '' : String(m[box.dataset.stat] || '');
            box.hidden = !value;
            if (value) extras += 1;
            Overlay.setText(box.querySelector('b'), value);
        });
        $('mvp-stats').hidden = !extras;
    }

    function render(state) {
        const m = state.mvp;
        const hero = Heroes.get(m.hero);
        const root = $('mvp');
        const on = m.visible && !!hero;
        const key = on ? m.hero + '|' + m.game + '|' + m.team : '';
        const entering = key !== shown && on;
        const restyled = Overlay.applyDesign(root, state.design, 'mvp');

        if (hero) {
            if ($('mvp-hero').getAttribute('src') !== hero.img) {
                $('mvp-hero').src = hero.img;
                $('mvp-bg').style.backgroundImage = 'url("' + hero.img + '")';
            }
            Overlay.setText($('mvp-hero-name'), hero.name);
            // A player with no nickname entered is shown by hero name.
            if (Overlay.setText($('mvp-player'), m.player || hero.name) || restyled) Overlay.fitText($('mvp-player'), 176, 70);
            Overlay.setText($('mvp-game'), 'Game ' + m.game);
            Overlay.setText($('mvp-team'), m.team);

            // The team may have changed sides since; find it by name for its logo.
            const team = Store.SIDES.map(function (side) { return state.teams[side]; })
                .filter(function (t) { return t.name === m.team; })[0] || { logo: '', tag: m.team };
            Overlay.renderLogo($('mvp-logo'), team);
            Overlay.renderLogo($('mvp-mark'), team);
            renderNumbers(m, entering);
        }

        root.classList.toggle('blue', m.side === 'blue');
        root.classList.toggle('red', m.side === 'red');
        if (key !== shown) {
            shown = key;
            root.classList.remove('show');
            if (on) {
                void root.offsetWidth; // restart the entrance
                root.classList.add('show');
            }
        }

        if (Overlay.setText($('tour'), state.tournament.name)) Overlay.fitText($('tour'), 40, 20);
        Overlay.setText($('stage-name'), state.tournament.stage);
        const logo = state.tournament.logo || Overlay.DEFAULT_TOURNAMENT_LOGO;
        if ($('tlogo').getAttribute('src') !== logo) $('tlogo').src = logo;
    }

    Overlay.setupStage($('stage'));
    buildSparks();
    Store.subscribe(render);
    Store.init().then(function () {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { Overlay.fitText($('mvp-player'), 176, 70); });
        }
    });
})();
