/* 世界のデータ：地図・人・宝箱・エリア・モンスター・アイテム。
   地図の文字：. 地面  , 草むら（モンスターが出る）  T 木・岩・壁  ~ 水  = 道  f 花
              R 屋根  W 家の壁  d 家の戸 */
(function (g) {
  'use strict';

  // 会話の中国語はHSK1の単語でつくった短い文（zh・ピンイン・日本語訳）
  function zh(z, p, j) { return { zh: z, py: p, ja: j }; }

  var ITEMS = {
    herb: { name: '薬草', desc: 'HPを15回復', price: 8, heal: 15 },
    tea: { name: '元気のお茶', desc: 'HPを40回復', price: 25, heal: 40 },
    ink: { name: '魔法の墨', desc: 'MPを5回復', price: 12, mp: 5 }
  };
  var GEAR = {
    brush: { name: '木の筆', slot: 'weapon', atk: 2, price: 30, desc: '攻撃+2' },
    pen: { name: '鉄のペン', slot: 'weapon', atk: 5, price: 120, desc: '攻撃+5' },
    jade: { name: '玉の筆', slot: 'weapon', atk: 9, price: 300, desc: '攻撃+9' },
    cloth: { name: '布の服', slot: 'armor', def: 1, price: 20, desc: '防御+1' },
    vest: { name: '革のベスト', slot: 'armor', def: 3, price: 90, desc: '防御+3' },
    robe: { name: '学者のローブ', slot: 'armor', def: 6, price: 260, desc: '防御+6' }
  };

  var AREAS = {
    1: { name: 'あいさつ草原', map: 'plain', tier: 1, need: 0, bg: 'plain',
      monsters: [{ sp: 'inkblob', name: 'すみまる' }, { sp: 'brushbird', name: 'ふでどり' }],
      boss: { sp: 'golem', name: 'かぞえ巨人', hits: 7,
        intro: [zh('你好！你会说汉语吗？', 'Nǐ hǎo! Nǐ huì shuō Hànyǔ ma?', 'こんにちは！中国語が話せるのか？')],
        outro: [zh('谢谢你！再见！', 'Xièxie nǐ! Zàijiàn!', 'ありがとう！さようなら！')] } },
    2: { name: 'くらしの森', map: 'forest', tier: 2, need: 1, bg: 'forest',
      monsters: [{ sp: 'mushroom', name: 'ねぼけきのこ' }, { sp: 'kodama', name: 'こだま' }],
      boss: { sp: 'panda', name: 'くいしんぼパンダ', hits: 8,
        intro: [zh('我想吃米饭！我想喝茶！', 'Wǒ xiǎng chī mǐfàn! Wǒ xiǎng hē chá!', 'ごはんが食べたい！お茶が飲みたい！')],
        outro: [zh('我很高兴。谢谢！', 'Wǒ hěn gāoxìng. Xièxie!', 'うれしいなあ。ありがとう！')] } },
    3: { name: 'うごきの洞窟', map: 'cave', tier: 3, need: 2, bg: 'cave',
      monsters: [{ sp: 'bat', name: 'よるこうもり' }, { sp: 'rockling', name: 'いしころん' }],
      boss: { sp: 'dragon', name: 'まいご竜', hits: 9,
        intro: [zh('你是谁？我不认识你！', 'Nǐ shì shéi? Wǒ bú rènshi nǐ!', 'おまえはだれだ？知らないやつだ！')],
        outro: [zh('对不起。我想回家。', 'Duìbuqǐ. Wǒ xiǎng huí jiā.', 'ごめんなさい。家に帰りたい……')] } },
    4: { name: 'わすれんぼう城', map: 'castle', tier: 4, need: 3, bg: 'castle',
      monsters: [{ sp: 'ghost', name: 'ふわゆうれい' }, { sp: 'armor', name: 'からっぽよろい' }],
      boss: { sp: 'king', name: 'わすれんぼう大王', hits: 11, final: true,
        intro: [zh('这些字都是我的！', 'Zhèxiē zì dōu shì wǒ de!', 'この字はぜんぶわしのものだ！')],
        outro: [zh('对不起……我也想学习汉语。', 'Duìbuqǐ…… wǒ yě xiǎng xuéxí Hànyǔ.', 'ごめんなさい……わしも中国語を勉強したかったのだ。')] } }
  };

  var MAPS = {
    village: {
      name: 'はじまりの村', style: 'village',
      rows: [
        'TTTTTTTTTTT=TTTTTTTTTT',
        'T..f.......=......f..T',
        'T..........=...RRRR..T',
        'T...f......=...WdWW..T',
        'T..........=....=....T',
        'T......f...======..f.T',
        'T..........=.........T',
        '======================',
        'T..........=.........T',
        'T..........=....~~~..T',
        'T..RRRR....=...~~~~~.T',
        'T..WdWW....=...~~~~~.T',
        'T...=......=....~~~..T',
        'T...========..f......T',
        'T.f........=.........T',
        'TTTTTTTTTTT=TTTTTTTTTT'
      ],
      warps: [
        { x: 11, y: 15, to: 'plain', tx: 11, ty: 1, dir: 'down', area: 1 },
        { x: 0, y: 7, to: 'forest', tx: 22, ty: 9, dir: 'left', area: 2 },
        { x: 11, y: 0, to: 'cave', tx: 11, ty: 16, dir: 'up', area: 3 },
        { x: 21, y: 7, to: 'castle', tx: 1, ty: 9, dir: 'right', area: 4 }
      ],
      npcs: [
        { id: 'elder', sp: 'elder', x: 13, y: 8, name: '村長' },
        { id: 'shop', sp: 'shop', x: 18, y: 4, name: 'お店の人' },
        { id: 'inn', sp: 'inn', x: 5, y: 12, name: '宿屋の人' },
        { id: 'review', sp: 'teacher', x: 8, y: 6, name: '王先生' },
        { id: 'kid', sp: 'kid', x: 6, y: 3, name: '村の子ども' }
      ],
      signs: [{ x: 10, y: 6, text: '↓ あいさつ草原　← くらしの森\n↑ うごきの洞窟　→ わすれんぼう城' }],
      chests: []
    },
    plain: {
      name: 'あいさつ草原', style: 'plain', area: 1,
      rows: [
        'TTTTTTTTTTT=TTTTTTTTTTTT',
        'T....,,,...=.....f.....T',
        'T...,,,,,..=..,,,,.....T',
        'T....,,,...=.,,,,,,..f.T',
        'T.f........=..,,,,.....T',
        'T......=====...........T',
        'T......=.....~~~~..,,,.T',
        'T.,,,..=....~~~~~.,,,,,T',
        'T,,,,,.=.....~~~..,,,,.T',
        'T.,,,..=...............T',
        'T......==========......T',
        'T..TT...........=..f...T',
        'T..TT..,,,,,....=......T',
        'T.....,,,,,,,...=..,,,.T',
        'T.f....,,,,,....=.,,,,.T',
        'T...............=......T',
        'T...............=......T',
        'TTTTTTTTTTTTTTTTTTTTTTTT'
      ],
      warps: [{ x: 11, y: 0, to: 'village', tx: 11, ty: 14, dir: 'up' }],
      npcs: [{ id: 'teacher', sp: 'teacher', x: 9, y: 2, name: '李先生' }],
      boss: { x: 16, y: 16 },
      signs: [{ x: 13, y: 4, text: 'この草原のボスは、えらんだことばを全部見つけると現れる。\n草むらを歩くとモンスターが出るぞ！' }],
      chests: [{ id: 'p1', x: 2, y: 15, gold: 20 }, { id: 'p2', x: 22, y: 1, item: 'herb', n: 2 }]
    },
    forest: {
      name: 'くらしの森', style: 'forest', area: 2,
      rows: [
        'TTTTTTTTTTTTTTTTTTTTTTTT',
        'T,,,,TT....,,,,TT.....fT',
        'T,,,,TT..f.,,,,TT......T',
        'T......=========....,,,T',
        'TTT....=.....TT.....,,,T',
        'T,,,...=..,,,TT..TTT...T',
        'T,,,...=..,,,....TTT...T',
        'T......=.........,,,...T',
        'T..TT..=....TT...,,,...T',
        'T..TT..===============.=',
        'T......=....TT.......,,T',
        'T,,,,..=....TT..,,,,.,,T',
        'T,,,,..=........,,,,...T',
        'T......=..~~~~.........T',
        'TT.....=..~~~~...TT.f..T',
        'T..f...=.........TT....T',
        'T...====...,,,,,.......T',
        'TTTTTTTTTTTTTTTTTTTTTTTT'
      ],
      warps: [{ x: 23, y: 9, to: 'village', tx: 1, ty: 7, dir: 'right' }],
      npcs: [{ id: 'teacher', sp: 'teacher', x: 20, y: 8, name: '张先生' }],
      boss: { x: 3, y: 16 },
      signs: [{ x: 21, y: 10, text: 'くらしの森のボスは、えらんだことばが全部★1以上になると現れる。' }],
      chests: [{ id: 'f1', x: 22, y: 1, gold: 40 }, { id: 'f2', x: 1, y: 13, item: 'ink', n: 2 }, { id: 'f3', x: 10, y: 2, gear: 'cloth' }]
    },
    cave: {
      name: 'うごきの洞窟', style: 'cave', area: 3,
      rows: [
        'TTTTTTTTTTTTTTTTTTTTTTTT',
        'T.....TTTT.....TTT.....T',
        'T.,,,.TTTT.,,,.TTT.,,,.T',
        'T.,,,........,.....,,,.T',
        'T.,,,.TTTT...,.TTT.....T',
        'T.....TTTT.....TTT..~~.T',
        'TTT.TTTTTTT.TTTTTT..~~.T',
        'T,,,.......=........,,.T',
        'T,,,..TTT..=..TTTT.,,,.T',
        'T.....TTT..=..TTTT.....T',
        'TTTT.TTTT..=..TTTTT.TTTT',
        'T.........,=,.........,T',
        'T.,,,,.....=......,,,,.T',
        'T.,,,,..TT.=.TT...,,,,.T',
        'T.......TT.=.TT........T',
        'TTTTTTT....=....TTTTTTTT',
        'TTTTTTT....=....TTTTTTTT',
        'TTTTTTTTTTT=TTTTTTTTTTTT'
      ],
      warps: [{ x: 11, y: 17, to: 'village', tx: 11, ty: 1, dir: 'down' }],
      npcs: [{ id: 'teacher', sp: 'teacher', x: 9, y: 15, name: '刘先生' }],
      boss: { x: 12, y: 1 },
      signs: [{ x: 13, y: 15, text: 'うごきの洞窟のボスは、えらんだことばが全部★2以上になると現れる。' }],
      chests: [{ id: 'c1', x: 1, y: 1, gold: 70 }, { id: 'c2', x: 22, y: 13, item: 'tea', n: 2 }, { id: 'c3', x: 22, y: 1, gear: 'vest' }]
    },
    castle: {
      name: 'わすれんぼう城', style: 'castle', area: 4,
      rows: [
        'TTTTTTTTTTTTTTTTTTTTTTTT',
        'T......................T',
        'T.,,,,,,...TT...,,,,,,.T',
        'T.,,,,,,...TT...,,,,,,.T',
        'T..........==..........T',
        'TTTTT..TTTT==TTTT..TTTTT',
        'T,,,,..T...==...T..,,,,T',
        'T,,,,..T...==...T..,,,,T',
        'T......T...==...T......T',
        '=======================T',
        'T......T........T......T',
        'T,,,,..T..~~~~..T..,,,,T',
        'T,,,,..T..~~~~..T..,,,,T',
        'T......TTTT..TTTT......T',
        'T..,,,,.........,,,,...T',
        'T..,,,,.........,,,,...T',
        'T......................T',
        'TTTTTTTTTTTTTTTTTTTTTTTT'
      ],
      warps: [{ x: 0, y: 9, to: 'village', tx: 20, ty: 7, dir: 'left' }],
      npcs: [{ id: 'teacher', sp: 'teacher', x: 3, y: 10, name: '陈先生' }],
      boss: { x: 11, y: 1 },
      signs: [{ x: 5, y: 8, text: 'わすれんぼう城の大王は、えらんだことばが全部★3になると現れる。' }],
      chests: [{ id: 'k1', x: 22, y: 16, gold: 120 }, { id: 'k2', x: 1, y: 16, item: 'tea', n: 3 }, { id: 'k3', x: 22, y: 1, gear: 'jade' }]
    }
  };

  var TALK = {
    elder: [
      zh('你好！', 'Nǐ hǎo!', 'こんにちは！'),
      { text: 'わしはこの村の村長じゃ。\nわすれんぼう大王が、村のことばを ぜんぶ持っていってしまった……。' },
      { text: '草原・森・洞窟・城の4つの場所に、ことばのモンスターがあふれておる。\nおぬしがえらんだことばで戦い、何度もくりかえして自分のものにするのじゃ！' },
      { text: 'ボスは、えらんだことばをじゅうぶん覚えるまで現れん。\n草原は「全部見つける」、森は「全部★1」、洞窟は「全部★2」、城は「全部★3」じゃ。' },
      { text: 'ことばは王先生のところで、いつでもえらびなおせるぞ。\nこまったら、各地にいる先生に教わるといい。' }
    ],
    kid: [zh('我喜欢猫！你喜欢什么？', 'Wǒ xǐhuan māo! Nǐ xǐhuan shénme?', 'ぼくはネコが好き！きみは何が好き？')],
    shop: [zh('你好！你想买什么？', 'Nǐ hǎo! Nǐ xiǎng mǎi shénme?', 'いらっしゃい！何を買いたい？')],
    inn: [zh('你想睡觉吗？', 'Nǐ xiǎng shuìjiào ma?', '泊まっていきますか？（5G でHP・MP全回復）')],
    review: [zh('我是王老师。我们学习汉语！', 'Wǒ shì Wáng lǎoshī. Wǒmen xuéxí Hànyǔ!', '王先生です。中国語を勉強しましょう！'),
      { text: 'えらんだことばの中で★が少ないことばを10問ふくしゅうできます（ダメージなし・正解ごとにEXP）。\nHSKの級や、勉強することばのえらびなおしもできます。' }],
    teacher: [zh('我是老师。我们学习汉语！', 'Wǒ shì lǎoshī. Wǒmen xuéxí Hànyǔ!', '先生です。中国語を勉強しましょう！'),
      { text: 'えらんだことばの中で、まだ見つけていないことばを5つずつ教えましょう。\n教わったことばは2回ずつ練習します（ダメージなし）。' }],
    locked: [zh('对不起，你不能去。', 'Duìbuqǐ, nǐ bù néng qù.', 'ごめんね、まだ行けないよ。')]
  };

  g.World = { MAPS: MAPS, AREAS: AREAS, ITEMS: ITEMS, GEAR: GEAR, TALK: TALK, zh: zh,
    SHOP: ['herb', 'tea', 'ink', 'brush', 'cloth', 'pen', 'vest', 'jade', 'robe'] };
})(typeof window !== 'undefined' ? window : globalThis);
