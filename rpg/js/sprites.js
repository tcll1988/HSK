/* オリジナルのドット絵。文字の並び（1文字＝1ドット）からcanvasに描く。
   「H:」で始まる絵は左半分だけ書いてあり、左右反転して16ドットにする。 */
(function (g) {
  'use strict';
  var PAL = {
    k: '#1a1c2c', w: '#f4f4f4', s: '#f3c8a0', S: '#d99a73', h: '#6b3e26', r: '#d94a4a', R: '#8f2d3c',
    b: '#3b5dc9', B: '#29366f', y: '#ffcd75', Y: '#e0a030', g: '#38b764', G: '#257179', l: '#a7f070',
    p: '#ff9ab0', o: '#ef7d57', n: '#8b5a2b', N: '#5a3a1e', e: '#94b0c2', E: '#566c86', D: '#333c57',
    v: '#7b4bb8', V: '#41275e', c: '#73eff7', m: '#c0cbdc', t: '#e8d8b0'
  };

  function H(rows) { // 左半分 → 左右対称の16ドット
    return rows.map(function (r) { r = (r + '........').slice(0, 8); return r + r.split('').reverse().join(''); });
  }

  var SPR = {
    /* ---------- 主人公 ---------- */
    hero_down: H([
      '.....kkk', '...kkhhh', '..khhhhh', '..khhhhh', '..krrrrr', '..kshhss', '..ksskss', '..kssssk',
      '...kkssk', '..kbkkkk', '.kbbbbyb', '.ksbbbbb', '.kskbbyy', '..kkbbbb', '...knnkk', '...kkk..'
    ]),
    hero_up: H([
      '.....kkk', '...kkhhh', '..khhhhh', '..khhhhh', '..krrrrr', '..khhhhh', '..khhhhh', '..khhhhh',
      '...khhhh', '..kbkkkk', '.kbbbbbb', '.ksbbbbb', '.kskbbbb', '..kkbbbb', '...knnkk', '...kkk..'
    ]),
    hero_side: [
      '.....kkkkk......', '....khhhhhkk....', '...khhhhhhhhk...', '...khhhhhhhhk...', '...krrrrrrrrrk..',
      '...khhhssssk....', '...khhsssksk....', '...khhsssssk....', '....kkssssk.....', '....kbkkkk......',
      '...kbbbbbbk.....', '...kbbbsbbk.....', '...kbbbskbk.....', '....kkbbbbk.....', '....knnkknk.....', '....kkk.kkk.....'
    ],
    /* ---------- 村の人 ---------- */
    elder: H([
      '........', '.....kkk', '....kmmm', '...kmmmm', '...kmssm', '...kssks', '...kssss', '..kmmmmm',
      '..kmmmmm', '..kvkmmm', '.kvvvkmm', '.kvvvvvv', '.ksvvvvv', '..kvvvvv', '..kvvvvv', '...kkkkk'
    ]),
    shop: H([
      '........', '....kkkk', '...kyyyy', '..kYYYYY', '..khhhhh', '..khssss', '..ksskss', '..ksssss',
      '...kssss', '..kgkkkk', '.kggwwww', '.ksgwwww', '.kskwwww', '..kgwwww', '...knnkk', '...kkk..'
    ]),
    inn: H([
      '........', '....kkkk', '...khhhh', '..khhhhh', '..khhhhh', '..khssss', '..ksskss', '..kssssp',
      '...kssss', '..kpkkkk', '.kppppww', '.kspppww', '.kskppww', '..kppppp', '...kppkk', '...kkk..'
    ]),
    teacher: H([
      '........', '....kkkk', '...kNNNN', '..kNNNNN', '..kNNNNN', '..kNssss', '..kkkkkk', '..kskwsk',
      '...kssss', '..kBkkkk', '.kBBBwwB', '.ksBBwwB', '.kskBBBB', '..kBBBBB', '...kBBkk', '...kkk..'
    ]),
    kid: H([
      '........', '........', '.....kkk', '...kkooo', '..kooooo', '..koosss', '..ksskss', '..kssssp',
      '...kkssk', '...kykkk', '..kyyyyy', '..ksyyyy', '...kbbbb', '...kbbkk', '...kkk..', '........'
    ]),
    guard: H([
      '.....kkk', '...kkeee', '..keeeee', '..keEEEE', '..kekkkk', '..ksssss', '..ksskss', '..ksssss',
      '...kssss', '..keekkk', '.keEEeee', '.kseEeee', '.kskEeee', '..kkEEEE', '...kEEkk', '...kkk..'
    ]),
    /* ---------- 草原 ---------- */
    inkblob: H([
      '........', '........', '........', '........', '......kk', '....kkDD', '...kDDDD', '..kDDeDD',
      '..kDDDDD', '.kDDwwDD', '.kDDwkDD', '.kDDDDDD', 'kDDDDDDk', 'kDDDDDDD', '.kkDDDDD', '...kkkkk'
    ]),
    brushbird: H([
      '........', '.......k', '......kk', '.....kNN', '....kyyy', '...kyyyy', '...kywky', '..kyyyyy',
      'kkkyyyyy', 'kyyyyyoo', '.kyyykoo', '.kkyyyyy', '..kkyyyy', '...kkkyy', '.....kok', '....kk.k'
    ]),
    golem: H([
      '........', '....kkkk', '...keeee', '..keeeee', '..keekke', '..keewke', '..keeeee', '.kkekkkk',
      'keekeeee', 'keekeeEE', 'keeekeEk', 'keeekeEE', '.kkkeeee', '...keeek', '...keeek', '..kkkkkk'
    ]),
    /* ---------- 森 ---------- */
    mushroom: H([
      '........', '.....kkk', '...kkrrr', '..krrwwr', '.krrrwwr', '.krwwrrr', 'krrwwrrr', 'krrrrrrr',
      '.kkkkkkk', '...ktttt', '...ktkwt', '...ktkkt', '...ktttt', '...kttpt', '....kttt', '....kkkk'
    ]),
    kodama: H([
      '......kk', '....kkgl', '...kglll', '..kgglll', '..kggggg', '.kgggggg', '.kggwkgg', '.kggwwgg',
      '.kgggggg', '..kggggk', '...kkggk', '....kgkk', '...knnnn', '...knNnn', '...knnnn', '....kkkk'
    ]),
    panda: H([
      '..kk....', '.kkkk.kk', '.kkwwwww', '..kwwwww', '.kwwwwww', '.kwkkwww', '.kwkwkww', '.kwkkwww',
      '.kwwwwkk', '..kwwwww', '.kkkwwww', 'kkkkkwww', 'kkkkwwww', '.kkkwwww', '..kkkkww', '...kkkkk'
    ]),
    /* ---------- 洞窟 ---------- */
    bat: H([
      '........', '........', 'k.......', 'kk......', 'kvk...kk', 'kvvk.kvv', 'kvvvkvvv', 'kvvvvvwk',
      '.kvvvvvv', '.kvvvvvv', '..kvkvvv', '...k.kvv', '......kw', '.......k', '........', '........'
    ]),
    rockling: H([
      '........', '........', '........', '.....kkk', '...kkEEE', '..kEEeee', '..kEeeee', '.kEeekke',
      '.kEeewke', '.kEeeeee', '.kEEeeek', '.kEEEeee', 'kEEEEEee', 'kEEEEEEE', '.kkkEEEE', '...kkkkk'
    ]),
    dragon: H([
      '.k......', '.kk.....', '.kgk..kk', '..kgkkgg', '..kggggg', '.kgggkwg', '.kggggkg', 'kgggyyyy',
      'kggyyyyy', 'kggggggg', '.kgggggr', '..kggrrr', '.kgggggg', 'kgggyyyy', 'kggkyyyy', '.kkkkkkk'
    ]),
    /* ---------- 城 ---------- */
    ghost: H([
      '........', '.....kkk', '....kwww', '...kwwww', '..kwwwww', '..kwwkkw', '..kwwkkw', '..kwwwww',
      '..kwwwwp', '..kwwwww', '..kwwwww', '..kwwwww', '..kwwwww', '..kwkwkw', '..kk.k.k', '........'
    ]),
    armor: H([
      '......kk', '....kkee', '...keeee', '..keeeee', '..keEkkk', '..keEkrr', '..keEkkk', '..keeeee',
      '.kkkkkee', 'keeeekkk', 'keEEeeee', 'keEeeEEE', '.kkeeEEE', '...keeek', '...keEek', '..kkkkkk'
    ]),
    king: H([
      '..y.y.y.', '..yyyyyy', '..yryyyy', '...kkkkk', '..kvssss', '..kvskks', '..kvssss', '..kvvsss',
      '.kvvvkkk', 'kvvvvvyy', 'kvvvvvyv', 'kvvvvvyv', 'kvvvvvyv', 'kVvvvvvv', 'kVVvvvvv', 'kkkkkkkk'
    ]),
    /* ---------- もの ---------- */
    chest: [
      '................', '................', '................', '..kkkkkkkkkkkk..', '.knnnnnnnnnnnnk.', '.knNNNNNNNNNNnk.',
      '.kkkkkkkkkkkkkk.', '.knnnnnyynnnnnk.', '.knnnnykkynnnnk.', '.knnnnnyynnnnnk.', '.knnnnnnnnnnnnk.',
      '.kNNNNNNNNNNNNk.', '.kkkkkkkkkkkkkk.', '................', '................', '................'
    ],
    chest_open: [
      '................', '..kkkkkkkkkkkk..', '.kNNNNNNNNNNNNk.', '.knnnnnnnnnnnnk.', '.kkkkkkkkkkkkkk.', '.kDDDDDDDDDDDDk.',
      '.kkkkkkkkkkkkkk.', '.knnnnnyynnnnnk.', '.knnnnnnnnnnnnk.', '.knnnnnnnnnnnnk.', '.knnnnnnnnnnnnk.',
      '.kNNNNNNNNNNNNk.', '.kkkkkkkkkkkkkk.', '................', '................', '................'
    ],
    sign: [
      '................', '................', '.kkkkkkkkkkkkkk.', '.knnnnnnnnnnnnk.', '.kntttttttttnnk.', '.knnnnnnnnnnnnk.',
      '.kntttttttnnnnk.', '.knnnnnnnnnnnnk.', '.kNNNNNNNNNNNNk.', '.kkkkkknnkkkkkk.', '......knnk......',
      '......knnk......', '......knNk......', '......knNk......', '.....kkkkkk.....', '................'
    ],
    orb: H([
      '........', '........', '.....kkk', '....kccc', '...kcwwc', '..kcwwcc', '..kccccc', '..kccccb',
      '..kcccbb', '..kccbbb', '...kbbbb', '....kkkk', '....kyyy', '...kYYYY', '...kkkkk', '........'
    ])
  };

  var cache = {};
  function sprite(name, flip) {
    var key = name + (flip ? ':f' : '');
    if (cache[key]) return cache[key];
    var rows = SPR[name];
    if (!rows) throw new Error('no sprite ' + name);
    var c = document.createElement('canvas'); c.width = 16; c.height = 16;
    var x = c.getContext('2d');
    rows.forEach(function (r, j) {
      for (var i = 0; i < 16; i++) {
        var ch = r[i];
        if (!ch || ch === '.') continue;
        x.fillStyle = PAL[ch] || '#f0f';
        x.fillRect(flip ? 15 - i : i, j, 1, 1);
      }
    });
    cache[key] = c;
    return c;
  }

  g.Sprites = { SPR: SPR, PAL: PAL, get: sprite };
})(typeof window !== 'undefined' ? window : globalThis);
