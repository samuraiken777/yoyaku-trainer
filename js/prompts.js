// 各処理のプロンプトと、structured outputs 用の JSON スキーマ。
//
// スキーマの制約（Anthropic の structured outputs）:
//   - すべての object に additionalProperties: false と required が必要
//   - minItems / maxItems / minimum / maximum / minLength は未対応
//     → 個数や範囲の指示は description とプロンプト本文で伝える

/** 観点の5分類。rubric項目・スコア表示・履歴グラフで共通に使う。 */
export const ASPECTS = {
  coverage:   '要点網羅',
  extraneous: '不要要素の混入',
  logic:      '論理関係の保持',
  length:     '字数遵守',
  expression: '日本語表現',
};

/* ══════════════════════════════════════════
   Stage A ── 問題分析（1問につき1回だけ）
   ══════════════════════════════════════════ */

export const ANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '本文の内容を表す15字以内の見出し' },
    theme: { type: 'string', description: 'この文章のテーマを一言で' },
    recommendedChars: { type: 'integer', description: '指定字数。指定がない場合は本文量に応じて適切な字数' },
    modelAnswer: { type: 'string', description: '指定字数ちょうどの模範解答' },
    rubric: {
      type: 'array',
      description: '採点項目。4〜8個。それぞれ独立に○×判定できる粒度にする',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'r1, r2, ... の形式' },
          content: { type: 'string', description: '解答に含まれているべき内容。30字程度で具体的に' },
          weight: { type: 'integer', description: '配点。全項目の合計が100になるようにする' },
          essential: { type: 'boolean', description: 'これを外すと要約として成立しない必須項目なら true' },
          evidence: { type: 'string', description: '本文中の根拠箇所。原文から一字一句そのまま20〜60字で抜き出す' },
          aspect: {
            type: 'string',
            enum: ['coverage', 'extraneous', 'logic', 'expression'],
            description: 'この項目が主に問う観点',
          },
        },
        required: ['id', 'content', 'weight', 'essential', 'evidence', 'aspect'],
        additionalProperties: false,
      },
    },
    logicPoints: {
      type: 'array',
      description: '要約で保持すべき論理関係。1〜3個',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['対比', '因果', '譲歩', '条件', '例示', '定義'] },
          description: { type: 'string', description: '何と何がその関係にあるか' },
        },
        required: ['kind', 'description'],
        additionalProperties: false,
      },
    },
    pitfalls: {
      type: 'array',
      description: '高校生がやりがちな失敗。2〜4個。「具体例の◯◯を書いてしまう」など具体的に',
      items: { type: 'string' },
    },
  },
  required: ['title', 'theme', 'recommendedChars', 'modelAnswer', 'rubric', 'logicPoints', 'pitfalls'],
  additionalProperties: false,
};

const ANALYZE_SYSTEM = `あなたは高校国語（現代文）を長年教えてきた講師です。大学入学共通テストおよび私立大学レベルの要約問題を設計し、採点基準を作ります。

採点基準を作るときの原則:
- 各項目は「書けているか / 書けていないか」を採点者によらず同じように判定できる粒度で書く。「筆者の主張を正しく捉えている」のような、判定が人によってぶれる項目は作らない。
- 本文の具体例そのものではなく、具体例が支えている一般論のほうを採点項目にする。
- 根拠(evidence)は必ず本文から一字一句そのまま抜き出す。要約・言い換えをしない。
- 配点(weight)の合計はちょうど100にする。

模範解答の字数（厳守）:
- 指定字数を**1字でも超えてはいけない**。実際の入試で字数超過は無条件に減点されるため、これを守れない模範解答は使えません。
- 指定字数の85〜100%に収める。短すぎるのも要点不足なので、下限も意識する。
- 句読点・かぎかっこ・記号もそれぞれ1字に数える。改行と空白は数えない。
- 書き終えたら必ず先頭から1字ずつ数え直す。超えていたら、要点は残したまま冗長な修飾や重複を削って、字数内に収めてから出力する。

出力は簡潔に。説明を書き足さず、スキーマの各項目を埋めることに徹してください。`;

