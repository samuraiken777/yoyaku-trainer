// 添削結果と履歴の描画。

import { ASPECTS } from './prompts.js';
import { clampScore, charStatus, countChars, diffChars } from './grading.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ────────────── ハイライト ────────────── */

/** 空白の違いを無視して needle の位置を探す。見つからなければ null。 */
function looseFind(haystack, needle) {
  if (!needle) return null;

  const exact = haystack.indexOf(needle);
  if (exact >= 0) return [exact, exact + needle.length];

  // 空白を落として突き合わせ、元の添字に戻す
  let norm = '';
  const map = [];
  for (let i = 0; i < haystack.length; i++) {
    if (/\s/.test(haystack[i])) continue;
    norm += haystack[i];
    map.push(i);
  }
  const target = needle.replace(/\s/g, '');
  const at = norm.indexOf(target);
  if (at < 0) return null;
  return [map[at], map[at + target.length - 1] + 1];
}

/**
 * 文字ごとにクラスを割り当ててから連続する区間をまとめて <mark> にする。
 * 範囲が重なっても壊れないようにするための方式。
 */
function markUp(text, ranges) {
  const classes = new Array(text.length).fill(null);
  for (const { start, end, cls } of ranges) {
    for (let i = Math.max(0, start); i < Math.min(text.length, end); i++) {
      classes[i] = cls; // 後から指定したものが優先
    }
  }

  let html = '';
  let i = 0;
  while (i < text.length) {
    const cls = classes[i];
    let j = i;
    while (j < text.length && classes[j] === cls) j++;
    const chunk = esc(text.slice(i, j));
    html += cls ? `<mark class="${cls}">${chunk}</mark>` : chunk;
    i = j;
  }
  return html;
}

export function highlightAnswer(answer, copiedSpans = [], expressionNotes = []) {
  const ranges = [];

  for (const s of copiedSpans) {
    ranges.push({ start: s.start, end: s.end, cls: 'copy' });
  }
  // 表現の指摘のほうを上に重ねる
  for (const n of expressionNotes) {
    const pos = looseFind(answer, n.quote);
    if (pos) ranges.push({ start: pos[0], end: pos[1], cls: 'note' });
  }

  return markUp(answer, ranges);
}

/** 演習中に本人が引いたマーカーを反映した本文HTML。 */
export function renderUserHighlights(text, ranges = []) {
  return markUp(text, ranges.map((r) => ({ start: r.start, end: r.end, cls: 'user-hl' })));
}

export function highlightSource(source, rubric = [], userRanges = []) {
  const ranges = userRanges.map((r) => ({ start: r.start, end: r.end, cls: 'user-hl' }));
  for (const r of rubric) {
    const pos = looseFind(source, r.evidence);
    if (pos) ranges.push({ start: pos[0], end: pos[1], cls: 'evidence' });
  }
  return markUp(source, ranges);
}

/** 元の解答 → 直した例 の差分HTML。削った所は取り消し線、足した所は下線。 */
export function renderDiff(before, after) {
  return diffChars(before, after).map((op) => {
    const t = esc(op.text);
    if (op.type === 'delete') return `<del>${t}</del>`;
    if (op.type === 'insert') return `<ins>${t}</ins>`;
    return t;
  }).join('');
}

/** 「128字 / 指定 120字（8字オーバー）」のような見出しを作る。 */
export function charTag(text, target) {
  const n = countChars(text);
  if (!target) return `${n}字`;
  const d = n - target;
  const diff = d === 0 ? 'ちょうど' : d > 0 ? `${d}字オーバー` : `${-d}字不足`;
  return `${n}字 / 指定 ${target}字（${diff}）`;
}

/* ────────────── 添削結果 ────────────── */

export const MARK = { hit: ['○', 'hit'], partial: ['△', 'partial'], miss: ['×', 'miss'] };

