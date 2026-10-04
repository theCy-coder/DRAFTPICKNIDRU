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
    function applyDesign(root, design) {
        const name = new URLSearchParams(location.search).get('design') || design || 'classic';
        if (root.dataset.design === name) return false;
        root.dataset.design = name;
        return true;
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
        seriesText: seriesText
    };
})(window);
