// What a hero brings to a lineup, for the loading screen's draft comparison.
//
// These are ESTIMATES, not numbers from the game: each hero starts from the
// profile of its class below (a hero with two classes gets the average), on a
// scale of 1 (weak) to 3 (strong). To correct a hero, add a line to OVERRIDES
// using its id from js/heroes.js, with all six numbers in the order of
// `metrics`, for example:
//
//     'Aldous': [1.2, 3.0, 2.8, 2.2, 1.4, 2.0],
(function (global) {
    'use strict';

    const metrics = ['Early to mid game', 'Late game', 'Damage', 'Survivability', 'Control', 'Push'];

    const BY_ROLE = {
        Tank:     [2.0, 1.6, 1.2, 3.0, 2.6, 1.4],
        Fighter:  [2.3, 2.0, 2.1, 2.3, 1.8, 2.1],
        Assassin: [2.6, 1.9, 2.7, 1.3, 1.4, 1.8],
        Mage:     [2.0, 2.2, 2.5, 1.3, 2.3, 1.9],
        Marksman: [1.4, 2.9, 2.8, 1.2, 1.2, 2.8],
        Support:  [1.9, 1.7, 1.2, 1.8, 2.4, 1.3]
    };
    const NEUTRAL = [2, 2, 2, 2, 2, 2];

    const OVERRIDES = {
    };

    global.HeroRatings = {
        metrics: metrics,
        of: function (hero) {
            if (!hero) return NEUTRAL;
            if (OVERRIDES[hero.id]) return OVERRIDES[hero.id];
            const rows = (hero.roles || []).map(function (role) { return BY_ROLE[role]; }).filter(Boolean);
            if (!rows.length) return NEUTRAL;
            return metrics.map(function (m, i) { return rows.reduce(function (sum, row) { return sum + row[i]; }, 0) / rows.length; });
        }
    };
})(window);