export function analyzeMessages(text, targetChars) {
  const spec = targetChars > 0
    ? `${targetChars}字以内（超過は不可。${Math.round(targetChars * 0.85)}〜${targetChars}字に収めること）`
    : '指定なし。本文の分量に見合った字数をあなたが決めてください（80〜200字の範囲）。決めた字数を recommendedChars に入れ、模範解答はその字数を超えないようにすること。';

  return {
    system: ANALYZE_SYSTEM,
    messages: [{
      role: 'user',
      content: `次の文章を要約問題として使います。模範解答と採点基準を作ってください。

【指定字数】${spec}

【本文】
${text}`,
    }],
  };
}

/* ══════════════════════════════════════════
   Stage B ── 採点・添削
   ══════════════════════════════════════════ */

export const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    itemResults: {
      type: 'array',
      description: '採点基準の各項目に対する判定。採点基準と同じ数・同じ順序・同じidで返す',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          judgement: { type: 'string', enum: ['hit', 'partial', 'miss'] },
          comment: { type: 'string', description: '40字以内。partial/miss のときは何が足りないかを具体的に' },
        },
        required: ['id', 'judgement', 'comment'],
        additionalProperties: false,
      },
    },
    expressionNotes: {
      type: 'array',
      description: '日本語表現の指摘。0〜5個。些細なものは挙げない',
      items: {
        type: 'object',
        properties: {
          quote: {
            type: 'string',
            description: '解答文中に一字一句そのまま存在する文字列。前後を省略したり言い換えたりしない',
          },
          issue: { type: 'string', description: '何が問題か。30字以内' },
          suggestion: { type: 'string', description: 'こう直すという具体案' },
        },
        required: ['quote', 'issue', 'suggestion'],
        additionalProperties: false,
      },
    },
    goodPoints: { type: 'array', description: 'できていた点。2個', items: { type: 'string' } },
    improvePoints: { type: 'array', description: '次に直すべき点。2個', items: { type: 'string' } },
    revisedAnswer: {
      type: 'string',
      description: '生徒の解答を土台に最小限の手直しで直した改善例。指定字数を超えてはいけない。模範解答の書き写しにはしない',
    },
    quoteComment: {
      type: 'string',
      description: '本文からの引用の使い方についての所見。問題なければその旨を一言',
    },
    aspectScores: {
      type: 'object',
      properties: {
        coverage:   { type: 'integer', description: '要点網羅 0〜100' },
        extraneous: { type: 'integer', description: '不要要素を排除できているか 0〜100' },
        logic:      { type: 'integer', description: '論理関係の保持 0〜100' },
        length:     { type: 'integer', description: '字数遵守 0〜100' },
        expression: { type: 'integer', description: '日本語表現 0〜100' },
      },
      required: ['coverage', 'extraneous', 'logic', 'length', 'expression'],
      additionalProperties: false,
    },
    totalScore: { type: 'integer', description: '100点満点の総合点。採点項目の配点と減点を踏まえて算出' },
  },
  required: ['itemResults', 'expressionNotes', 'goodPoints', 'improvePoints',
             'revisedAnswer', 'quoteComment', 'aspectScores', 'totalScore'],
  additionalProperties: false,
};

