// 問題・解答・添削をひとつのレポートにまとめ、印刷（PDF保存）と
// HTMLファイルでの持ち出しができるようにする。
//
// PDFはブラウザの「印刷 → PDFとして保存」で作る。
// PDF生成ライブラリを積むと日本語フォントを数MB同梱することになり、
// スマホでの読み込みが重くなるうえ文字化けのリスクもあるため、
// 日本語が確実にきれいに出る印刷経由にしている。

import { ASPECTS } from './prompts.js';
import { countChars, clampScore } from './grading.js';
import { esc, charTag, highlightAnswer, highlightSource, renderDiff, MARK } from './render.js';

/* ────────────── レポート用スタイル ──────────────
   .rpt 配下に閉じてあるので、アプリ画面に混ぜても
   単体HTMLとして書き出しても同じ見た目になる。            */

const REPORT_CSS = `
.rpt {
  font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", system-ui, sans-serif;
  color: #000; background: #fff; line-height: 1.9;
  font-size: 10.5pt; max-width: 190mm; margin: 0 auto; padding: 8mm;
}
.rpt * { box-sizing: border-box; }
.rpt .doc-head { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 16px; }
.rpt .doc-head .app { font-size: 9pt; letter-spacing: .08em; }
.rpt h1 { font-size: 15pt; margin: 6px 0 4px; }
.rpt .doc-head .sub { font-size: 9pt; color: #444; }

.rpt h2 {
  font-size: 11pt; margin: 18px 0 8px; padding: 4px 8px;
  background: #eee; border-left: 4px solid #000;
}
.rpt .sec { break-inside: avoid; page-break-inside: avoid; }
.rpt .sec.long { break-inside: auto; page-break-inside: auto; }

.rpt .scorebox {
  display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap;
  border: 2px solid #000; padding: 10px 14px; margin-bottom: 6px;
}
.rpt .scorebox .num { font-size: 24pt; font-weight: 700; line-height: 1; }
.rpt .scorebox .num span { font-size: 10pt; font-weight: 400; }
.rpt .scorebox .len { font-size: 10pt; }

.rpt .aspects { margin: 10px 0 0; }
.rpt .aspects div { font-size: 9.5pt; }
.rpt .aspects .bars {
  font-family: "Courier New", monospace; letter-spacing: -1px;
}

.rpt .body-text {
  white-space: pre-wrap; border: 1px solid #999; padding: 10px 12px; line-height: 2.0;
}
.rpt .answer-text {
  white-space: pre-wrap; border: 1px solid #999; padding: 10px 12px; line-height: 2.2;
}
.rpt mark {
  background: none; color: #000;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rpt mark.note { background: #ffd9d5; border-bottom: 2px solid #b4362f; }
.rpt mark.copy { background: #fdf0c8; }
.rpt mark.user-hl { background: #ffec8a; }
.rpt mark.evidence { background: #dcecdd; }
.rpt .legend { font-size: 8.5pt; color: #444; margin-top: 5px; }

.rpt table.rubric { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.rpt table.rubric th, .rpt table.rubric td {
  border: 1px solid #999; padding: 5px 7px; vertical-align: top; text-align: left;
}
.rpt table.rubric th { background: #f0f0f0; font-weight: 600; white-space: nowrap; }
.rpt table.rubric td.mk { text-align: center; font-size: 12pt; font-weight: 700; width: 2.2em; }

.rpt ul { margin: 4px 0; padding-left: 1.3em; }
.rpt li { margin-bottom: 2px; }
.rpt .two-col { display: flex; gap: 18px; }
.rpt .two-col > div { flex: 1; }
.rpt .two-col h3 { font-size: 10pt; margin: 0 0 2px; }

.rpt .quoted { border-left: 3px solid #b4362f; padding: 2px 0 2px 9px; margin-bottom: 7px; font-size: 9.5pt; }
.rpt .quoted .q { font-weight: 600; }

.rpt .char-line { font-size: 9pt; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 6px; }
.rpt .boxed { border: 1px solid #999; padding: 10px 12px; white-space: pre-wrap; }
.rpt .sub-label { font-size: 9pt; font-weight: 700; margin: 9px 0 3px; }
.rpt .diff { border: 1px solid #999; padding: 10px 12px; white-space: pre-wrap; line-height: 2.2; }
.rpt del {
  background: #ffd9d5; text-decoration: line-through; text-decoration-color: #b4362f;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rpt ins {
  background: #dcecdd; text-decoration: underline; text-decoration-color: #2e7d52; font-weight: 600;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.rpt .foot { margin-top: 20px; padding-top: 6px; border-top: 1px solid #999; font-size: 8pt; color: #555; }
`;

// ページ内で印刷するときのために <style> を一度だけ差し込む
if (!document.getElementById('report-style')) {
  const st = document.createElement('style');
  st.id = 'report-style';
  st.textContent = REPORT_CSS;
  document.head.appendChild(st);
}

/* ────────────── 組み立て ────────────── */

