// MVP overlay: a full-screen card for the player of the game. Everything on
// it comes from the MVP card on the control panel's Live tab. When "alternate
// with the winning team" is on it loops two slides: who won, then the MVP.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const KDA = ['k', 'd', 'a'];
    let shown = '';        // which MVP is on screen, so the entrance replays for a new one
    let slide = 'mvp';     // 'win' | 'mvp'
    let loopKey = '';
    let loopTimer = null;

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

    function teamNamed(state, name) {
        return Store.SIDES.map(function (side) { return state.teams[side]; })
            .filter(function (t) { return t.name === name; })[0] || null;
    }

    // The winner is the MVP's own team unless the operator (or the "who won"
    // button) said otherwise.
    function winnerOf(m) {
        const name = m.winner || m.team;
        const side = name === m.team ? m.side : (m.side === 'blue' ? 'red' : 'blue');
        return { name: name, side: side };
    }

    function renderWinner(state) {
        const m = state.mvp;
        const win = winnerOf(m);
        const team = teamNamed(state, win.name);
        Overlay.renderLogo($('win-logo'), team || { logo: '', tag: win.name });
        if (Overlay.setText($('win-name'), win.name)) Overlay.fitText($('win-name'), 230, 80);
        Overlay.setText($('win-label'), 'Game ' + m.game + ' winner');
        const other = team && Store.SIDES.map(function (side) { return state.teams[side]; })
            .filter(function (t) { return t !== team; })[0];
        Overlay.setText($('win-series'), team && other ? 'Series  ' + team.score + ' – ' + other.score : '');
    }

    // Put one slide on screen; hiding and showing the other replays its entrance.
    function setSlide(name) {
        const state = Store.get();
        const root = $('mvp');
        slide = name;
        root.classList.toggle('slide-win', name === 'win');
        const side = name === 'win' ? winnerOf(state.mvp).side : state.mvp.side;
        root.classList.toggle('blue', side === 'blue');
        root.classList.toggle('red', side === 'red');
        const flash = root.querySelector('.mvp-flash');
        flash.style.animation = 'none';
        void flash.offsetWidth;
        flash.style.animation = '';
        if (name === 'mvp') renderNumbers(state.mvp, true);
        else Overlay.fitText($('win-name'), 230, 80);
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
            // A real portrait leads the card; a team logo or no picture leaves the hero there.
            const pic = Overlay.playerPicture(state, m.player);
            const led = !!pic.src && !pic.logo && pic.src !== Overlay.PLAYER_TEMPLATE;
            const main = led ? pic.src : hero.img;
            if ($('mvp-hero').getAttribute('src') !== main) $('mvp-hero').src = main;
            if ($('mvp-inset').getAttribute('src') !== hero.img) {
                $('mvp-inset').src = hero.img;
                $('mvp-bg').style.backgroundImage = 'url("' + hero.img + '")';
            }
            $('mvp-profile').classList.toggle('player-led', led);
            if (Overlay.setText($('mvp-hero-name'), hero.name) || restyled) Overlay.fitText($('mvp-hero-name'), 68, 34);
            // A player with no nickname entered is shown by hero name.
            if (Overlay.setText($('mvp-player'), m.player || hero.name) || restyled) Overlay.fitText($('mvp-player'), 132, 60);
            Overlay.setText($('mvp-game'), 'Game ' + m.game);
            Overlay.setText($('mvp-team'), m.team);

            // The team may have changed sides since; find it by name for its logo.
            const team = teamNamed(state, m.team) || { logo: '', tag: m.team };
            Overlay.renderLogo($('mvp-logo'), team);
            Overlay.renderLogo($('mvp-mark'), team);
            renderNumbers(m, entering);
            renderWinner(state);
        }

        if (key !== shown) {
            shown = key;
            root.classList.remove('show');
            if (on) {
                void root.offsetWidth; // restart the entrance
                root.classList.add('show');
            }
        }

        // Start, stop or re-time the two-slide loop when anything about it changes.
        const seconds = Math.max(3, Number(m.seconds) || 10);
        const looping = on && m.loop;
        const nextKey = key + '|' + looping + '|' + seconds;
        if (nextKey !== loopKey) {
            loopKey = nextKey;
            clearInterval(loopTimer);
            loopTimer = null;
            if (looping) {
                setSlide('win');
                loopTimer = setInterval(function () { setSlide(slide === 'win' ? 'mvp' : 'win'); }, seconds * 1000);
            } else {
                setSlide('mvp');
            }
        } else {
            // Same slide, but its colour follows a corrected winner or side.
            const side = slide === 'win' ? winnerOf(m).side : m.side;
            root.classList.toggle('blue', side === 'blue');
            root.classList.toggle('red', side === 'red');
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
            document.fonts.ready.then(function () {
                Overlay.fitText($('mvp-player'), 132, 60);
                Overlay.fitText($('win-name'), 230, 80);
            });
        }
    });
})();
