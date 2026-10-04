// In-game moments the operator can announce from the Live tab of the control
// panel. Each one plays a short animated banner on the scoreboard overlay.
//
// To add one: add a line to `list`. `team: true` gives it a blue and a red
// button and shows that team's name under the title.
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
        { id: 'turtle-kill', label: 'Turtle slain', title: 'Turtle slain', icon: 'turtle', team: true, enter: 'walk' },
        { id: 'lord-kill', label: 'Lord slain', title: 'Lord slain', icon: 'lord', team: true, enter: 'rise' },
        { id: 'first-blood', label: 'First blood', title: 'First blood', icon: 'sword', team: true, enter: 'slash' },
        { id: 'savage', label: 'Savage', title: 'Savage', icon: 'star', team: true, enter: 'rise' },
        { id: 'wipeout', label: 'Wipe out', title: 'Wipe out', icon: 'skull', team: true, enter: 'rise' }
    ];

    const byId = {};
    list.forEach(function (e) { byId[e.id] = e; });

    global.GameEvents = {
        list: list,
        icons: icons,
        get: function (id) { return byId[id] || null; }
    };
})(window);
