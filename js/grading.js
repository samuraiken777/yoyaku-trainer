// LLM に任せず JS 側で決定的に計算する部分。
// 字数と本文引用は「毎回同じ答えが出る」ことが重要なので、モデルには数えさせない。

/**
 * 入試の慣例に合わせた字数カウント。
 * 句読点・記号は1字、空白と改行は数えない。
 * （JSの \s は全角スペース U+3000 も含む）
 */
export function countChars(text) {
  return (text || '').replace(/\s/g, '').length;
}

/** 指定字数に対する判定。±10% を許容範囲とする。 */
export function charStatus(count, target) {
  if (!target) return 'ok';
  const tolerance = Math.max(3, Math.round(target * 0.1));
  if (count > target + tolerance) return 'over';
  if (count < target - tolerance) return 'under';
  return 'ok';
}

/** 空白を除いた文字列と、元の文字列への添字対応表を作る。 */
function normalizeWithMap(s) {
  let norm = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    norm += s[i];
    map.push(i);
  }
  return { norm, map };
}

/**
 * 解答が本文から連続して写している箇所を探す。
 * 要約で本文の語句を使うこと自体は正常なので、減点はここでは行わず、
 * ハイライト表示と採点AIへの判断材料としてのみ使う。
 *
 * @returns [{ start, end, text }] — start/end は元の answer 文字列での添字
 */
export function findCopiedSpans(source, answer, minLen = 20) {
  const src = normalizeWithMap(source).norm;
  const { norm: ans, map } = normalizeWithMap(answer);
  const spans = [];

  let i = 0;
  while (i < ans.length) {
    // i から始まる最長の一致を貪欲に伸ばす
    let len = 0;
    while (i + len < ans.length && src.includes(ans.slice(i, i + len + 1))) len++;

    if (len >= minLen) {
      const start = map[i];
      const end = map[i + len - 1] + 1;
      spans.push({ start, end, text: answer.slice(start, end) });
      i += len;
    } else {
      i++;
    }
  }
  return spans;
}

/** 解答全体のうち、本文からの連続写しが占める割合（0〜1）。 */
export function copyRatio(answer, spans) {
  const total = countChars(answer);
  if (!total) return 0;
  const copied = spans.reduce((sum, s) => sum + countChars(s.text), 0);
  return copied / total;
}

/* ────────────── 書き直し例との差分 ────────────── */

/** 変更のかたまりの中で、削除をまとめて先に、追加をまとめて後に並べ替える。 */
function groupChanges(ops) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { out.push(ops[i]); i++; continue; }
    let del = '';
    let ins = '';
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') del += ops[i].text;
      else ins += ops[i].text;
      i++;
    }
    if (del) out.push({ type: 'delete', text: del });
    if (ins) out.push({ type: 'insert', text: ins });
  }
  return out;
}

/**
 * 1文字単位の差分（最長共通部分列ベース）。
 * 日本語は語の切れ目がないので文字単位で取る。
 * @returns [{ type: 'equal'|'delete'|'insert', text }]
 */
export function diffChars(a, b) {
  a = a || '';
  b = b || '';
  const n = a.length;
  const m = b.length;

  // 解答が異常に長い場合は総当たりを避けて丸ごと置換として扱う
  if (n > 2000 || m > 2000) {
    return [{ type: 'delete', text: a }, { type: 'insert', text: b }];
  }

  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + (j + 1)] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const ops = [];
  const push = (type, ch) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += ch;
    else ops.push({ type, text: ch });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('equal', a[i]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) { push('delete', a[i]); i++; }
    else { push('insert', b[j]); j++; }
  }
  while (i < n) { push('delete', a[i]); i++; }
  while (j < m) { push('insert', b[j]); j++; }

  return groupChanges(ops);
}

/** 0〜100 に丸める。 */
export function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}
