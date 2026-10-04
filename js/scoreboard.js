// In-game scoreboard overlay: team names, logos and the series score.
(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };

    function render(state) {
        const sb = state.scoreboard;
        const board = $('sb');
        const split = sb.layout !== 'bar';
        board.classList.toggle('split', split);
        board.classList.toggle('bar', !split);
        board.classList.toggle('hidden', !sb.visible);
        board.classList.toggle('no-info', !sb.showInfo);
        board.style.top = (Number(sb.top) || 0) + 'px';
        // In split mode the middle is an empty gap that the game's own
        // kill/gold HUD shows through.
        $('middle').style.width = split ? (Number(sb.gap) || 0) + 'px' : '';

        Store.SIDES.forEach(function (side) {
            const team = state.teams[side];
            Overlay.renderLogo($('logo-' + side), team);
            if (Overlay.setText($('name-' + side), team.name)) Overlay.fitText($('name-' + side), 38, 18);
            Overlay.renderPips($('pips-' + side), team.score, Store.winsNeeded(state));
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
        if (Overlay.setText($('tour'), t.name)) Overlay.fitText($('tour'), 26, 14);
        Overlay.setText($('series'), (t.stage ? t.stage + ' · ' : '') + Overlay.seriesText(state));
    }

    Overlay.setupStage($('stage'));
    Store.subscribe(render);
    Store.init().then(function () {
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                ['name-blue', 'name-red'].forEach(function (id) { Overlay.fitText($(id), 38, 18); });
            });
        }
    });
})();