export function renderResult(problem, attempt) {
  const r = attempt.result;
  const target = problem.targetChars;
  const status = charStatus(attempt.charCount, target);
  const statusLabel = { ok: '許容範囲内', over: '字数オーバー', under: '字数不足' }[status];

  const rubricById = Object.fromEntries(problem.analysis.rubric.map((x) => [x.id, x]));

  const aspectsHtml = Object.entries(ASPECTS).map(([key, label]) => {
    const v = clampScore(r.aspectScores?.[key]);
    return `<div class="aspect">
      <span>${label}</span>
      <span class="bar"><i style="width:${v}%"></i></span>
      <span class="muted">${v}</span>
    </div>`;
  }).join('');

  const rubricHtml = (r.itemResults || []).map((item) => {
    const def = rubricById[item.id];
    if (!def) return '';
    const [glyph, cls] = MARK[item.judgement] || MARK.miss;
    return `<li class="rubric-item">
      <span class="mark ${cls}">${glyph}</span>
      <div>
        <div class="content">${esc(def.content)}
          <span class="tag">${ASPECTS[def.aspect] || ''}・${def.weight}点${def.essential ? '・必須' : ''}</span>
        </div>
        <div class="comment">${esc(item.comment)}</div>
      </div>
    </li>`;
  }).join('');

  const notesHtml = (r.expressionNotes || []).length
    ? `<h2>表現の指摘</h2>
       <ul class="note-list">${r.expressionNotes.map((n) => `
         <li>
           <div class="quote">「${esc(n.quote)}」</div>
           <div class="muted small">${esc(n.issue)}</div>
           <div class="fix">→ ${esc(n.suggestion)}</div>
         </li>`).join('')}</ul>`
    : '';

  return `
  <div class="score-head">
    <div class="score-num">${clampScore(r.totalScore)}<small> / 100</small></div>
    <div>
      <div><strong>${attempt.charCount}字</strong>${target ? ` / 指定 ${target}字（${statusLabel}）` : ''}</div>
      <div class="muted small">${new Date(attempt.createdAt).toLocaleString('ja-JP')}${attempt.inputMethod === 'photo' ? '・手書きを撮影' : ''}</div>
    </div>
  </div>

  <div class="aspects">${aspectsHtml}</div>

  <h2>採点項目</h2>
  <ul class="rubric-list">${rubricHtml}</ul>

  <h2>あなたの解答</h2>
  <div class="answer-render">${highlightAnswer(attempt.answer, attempt.copiedSpans, r.expressionNotes)}</div>
  <div class="legend">
    <span><i style="background:var(--note-hl)"></i>表現の指摘</span>
    <span><i style="background:var(--copy-hl)"></i>本文から20字以上の連続一致</span>
  </div>
  <p class="note">${esc(r.quoteComment)}</p>

  ${notesHtml}

  <h2>総評</h2>
  <div class="good-bad">
    <div class="g">
      <h3>できていた点</h3>
      <ul>${(r.goodPoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>
    <div class="b">
      <h3>次に直すこと</h3>
      <ul>${(r.improvePoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </div>
  </div>

  <details class="reveal">
    <summary>あなたの解答を直した例を見る</summary>
    <div class="body">
      <div class="char-tag">${charTag(r.revisedAnswer, target)}　<span class="was">（もとの解答は ${countChars(attempt.answer)}字）</span></div>
      <div class="sub-label">どこを直したか</div>
      <div class="diff-view">${renderDiff(attempt.answer, r.revisedAnswer)}</div>
      <div class="diff-legend">
        <span><del>取り消し線</del>＝削ったところ</span>
        <span><ins>下線</ins>＝足したところ</span>
      </div>
      <div class="sub-label">直したあとの文章</div>
      <div class="plain">${esc(r.revisedAnswer)}</div>
    </div>
  </details>

  <details class="reveal">
    <summary>模範解答を見る</summary>
    <div class="body">
      <div class="char-tag">${charTag(problem.analysis.modelAnswer, target)}</div>
      ${esc(problem.analysis.modelAnswer)}
    </div>
  </details>

  <details class="reveal">
    <summary>本文を見る（採点項目の根拠をハイライト）</summary>
    <div class="body">${highlightSource(problem.text, problem.analysis.rubric)}</div>
  </details>

  <details class="reveal">
    <summary>この問題で気をつけるところ</summary>
    <div class="body">${(problem.analysis.pitfalls || []).map((p) => `・${esc(p)}`).join('\n')}</div>
  </details>
  `;
}

/* ────────────── 履歴 ────────────── */

function sparkline(values) {
  if (values.length < 2) return '';
  const W = 320, H = 90, PAD = 6;
  const step = (W - PAD * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = PAD + i * step;
    const y = H - PAD - (clampScore(v) / 100) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="110" role="img" aria-label="総合点の推移">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.join(' ')}"/>
    ${pts.map((p) => {
      const [x, y] = p.split(',');
      return `<circle cx="${x}" cy="${y}" r="3" fill="var(--accent)"/>`;
    }).join('')}
  </svg>`;
}

export function renderHistory(attempts, problemsById) {
  if (!attempts.length) {
    return '<p class="empty">まだ採点した記録がありません。</p>';
  }

  const chrono = [...attempts].reverse(); // 古い順
  const scores = chrono.map((a) => a.result.totalScore);

  const recent = chrono.slice(-5);
  const avg = {};
  for (const key of Object.keys(ASPECTS)) {
    const vals = recent.map((a) => clampScore(a.result.aspectScores?.[key]));
    avg[key] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  const weakest = Object.entries(avg).sort((a, b) => a[1] - b[1])[0];

  const aspectsHtml = Object.entries(ASPECTS).map(([key, label]) => `
    <div class="aspect">
      <span>${label}</span>
      <span class="bar"><i style="width:${avg[key]}%"></i></span>
      <span class="muted">${avg[key]}</span>
    </div>`).join('');

  const rowsHtml = attempts.map((a) => {
    const p = problemsById[a.problemId];
    return `<div class="attempt-row">
      <span>${esc(p ? p.title : '（削除された問題）')}</span>
      <span class="muted">${new Date(a.createdAt).toLocaleDateString('ja-JP')}</span>
      <strong>${clampScore(a.result.totalScore)}点</strong>
    </div>`;
  }).join('');

  return `
    <h2>総合点の推移（${attempts.length}回）</h2>
    ${sparkline(scores) || '<p class="muted">2回以上解くとグラフが出ます。</p>'}

    <h2>観点別の平均（直近${recent.length}回）</h2>
    <div class="aspects">${aspectsHtml}</div>
    <p class="note">いま一番の課題は<strong>「${ASPECTS[weakest[0]]}」</strong>（平均${weakest[1]}点）です。</p>

    <h2>解いた記録</h2>
    <div>${rowsHtml}</div>
  `;
}
