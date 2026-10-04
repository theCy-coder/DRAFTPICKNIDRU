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
        box.style.top = (Number(state.banner.top) || 0) + 'px';
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

    function render(state) {
        const sb = state.scoreboard;
        const board = $('sb');
        const split = sb.layout !== 'bar';
        board.classList.toggle('split', split);
        board.classList.toggle('bar', !split);
        board.classList.toggle('hidden', !sb.visible);
        board.classList.toggle('no-info', !sb.showInfo);
        const restyled = Overlay.applyDesign(board, sb.design);
        board.style.top = (Number(sb.top) || 0) + 'px';
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
            if (Overlay.setText($('name-' + side), team.name) || restyled) Overlay.fitText($('name-' + side), 38, 18);
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
        if (Overlay.setText($('tour'), t.name) || restyled) Overlay.fitText($('tour'), 26, 14);
        Overlay.setText($('series'), (t.stage ? t.stage + ' · ' : '') + Overlay.seriesText(state));
        renderEvent(state);
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
