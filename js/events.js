// In-game moments the operator can announce from the Live tab of the control
// panel. Each one plays a short animated banner on the scoreboard overlay.
//
// To add one: add a line to `list`. `team: true` gives it a blue and a red
// button and shows that team's name under the title. `count` also adds one to
// that team's objective counter (towers, turtles or lords) on the scoreboard.
// To use your own artwork instead of the built-in icon, put an image or
// animated GIF in Assets/Events/ and set img, e.g. img: 'Assets/Events/turtle.gif'.
(function (global) {
    'use strict';

    const svg = function (body) {
        return '<svg viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>';
    };

    const icons = {
        turtle: svg(
            '<rect class="leg a" x="14" y="40" width="9" height="13" rx="4"/>' +
            '<rect class="leg b" x="37" y="40" width="9" height="13" rx="4"/>' +
            '<path d="M4 41l8-5v8z"/>' +
            '<ellipse cx="54" cy="35" rx="7" ry="6"/>' +
            '<path d="M8 42c0-15 10-25 23-25s23 10 23 25z"/>' +
            '<path d="M31 20v22M20 24l5 18M42 24l-5 18M11 34h40" fill="none" stroke="#0b0e14" stroke-width="2.4" stroke-linecap="round" opacity="0.55"/>' +
            '<circle cx="57" cy="33" r="1.6" fill="#0b0e14"/>'),
        lord: svg(
            '<path d="M19 25C7 22 3 11 8 2c2 10 9 14 17 15z"/>' +
            '<path d="M45 25c12-3 16-14 11-23-2 10-9 14-17 15z"/>' +
            '<path d="M32 12l15 11-4 24-11 11-11-11-4-24z"/>' +
            '<path d="M22 30l8 4-7 3zM42 30l-8 4 7 3z" fill="#0b0e14"/>' +
            '<path d="M27 46h10l-5 6z" fill="#0b0e14" opacity="0.6"/>'),
        tower: svg('<path d="M16 6h7v6h5V6h8v6h5V6h7v15l-6 6v18l7 7v6H15v-6l7-7V27l-6-6z"/>'),
        wisp: svg(
            '<path d="M30 8c2 13 7 18 20 20-13 2-18 7-20 20-2-13-7-18-20-20 13-2 18-7 20-20z"/>' +
            '<circle cx="52" cy="12" r="5"/><circle cx="50" cy="52" r="4"/><circle cx="10" cy="50" r="3"/>'),
        heal: svg(
            '<path d="M48 4h7v7h7v7h-7v7h-7v-7h-7v-7h7z"/>' +
            '<rect x="12" y="50" width="8" height="10" rx="3.5"/><rect x="32" y="50" width="8" height="10" rx="3.5"/>' +
            '<ellipse cx="50" cy="45" rx="6" ry="5"/>' +
            '<path d="M5 52c0-13 9-22 21-22s21 9 21 22z"/>'),
        coin: svg(
            '<path d="M22 18h5v5h4v-5h6v5h4v-5h5v11l-4 4v14l5 5v5H17v-5l5-5V33l-4-4V18z"/>' +
            '<path d="M32 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z"/>'),
        cloud: svg(
            '<path d="M17 42a11 11 0 0 1 1-22 15 15 0 0 1 29-2 12 12 0 0 1-1 24z"/>' +
            '<path d="M6 51h22M34 51h24M14 59h30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>'),
        grass: svg(
            '<path d="M30 58C28 40 22 26 10 14c14 6 22 18 24 30 2-16 8-28 20-38-8 14-12 30-12 52z"/>' +
            '<path d="M14 58c0-10-3-18-10-24 10 3 16 12 17 24zM50 58c1-9 4-15 10-20-3 7-4 13-4 20z"/>'),
        wall: svg('<path d="M4 12h24l-4 8 6 6-4 8H4zM36 12h24v22H38l-4-8 6-6zM4 38h20l4 6-4 10H4zM32 38h28v16H30l4-10z"/>'),
        river: svg(
            '<path d="M4 20c7-8 14-8 21 0s14 8 21 0 10-6 14-2v9c-4-4-9-4-14 2-7 8-14 8-21 0s-14-8-21 0z"/>' +
            '<path d="M4 40c7-8 14-8 21 0s14 8 21 0 10-6 14-2v9c-4-4-9-4-14 2-7 8-14 8-21 0s-14-8-21 0z"/>'),
        sword: svg(
            '<path d="M52 4l8 0 0 8-28 30-10-10z"/>' +
            '<path d="M14 30l20 20-5 5-20-20z"/>' +
            '<path d="M14 44l6 6-10 10-6-6z"/>'),
        star: svg('<path d="M32 3l8 19 21 2-16 14 5 21-18-11-18 11 5-21L3 24l21-2z"/>'),
        skull: svg(
            '<path d="M32 5C17 5 8 15 8 28c0 8 4 14 9 17v9h30v-9c5-3 9-9 9-17C56 15 47 5 32 5z"/>' +
            '<circle cx="23" cy="29" r="7" fill="#0b0e14"/><circle cx="41" cy="29" r="7" fill="#0b0e14"/>' +
            '<path d="M32 36l4 8h-8z" fill="#0b0e14"/>' +
            '<path d="M26 48v6M32 48v6M38 48v6" stroke="#0b0e14" stroke-width="2.4"/>')
    };

    const list = [
        { id: 'turtle-spawn', label: 'Turtle spawned', title: 'Turtle has spawned', icon: 'turtle', color: '#3fe0c5', enter: 'walk' },
        { id: 'lord-spawn', label: 'Lord spawned', title: 'Lord has spawned', icon: 'lord', color: '#c58bff', enter: 'rise' },
        { id: 'lord-luminous', label: 'Luminous Lord', title: 'Luminous Lord has spawned', icon: 'lord', color: '#ffc94d', enter: 'rise' },
        { id: 'turtle-kill', label: 'Turtle slain', title: 'Turtle slain', icon: 'turtle', team: true, enter: 'walk', count: 'turtles' },
        { id: 'lord-kill', label: 'Lord slain', title: 'Lord slain', icon: 'lord', team: true, enter: 'rise', count: 'lords' },
        { id: 'tower-kill', label: 'Turret destroyed', title: 'Turret destroyed', icon: 'tower', team: true, enter: 'rise', count: 'towers' },
        { id: 'first-blood', label: 'First blood', title: 'First blood', icon: 'sword', team: true, enter: 'slash' },
        { id: 'savage', label: 'Savage', title: 'Savage', icon: 'star', team: true, enter: 'rise' },
        { id: 'wipeout', label: 'Wipe out', title: 'Wipe out', icon: 'skull', team: true, enter: 'rise' }
    ];

    const byId = {};
    list.forEach(function (e) { byId[e.id] = e; });

    // Objective counters shown under each team on the scoreboard.
    const stats = [
        { id: 'towers', label: 'Turrets', icon: 'tower' },
        { id: 'turtles', label: 'Turtles', icon: 'turtle' },
        { id: 'lords', label: 'Lords', icon: 'lord' }
    ];

    // Battlefield effects: the map rule drawn at random for each game. To add
    // one, add a line here; a name typed by hand on the control panel that is
    // not in this list still shows, with a star icon. `group` is the heading
    // it sits under in the control panel's dropdown.
    const CURRENT = 'Season 42 (current)';
    const EARLIER = '2025 set';
    const effects = [
        { name: 'Revealing Wisps', icon: 'wisp', color: '#6fd0ff', group: CURRENT },
        { name: 'Healing Turtle', icon: 'heal', color: '#5fe08a', group: CURRENT },
        { name: 'Golden Turret', icon: 'coin', color: '#ffc94d', group: CURRENT },
        { name: 'Flying Cloud', icon: 'cloud', color: '#b9c6ff', group: CURRENT },
        { name: 'Dangerous Grass', icon: 'grass', color: '#7ddc5a', group: EARLIER },
        { name: 'Broken Walls', icon: 'wall', color: '#e0a070', group: EARLIER },
        { name: 'Expanding Rivers', icon: 'river', color: '#4fb6ff', group: EARLIER }
    ];

    // A typed name still finds its effect if only the case, spacing or a
    // final "s" differs ("expanding river" is Expanding Rivers).
    function effectKey(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
    }

    function effect(name) {
        const key = effectKey(name);
        if (!key) return null;
        const known = effects.filter(function (e) { return effectKey(e.name) === key; })[0];
        return known || { name: String(name).trim(), icon: 'star', color: '#ffc94d' };
    }

    global.GameEvents = {
        list: list,
        stats: stats,
        effects: effects,
        effect: effect,
        icons: icons,
        get: function (id) { return byId[id] || null; }
    };
})(window);