const GRADE_SYSTEM = `あなたは高校国語（現代文）のベテラン指導者です。高校3年生（共通テスト・私大志望）が書いた要約解答を、与えられた採点基準に従って添削します。

採点の原則:
- 判定は必ず与えられた採点基準の項目に沿って行う。基準にないことを持ち出して減点しない。
- 表現が模範解答と違っていても、内容が採点項目を満たしていれば hit とする。言い回しの違いで減点しない。
- 字数と本文引用の実測値はこちらで計算済みの数値を渡します。自分で数え直さず、渡された数値をそのまま使ってください。
- 本文の語句をある程度使うのは要約では正常です。文がまるごと写されている場合のみ問題として扱ってください。

書き方:
- 相手は17〜18歳です。中高生に伝わる言葉で書き、専門用語を使うときは短く補足する。
- できている点は具体的に指摘して認める。「よく書けています」だけで終わらせない。
- 直すべき点は「どこを・どう直すか」まで書く。抽象的な助言で終わらせない。
- 各コメントは簡潔に。文字数指定のある項目はそれを守る。

expressionNotes の quote は、解答文をハイライト表示するために使います。**解答文中に一字一句そのまま存在する文字列**にしてください。省略記号を入れたり、言い換えたり、句読点を足したりすると表示できません。

revisedAnswer（直した例）の作り方:
- 生徒の書いた文をできるだけ活かす。全部書き換えず、直すべきところだけを直す。生徒が「自分の解答がどう変わったか」を見比べられることが目的です。
- **指定字数を1字でも超えてはいけない**。指定字数の85〜100%に収める。句読点も1字に数え、改行と空白は数えない。
- 字数が足りなくて要点が入らないなら、生徒が書いた不要な部分（具体例など）を削って場所を作る。
- 書き終えたら先頭から1字ずつ数え直し、超えていたら削ってから出力する。`;

export function gradeMessages({ source, analysis, answer, charCount, targetChars, copiedSpans }) {
  const rubricText = analysis.rubric
    .map((r) => `- [${r.id}] (${r.weight}点${r.essential ? '・必須' : ''}) ${r.content}\n    根拠: 「${r.evidence}」`)
    .join('\n');

  const logicText = analysis.logicPoints
    .map((l) => `- ${l.kind}: ${l.description}`)
    .join('\n');

  const copyText = copiedSpans.length
    ? copiedSpans.map((s) => `「${s.text}」（${s.text.length}字）`).join('、')
    : 'なし（20字以上の連続一致は検出されませんでした）';

  const diff = charCount - targetChars;
  const lengthText = `${charCount}字（指定 ${targetChars}字 / ${diff === 0 ? 'ちょうど' : diff > 0 ? `${diff}字オーバー` : `${-diff}字不足`}）`;

  return {
    system: GRADE_SYSTEM,
    messages: [{
      role: 'user',
      content: `次の要約解答を添削してください。

═══ 本文 ═══
${source}

═══ 採点基準 ═══
${rubricText}

保持すべき論理関係:
${logicText}

模範解答（参考。これと表現が違っても内容が合っていれば正解）:
${analysis.modelAnswer}

═══ 生徒の解答 ═══
${answer}

═══ 実測値（計算済み。数え直さないこと） ═══
字数: ${lengthText}
本文と20字以上連続一致した箇所: ${copyText}`,
    }],
  };
}

/* ══════════════════════════════════════════
   字数の詰め直し ── 超過分を圧縮させる
   ══════════════════════════════════════════ */

export const FIT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '指定字数以内に収めた文章' },
  },
  required: ['text'],
  additionalProperties: false,
};

const FIT_SYSTEM = `要約文を指定字数以内に圧縮する作業をします。

- 内容の要点は絶対に落とさない。削るのは冗長な言い回し、重複した説明、なくても意味が通る修飾語だけ。
- 文体・語調は元のまま保つ。
- 句読点も1字に数える。改行と空白は数えない。
- 書き終えたら先頭から1字ずつ数え直し、指定字数以内であることを確認してから出力する。

圧縮後の文章だけを返してください。説明は不要です。`;

export function fitMessages({ text, target, kind }) {
  const extra = kind === 'revised'
    ? '\n※これは生徒の解答を添削した文です。生徒自身の書き方をできるだけ残したまま圧縮してください。'
    : '';

  return {
    system: FIT_SYSTEM,
    messages: [{
      role: 'user',
      content: `次の文章を ${target}字以内（${Math.round(target * 0.85)}〜${target}字が理想）に収めてください。${extra}

【文章】
${text}`,
    }],
  };
}

