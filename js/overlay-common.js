// Helpers shared by the two overlay pages.
(function (global) {
    'use strict';

    const DEFAULT_TOURNAMENT_LOGO = 'Assets/Other/tournamentlogo.png';

    // Scale the 1920x1080 stage to the window so the page also previews
    // correctly in a normal browser tab. In OBS the scale is exactly 1.
    function setupStage(stage) {
        const params = new URLSearchParams(location.search);
        if (params.get('bg') === 'green') document.body.classList.add('bg-green');
        else if (!global.obsstudio && params.get('bg') !== 'none') document.body.classList.add('preview');
        // Fit the whole stage inside the window, whatever its shape, so
        // nothing is cut off when the window is not exactly 16:9.
        function fit() {
            const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
            const left = Math.max(0, (window.innerWidth - 1920 * scale) / 2);
            stage.style.transform = 'translate(' + left + 'px, 0) scale(' + scale + ')';
        }
        window.addEventListener('resize', fit);
        fit();
    }

    // Shrink text until it fits its box.
    function fitText(el, maxPx, minPx) {
        let size = maxPx;
        el.style.fontSize = size + 'px';
        while (size > minPx && el.scrollWidth > el.clientWidth) {
            size -= 1;
            el.style.fontSize = size + 'px';
        }
    }

    function setText(el, text) {
        if (el.textContent === text) return false;
        el.textContent = text;
        return true;
    }

    function renderLogo(el, team) {
        const key = team.logo ? 'img:' + team.logo.length + ':' + team.logo.slice(-40) : 'tag:' + team.tag;
        if (el.dataset.key === key) return;
        el.dataset.key = key;
        el.textContent = '';
        if (team.logo) {
            const img = document.createElement('img');
            img.src = team.logo;
            img.alt = '';
            el.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.textContent = (team.tag || team.name || '').slice(0, 4).toUpperCase();
            el.appendChild(span);
        }
    }

    function renderPips(el, score, needed) {
        if (el.children.length !== needed) {
            el.textContent = '';
            for (let i = 0; i < needed; i++) {
                const pip = document.createElement('i');
                pip.className = 'pip';
                el.appendChild(pip);
            }
        }
        for (let i = 0; i < needed; i++) el.children[i].classList.toggle('on', i < score);
    }

    // Put the chosen design on the overlay root. Adding ?design=name to the
    // page URL overrides the control panel, e.g. to preview a design or to
    // give one OBS scene its own look. Returns true when the design changed.
    // `kind` is 'draft', 'scoreboard', 'mvp' or 'idle'. A show design can use
    // a differently named look on one overlay: Studio's scoreboard is the
    // thin strip called "minimal".
    const DESIGNS = {
        classic: {}, slant: {}, glass: {}, neon: {}, prestige: {}, championship: {},
        studio: { scoreboard: 'minimal' }
    };
    const OLD_NAMES = { towers: 'studio', minimal: 'studio' };

    function applyDesign(root, design, kind) {
        let name = new URLSearchParams(location.search).get('design') || design || 'classic';
        name = OLD_NAMES[name] || name;
        if (!DESIGNS[name]) name = 'classic';
        const look = DESIGNS[name][kind] || name;
        if (root.dataset.design === look) return false;
        root.dataset.design = look;
        return true;
    }

    // Where the draft puts the picks: along the bottom, or stacked down the
    // left and right edges. 'auto' follows the show design (Studio uses the
    // edges). ?layout=sides or ?layout=bottom on the URL overrides it.
    function applyDraftLayout(root, layout, design) {
        const params = new URLSearchParams(location.search);
        let choice = params.get('layout') || layout || 'auto';
        if (choice !== 'sides' && choice !== 'bottom') {
            const name = OLD_NAMES[params.get('design') || design] || params.get('design') || design;
            choice = name === 'studio' ? 'sides' : 'bottom';
        }
        if (root.dataset.layout === choice) return false;
        root.dataset.layout = choice;
        return true;
    }

    // A player's display photo, found by nickname in the Season tab's roster.
    // Anyone without one gets the template portrait.
    const PLAYER_TEMPLATE = 'Assets/Other/player-template.svg';

    // What to show for a player: { src, logo }. `src` is '' when the roster
    // says to show nothing; `logo` is true when it is the team's logo, which
    // should be fitted whole rather than cropped like a portrait.
    function playerPicture(state, name) {
        const key = String(name || '').trim().toLowerCase();
        const row = key && state.season.players.filter(function (p) { return String(p.name || '').trim().toLowerCase() === key; })[0];
        if (!row) return { src: PLAYER_TEMPLATE, logo: false };
        // a photo uploaded before the choice existed still shows
        const show = row.show || (row.photo ? 'own' : 'default');
        if (show === 'none') return { src: '', logo: false };
        if (show === 'own' && row.photo) return { src: row.photo, logo: false };
        if (show === 'team') {
            const team = state.season.teams.filter(function (t) { return t.id === row.team; })[0];
            if (team && team.logo) return { src: team.logo, logo: true };
        }
        return { src: PLAYER_TEMPLATE, logo: false };
    }

    function playerPhoto(state, name) { return playerPicture(state, name).src; }

    // Point an <img> at a player's picture, hiding it when there is none.
    function setPlayerImage(img, state, name) {
        const pic = playerPicture(state, name);
        img.hidden = !pic.src;
        img.classList.toggle('is-logo', pic.logo);
        if (pic.src && img.getAttribute('src') !== pic.src) img.src = pic.src;
        return pic;
    }

    // Battlefield effect panel: icon plus name. Shown while `show` is true and
    // the game has an effect set.
    function renderEffect(el, name, show) {
        const def = show && global.GameEvents ? global.GameEvents.effect(name) : null;
        el.classList.toggle('show', !!def);
        if (!def || el.dataset.name === def.name) return;
        el.dataset.name = def.name;
        el.style.setProperty('--fx', def.color);
        el.innerHTML = '<div class="fxp-icon">' + (global.GameEvents.icons[def.icon] || '') + '</div><div class="fxp-name"></div>';
        el.lastChild.textContent = def.name;
    }

    function seriesText(state) {
        return 'Game ' + state.tournament.game + ' · Best of ' + state.tournament.bestOf;
    }

    global.Overlay = {
        DEFAULT_TOURNAMENT_LOGO: DEFAULT_TOURNAMENT_LOGO,
        setupStage: setupStage,
        fitText: fitText,
        setText: setText,
        renderLogo: renderLogo,
        renderPips: renderPips,
        applyDesign: applyDesign,
        applyDraftLayout: applyDraftLayout,
        PLAYER_TEMPLATE: PLAYER_TEMPLATE,
        playerPhoto: playerPhoto,
        playerPicture: playerPicture,
        setPlayerImage: setPlayerImage,
        renderEffect: renderEffect,
        seriesText: seriesText
    };
})(window);
