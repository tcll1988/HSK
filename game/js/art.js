/* オリジナルのドット絵（文字列マップからcanvasに描画） */
(function (g) {
  'use strict';
  var SPR = {
    hero: [
      '......kkkk......',
      '....kkbbbbkk....',
      '...kbbbbbbbbk...',
      '..kbbbbbbbbbbk..',
      '..kbwwwwwwwwbk..',
      '..kwwkwwwwkwwk..',
      '..kwwkwwwwkwwk..',
      '..kwpwwwwwwpwk..',
      '...kwwwkkwwwk...',
      '....kkkkkkkk....',
      '...krrrrrrrrk...',
      '..kyrrrrrrrryk..',
      '..kwkrrrrrrkwk..',
      '...kkrrkkrrkk...',
      '....kbbk.kbbk...',
      '....kkk...kkk...'
    ],
    slime: [
      '......kkkk......',
      '....kkggggkk....',
      '...kgglgggggk...',
      '..kgllgggggggk..',
      '..kggggggggggk..',
      '.kggkkggggkkggk.',
      '.kggkwggggkwggk.',
      '.kggggggggggggk.',
      'kgggggggkkgggggk',
      'kggggggggggggddk',
      'kddggggggggggddk',
      '.kkkkkkkkkkkkkk.'
    ],
    lantern: [
      '.....kkkkkk.....',
      '......kyyk......',
      '...kkkkkkkkkk...',
      '..krrrrrrrrrrk..',
      '.krrlrrrrrrrrrk.',
      '.krlrkkrrkkrrrk.',
      'krrrrkwrrkwrrrrk',
      'kyyyyyyyyyyyyyyk',
      'krrrrrrrrrrrrrrk',
      'krrrrkkkkkkrrrrk',
      '.krrrkrrrrkrrrk.',
      '.krrrrkkkkrrrrk.',
      '..krrrrrrrrrrk..',
      '...kkkkkkkkkk...',
      '......kyyk......',
      '.......kk.......'
    ],
    crown: [
      'y..y..y..y',
      'yy.yy.yy.y',
      'yyyyyyyyyy',
      'yryyyyyyry'
    ],
    heart: [
      '.kk.kk.',
      'krrkrrk',
      'krrrrrk',
      '.krrrk.',
      '..krk..',
      '...k...'
    ]
  };
  var PAL = {
    k: '#1b1b2f', b: '#2b2d42', w: '#ffe0bd', p: '#ff8fa3', r: '#e63946', y: '#ffd166',
    g: '#52b788', l: '#b7e4c7', d: '#2d6a4f'
  };
  var cache = {};
  function sprite(name, swap) {
    var key = name + JSON.stringify(swap || {});
    if (cache[key]) return cache[key];
    var map = SPR[name], h = map.length, w = 0;
    map.forEach(function (r) { w = Math.max(w, r.length); });
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d');
    for (var j = 0; j < h; j++) for (var i = 0; i < map[j].length; i++) {
      var ch = map[j][i]; if (ch === '.') continue;
      x.fillStyle = (swap && swap[ch]) || PAL[ch] || '#f0f'; x.fillRect(i, j, 1, 1);
    }
    cache[key] = c; return c;
  }
  var ENEMY_SWAPS = [
    {}, { g: '#9d4edd', l: '#e0aaff', d: '#5a189a' }, { g: '#4cc9f0', l: '#caf0f8', d: '#0077b6' },
    { g: '#f4a261', l: '#ffe8d6', d: '#bc6c25' }, { g: '#ef476f', l: '#ffc2d1', d: '#9d0208' }
  ];
  var THEMES = [
    ['#7ec8e3', '#cdeffd', '#6a994e', '#386641'], ['#ffb4a2', '#ffe5d9', '#e5989b', '#6d6875'],
    ['#90e0ef', '#e0fbfc', '#52b788', '#1b4332'], ['#f6bd60', '#f7ede2', '#84a59d', '#3d405b'],
    ['#22223b', '#4a4e69', '#9a8c98', '#22223b'], ['#a2d2ff', '#ffffff', '#8ecae6', '#023047']
  ];
  g.Art = { sprite: sprite, ENEMY_SWAPS: ENEMY_SWAPS, THEMES: THEMES, PAL: PAL };
})(window);
