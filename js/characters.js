// Summaringo の5人。
//
// それぞれの役割がアプリの機能と対応しているので、
// 「その子の仕事をしている場面」にだけ出す。むやみに散らさない。

export const CHARACTERS = {
  summaringo: {
    name: 'サマリンゴ',
    role: '総合ナビゲーター',
    line: '大事なところだけ、ギュッ！',
    img: 'img/summaringo.webp',
  },
  gyuttori: {
    name: 'ギュットリ',
    role: '重要語を集める',
    line: 'この一文、要る？ 要らない？',
    img: 'img/gyuttori.webp',
  },
  youyakun: {
    name: 'ヨウヤクン',
    role: '筆者の主張を発見',
    line: '主張の手がかりを探そう！',
    img: 'img/youyakun.webp',
  },
  kotobaku: {
    name: 'コトバク',
    role: '余分な表現を整理',
    line: 'もう一口、考えてみよう。',
    img: 'img/kotobaku.webp',
  },
  minimal: {
    name: 'ミニマル博士',
    role: '採点・詳しい解説',
    line: '短くするだけでは要約とは言えんぞ。',
    img: 'img/minimal.webp',
  },
};

/** 採点の5観点は、それぞれ担当キャラがいる。 */
export const ASPECT_CHAR = {
  coverage:   'gyuttori',   // 要点網羅        ← 重要語を集める
  extraneous: 'kotobaku',   // 不要要素の混入  ← 余分な表現を整理
  logic:      'youyakun',   // 論理関係の保持  ← 因果・対比の手がかり
  length:     'minimal',    // 字数遵守        ← 文字数チェック
  expression: 'summaringo', // 日本語表現      ← 整えて仕上げる
};

/** <img> 1個ぶんのHTML。alt は装飾用途では空にする。 */
export function avatar(key, cls = 'sm', { alt = null, lazy = true } = {}) {
  const c = CHARACTERS[key];
  if (!c) return '';
  return `<img class="char ${cls} char-${key}" src="${c.img}"`
    + ` alt="${alt === null ? '' : alt}"${lazy ? ' loading="lazy"' : ''}`
    + ` width="320" height="320">`;
}
