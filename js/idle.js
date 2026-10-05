// Waiting screen: who is playing, the series score so far and a countdown,
// for the minutes before a game starts. Run from the Setup tab.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };

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

    function renderRoster(list, players) {
        const names = players.filter(function (name) { return name; });
        const key = names.join('|');
        if (list.dataset.key === key) return;
        list.dataset.key = key;
        list.textContent = '';
        names.forEach(function (name) {
            const item = document.createElement('li');
            item.textContent = name;
            list.appendChild(item);
        });
    }

    function render(state) {
        const restyled = Overlay.applyDesign($('idle'), state.design, 'idle');

        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name) || restyled) Overlay.fitText($('name-' + side), 92, 40);
            Overlay.setText($('score-' + side), String(team.score));
            renderRoster($('roster-' + side), team.players);
        });

        const t = state.tournament;
        if (Overlay.setText($('tour'), t.name) || restyled) Overlay.fitText($('tour'), 54, 26);
        Overlay.setText($('stage-name'), t.stage);
        const logo = t.logo || Overlay.DEFAULT_TOURNAMENT_LOGO;
        if ($('tlogo').getAttribute('src') !== logo) $('tlogo').src = logo;
        Overlay.setText($('series'), 'Best of ' + t.bestOf + ' · Game ' + t.game);

        if (Overlay.setText($('title'), state.idle.title) || restyled) Overlay.fitText($('title'), 60, 30);
        Overlay.setText($('msg'), state.idle.message);
        tick();
    }

    function tick() {
        const state = Store.get();
        const clock = $('clock');
        const left = Store.idleLeft(state);
        clock.hidden = !state.idle.showTimer;
        const total = Math.ceil(left / 1000);
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        Overlay.setText(clock, (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs);
        clock.classList.toggle('low', state.idle.timer.running && left > 0 && left <= 10000);
        clock.classList.toggle('done', left <= 0);
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