/* ══════════════════════════════════════════
   問題文の生成 ── オリジナルの評論文を書かせる
   ══════════════════════════════════════════ */

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '本文の内容を表す15字以内の見出し' },
    theme: { type: 'string', description: 'この文章のテーマを一言で' },
    text: { type: 'string', description: '本文。段落は改行で区切る' },
  },
  required: ['title', 'theme', 'text'],
  additionalProperties: false,
};

const LEVEL_SPEC = {
  common: '大学入学共通テストの現代文（評論）程度。論理関係は接続語で明示し、抽象語には文中で説明を添える。',
  private: '中堅〜上位私大の現代文（評論）程度。標準的な抽象度で、対比が一組はっきり通っている。',
  hard: '難関私大・国公立二次の現代文（評論）程度。抽象度が高く、対比や譲歩が入り組んでいてよい。ただし悪文にはしない。',
};

const GENERATE_SYSTEM = `あなたは高校国語の教材を書く執筆者です。要約問題の練習用に、オリジナルの評論文を書きます。

必ず守ること:
- 完全なオリジナルの文章を書く。既存の書籍・論文・入試問題の文章を再現しない。
- 要約問題として成立する骨格を持たせる。すなわち「一般に言われていること → それに対する筆者の主張 → 根拠 → 具体例 → 結論」のように、中心的な主張と、それを支える論理関係がはっきりある構成にする。
- 対比（AではなくB、かつてと現在、など）を最低ひとつ通す。要約でそこを落とすと減点になるような骨格にする。
- 具体例をひとつ入れる。要約の際には切り捨てるべき部分として機能させる（具体例そのものが主張になってはいけない）。
- 段落は3〜5つ。各段落の役割が異なるようにする。
- 高校生が読んで意味の取れる語彙で書く。難解な語を使うときは文中で意味が分かるようにする。
- 事実として検証が必要な統計や固有名詞は使わない（架空の数値を本当らしく書かない）。

本文だけを書き、設問・解説・注釈は付けないでください。`;

export function generateMessages({ theme, level, length }) {
  const themeSpec = theme
    ? `「${theme}」に関連するテーマ`
    : '言語・技術と社会・都市と共同体・自然観・時間感覚・身体・記憶と歴史 などから、要約問題に向くものをひとつ選ぶ';

  return {
    system: GENERATE_SYSTEM,
    messages: [{
      role: 'user',
      content: `要約問題の練習用に評論文を1本書いてください。

【テーマ】${themeSpec}
【難易度】${LEVEL_SPEC[level] || LEVEL_SPEC.private}
【分量】${length}字程度（±15%以内）`,
    }],
  };
}

/* ══════════════════════════════════════════
   OCR ── 手書き解答の読み取り
   ══════════════════════════════════════════ */

export const OCR_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '読み取った解答本文。改行は保持する' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    uncertain: {
      type: 'array',
      description: '読み取りに自信がない箇所の文字や語。なければ空配列',
      items: { type: 'string' },
    },
  },
  required: ['text', 'confidence', 'uncertain'],
  additionalProperties: false,
};

const OCR_SYSTEM = `手書きの日本語の解答用紙を、書かれているとおりに文字に起こしてください。

- 誤字・脱字・文法の誤りがあっても直さず、書かれているままに起こす。採点は別の工程で行います。
- 推測で言葉を補わない。読めない文字は □ で表す。
- 原稿用紙のマス目や罫線、問題番号、名前欄は本文に含めない。
- 訂正線で消された箇所は起こさない。`;

export function ocrMessages(base64Jpeg) {
  return {
    system: OCR_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
        { type: 'text', text: 'この解答用紙に書かれている文章を起こしてください。' },
      ],
    }],
  };
}
