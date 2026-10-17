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
        el.classList.remove('fit-wrap');
        el.style.fontSize = size + 'px';
        while (size > minPx && el.scrollWidth > el.clientWidth) {
            size -= 1;
            el.style.fontSize = size + 'px';
        }
        // Still too long at the smallest size it should be: go a little
        // smaller, and after that onto a second line. It is never cut.
        const floor = Math.max(9, Math.round(minPx * 0.7));
        while (size > floor && el.scrollWidth > el.clientWidth) {
            size -= 1;
            el.style.fontSize = size + 'px';
        }
        if (el.scrollWidth > el.clientWidth) {
            el.classList.add('fit-wrap');
            // where the box has only so much height (a thin strip), the lines
            // have to fit in it as well
            while (size > 9 && el.scrollHeight > el.clientHeight + 1) {
                size -= 1;
                el.style.fontSize = size + 'px';
            }
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

    // The standings only mean something once somebody has a result. Before
    // that every team is "1st" on nothing, so the overlays leave them out.
    function hasStandings(state) {
        return state.season.standings.some(function (row) {
            return row.team && [row.w, row.l, row.pts].some(function (v) { return Number(v) > 0; });
        });
    }

    // A schedule score as [a, b], only when it is a finished match: two numbers
    // with a winner. "0 - 0", an empty box or anything else is not a result.
    function matchResult(text) {
        const m = /(\d+)\D+(\d+)/.exec(String(text == null ? '' : text));
        return m && Number(m[1]) !== Number(m[2]) ? [Number(m[1]), Number(m[2])] : null;
    }

    // ---- hero classes as icons ------------------------------------------------
    // A class is drawn, not written: "Fighter / Assassin" never fitted the small
    // places it has to go.
    const ROLE_ICONS = {
        Tank: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 3.2 5 1.9V11c0 3.4-2 6.5-5 7.8V5.2Z"/>',
        Fighter: '<path d="M14.6 2H22v7.4L11.6 19.8l1.5 1.5-1.4 1.4-2.6-2.6-2.4 2.4H3.5v-3.2l2.4-2.4-2.6-2.6 1.4-1.4 1.5 1.5L14.6 2Zm.9 2.2L7.6 12.1l4.3 4.3 7.9-7.9V4.2h-4.3Z"/>',
        Assassin: '<path d="M12 1 16 12l-2.5 2.5h3V17H13v6h-2v-6H7.5v-2.5h3L8 12 12 1Zm0 5.6L10.4 11.4 12 13l1.6-1.6L12 6.6Z"/>',
        Mage: '<path d="m12 1 2.7 7.3L22 11l-7.3 2.7L12 21l-2.7-7.3L2 11l7.3-2.7L12 1Zm7 14 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
        Marksman: '<path d="M11 1h2v3.1A8 8 0 0 1 19.9 11H23v2h-3.1A8 8 0 0 1 13 19.9V23h-2v-3.1A8 8 0 0 1 4.1 13H1v-2h3.1A8 8 0 0 1 11 4.1V1Zm1 5.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Zm0 3.8a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
        Support: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.6 5v3.4H7v3.2h3.4V17h3.2v-3.4H17v-3.2h-3.4V7h-3.2Z"/>'
    };
    function roleIcons(roles) {
        const box = document.createElement('span');
        box.className = 'roles';
        (roles || []).forEach(function (role) {
            if (!ROLE_ICONS[role]) return;
            const mark = document.createElement('i');
            mark.className = 'role';
            mark.title = role;
            mark.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true">' + ROLE_ICONS[role] + '</svg>';
            box.appendChild(mark);
        });
        return box;
    }

    // ---- nothing on screen is cut off --------------------------------------------
    // Text that a box would clip (a name longer than its space) is made smaller
    // until it fits, and wraps if even the smallest size is too long. It runs by
    // itself on every overlay, whenever text changes or a hidden panel appears,
    // so a new screen is covered without having to remember to ask for it.
    // Names sized by fitText (class "fit") look after themselves.
    const fitted = new WeakMap();    // element -> the text it was last sized for
    function clipsText(el) {
        if (el.childElementCount || el.classList.contains('fit') || !el.textContent.trim()) return false;
        const cs = getComputedStyle(el);
        return cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    }
    function overflows(el) { return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight + 2; }
    // Text in a row or column that sizes itself to its words can grow past the
    // box it sits in and run over its neighbour without ever being "clipped".
    function spills(el) {
        const parent = el.parentElement;
        if (!parent || !/flex|grid/.test(getComputedStyle(parent).display)) return false;
        return el.offsetWidth > parent.clientWidth + 1;   // laid-out sizes, so an entrance that scales it in does not count
    }
    function fitOne(el) {
        if (!el.clientWidth) return;                 // hidden for now; the sweep comes back to it
        // A name sized by fitText can be squeezed afterwards, when the layout
        // around it changes without its words changing. Catch that here.
        if (el.classList.contains('fit')) {
            if (el.classList.contains('fit-wrap') || el.scrollWidth <= el.clientWidth) return;
            let now = parseFloat(getComputedStyle(el).fontSize) || 16;
            while (now > 9 && el.scrollWidth > el.clientWidth) {
                now -= 1;
                el.style.fontSize = now + 'px';
            }
            if (el.scrollWidth > el.clientWidth) el.classList.add('fit-wrap');
            return;
        }
        const text = el.textContent;
        if (fitted.get(el) === text) return;
        if (el.dataset.autofit) {                    // sized for other words: start again
            el.style.fontSize = '';
            el.style.whiteSpace = '';
            el.style.overflowWrap = '';
            el.style.textOverflow = '';
            el.style.maxWidth = '';
            el.style.overflow = '';
            delete el.dataset.autofit;
        }
        fitted.set(el, text);
        if (!el.childElementCount && text.trim() && spills(el)) {   // hold it to its box, then size it
            el.style.maxWidth = '100%';
            el.style.overflow = 'hidden';
            el.dataset.autofit = '1';
        }
        if (!clipsText(el) || !overflows(el)) return;
        let size = parseFloat(getComputedStyle(el).fontSize) || 16;
        const smallest = Math.max(9, size * 0.5);
        el.dataset.autofit = '1';
        while (size > smallest && overflows(el)) {
            size -= 1;
            el.style.fontSize = size + 'px';
        }
        if (!overflows(el) && size > smallest) el.style.fontSize = (size - 1) + 'px';   // a hair of slack, so no "…" on a rounding edge
        if (overflows(el)) {                         // still too long: show all of it on more lines
            el.style.whiteSpace = 'normal';
            el.style.overflowWrap = 'anywhere';
            el.style.textOverflow = 'clip';
        }
    }
    function fitWithin(root) {
        if (!root || root.nodeType !== 1) return;
        if (!root.childElementCount) { fitOne(root); return; }
        root.querySelectorAll('*').forEach(function (el) { if (!el.childElementCount) fitOne(el); });
    }
    function autoFit() {
        if (!global.MutationObserver || !document.body) return;
        const waiting = new Set();
        let timer = null;
        function flush() {
            timer = null;
            waiting.forEach(fitWithin);
            waiting.clear();
        }
        new MutationObserver(function (records) {
            records.forEach(function (r) {
                const node = r.type === 'characterData' ? r.target.parentNode : r.target;
                if (node) waiting.add(node);
            });
            if (!timer) timer = setTimeout(flush, 0);   // before the next frame is drawn, so a long name is never seen cut
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        // panels that were hidden when their text arrived, and late fonts
        setInterval(function () { fitWithin(document.body); }, 1500);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitWithin(document.body); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoFit);
    else autoFit();

    // Team-mates trading heroes: the same picks, some of them in other places
    // (two players swapping, or several trades sent at once). Returns the slots
    // that changed, or null when it is anything else (a new pick, a cleared one).
    function swapOf(before, after) {
        if (!before || !after) return null;
        const moved = [];
        for (let i = 0; i < after.length; i++) if ((before[i] || '') !== (after[i] || '')) moved.push(i);
        if (moved.length < 2) return null;
        const was = moved.map(function (i) { return before[i] || ''; }).sort().join('|');
        const now = moved.map(function (i) { return after[i] || ''; }).sort().join('|');
        return was === now && moved.every(function (i) { return after[i]; }) ? moved : null;
    }

    // A match with no result whose date has gone by (never played, or its
    // score never entered) is not "coming up". Schedule times are Philippine
    // wall-clock time, so the comparison uses the PH date. Undated matches count.
    function stillAhead(row) {
        const day = /^\d{4}-\d{2}-\d{2}/.exec(String(row && row.when || ''));
        if (!day) return true;
        return day[0] >= new Date(Store.now() + 8 * 3600000).toISOString().slice(0, 10);
    }

    global.Overlay = {
        swapOf: swapOf,
        stillAhead: stillAhead,
        roleIcons: roleIcons,
        fitWithin: fitWithin,
        hasStandings: hasStandings,
        matchResult: matchResult,
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