function bars(value) {
  const v = clampScore(value);
  const filled = Math.round(v / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function stamp(ts) {
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function buildReportHtml(problem, attempt) {
  const r = attempt.result;
  const target = problem.targetChars;
  const rubricById = Object.fromEntries(problem.analysis.rubric.map((x) => [x.id, x]));

  const aspectRows = Object.entries(ASPECTS).map(([key, label]) => {
    const v = clampScore(r.aspectScores?.[key]);
    return `<div><span class="bars">${bars(v)}</span>　${label}　${v}</div>`;
  }).join('');

  const rubricRows = (r.itemResults || []).map((item) => {
    const def = rubricById[item.id];
    if (!def) return '';
    const [glyph] = MARK[item.judgement] || MARK.miss;
    return `<tr>
      <td class="mk">${glyph}</td>
      <td>${esc(def.content)}<br><span style="font-size:8.5pt;color:#555">${ASPECTS[def.aspect] || ''}・${def.weight}点${def.essential ? '・必須' : ''}</span></td>
      <td>${esc(item.comment)}</td>
    </tr>`;
  }).join('');

  const notesBlock = (r.expressionNotes || []).length
    ? `<div class="sec"><h2>表現の指摘</h2>
        ${r.expressionNotes.map((n) => `<div class="quoted">
          <div class="q">「${esc(n.quote)}」</div>
          <div>${esc(n.issue)}　→　${esc(n.suggestion)}</div>
        </div>`).join('')}</div>`
    : '';

  const pitfalls = (problem.analysis.pitfalls || []).length
    ? `<div class="sec"><h2>この問題で気をつけるところ</h2>
        <ul>${problem.analysis.pitfalls.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : '';

  return `<div class="rpt">
  <div class="doc-head">
    <div class="app">要約トレーニング　添削レポート</div>
    <h1>${esc(problem.title)}</h1>
    <div class="sub">${esc(problem.theme)}　|　指定字数 ${target}字　|　採点日時 ${stamp(attempt.createdAt)}${attempt.inputMethod === 'photo' ? '　|　手書き解答を撮影' : ''}</div>
  </div>

  <div class="sec">
    <div class="scorebox">
      <div class="num">${clampScore(r.totalScore)}<span> / 100点</span></div>
      <div class="len">${charTag(attempt.answer, target)}</div>
    </div>
    <div class="aspects">${aspectRows}</div>
  </div>

  <div class="sec">
    <h2>解答</h2>
    <div class="answer-text">${highlightAnswer(attempt.answer, attempt.copiedSpans, r.expressionNotes)}</div>
    <div class="legend">
      ピンク＝表現の指摘　／　黄色＝本文から20字以上の連続一致<br>${esc(r.quoteComment)}
    </div>
  </div>

  <div class="sec">
    <h2>採点</h2>
    <table class="rubric">
      <tr><th></th><th>採点項目</th><th>講評</th></tr>
      ${rubricRows}
    </table>
  </div>

  ${notesBlock}

  <div class="sec">
    <h2>総評</h2>
    <div class="two-col">
      <div>
        <h3>できていた点</h3>
        <ul>${(r.goodPoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>
      <div>
        <h3>次に直すこと</h3>
        <ul>${(r.improvePoints || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>
    </div>
  </div>

  <div class="sec">
    <h2>この解答を直した例</h2>
    <div class="char-line">${charTag(r.revisedAnswer, target)}（もとの解答は ${countChars(attempt.answer)}字）</div>
    <div class="sub-label">どこを直したか　取り消し線＝削ったところ／下線＝足したところ</div>
    <div class="diff">${renderDiff(attempt.answer, r.revisedAnswer)}</div>
    <div class="sub-label">直したあとの文章</div>
    <div class="boxed">${esc(r.revisedAnswer)}</div>
  </div>

  <div class="sec">
    <h2>模範解答</h2>
    <div class="char-line">${charTag(problem.analysis.modelAnswer, target)}</div>
    <div class="boxed">${esc(problem.analysis.modelAnswer)}</div>
  </div>

  ${pitfalls}

  <div class="sec long">
    <h2>本文（${countChars(problem.text)}字）</h2>
    <div class="body-text">${highlightSource(problem.text, problem.analysis.rubric, problem.highlights || [])}</div>
    <div class="legend">緑＝採点項目の根拠　／　黄色＝解答者が引いたマーカー</div>
  </div>

  <div class="foot">このレポートは「要約トレーニング」で自動採点したものです。採点はAIによるもので、教員による採点を代替するものではありません。</div>
</div>`;
}

/* ────────────── 出力 ────────────── */

function safeFileName(problem, attempt) {
  const d = new Date(attempt.createdAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const title = (problem.title || '要約').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
  return `要約添削_${title}_${ymd}`;
}

/** 印刷ダイアログを開く。「PDFとして保存」を選べばPDFになる。 */
export function printReport(problem, attempt) {
  const area = document.getElementById('print-area');
  area.innerHTML = buildReportHtml(problem, attempt);
  const restore = document.title;
  document.title = safeFileName(problem, attempt); // PDFの既定ファイル名になる
  window.print();
  setTimeout(() => { document.title = restore; }, 1000);
}

/** 単体で開けるHTMLファイルとして保存する（メールやLINEで送れる）。 */
export function downloadReportHtml(problem, attempt) {
  const name = safeFileName(problem, attempt);
  const doc = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>body{margin:0;background:#fff;}${REPORT_CSS}</style>
</head>
<body>
${buildReportHtml(problem, attempt)}
</body>
</html>`;

  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
