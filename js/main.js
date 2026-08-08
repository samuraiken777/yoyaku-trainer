// 画面遷移とイベント配線。

import { callClaude, getApiKey, setApiKey, getCostJpy, resetCost, testConnection, ApiError } from './api.js';
import { PRESETS, getPresetKey, setPresetKey, getPreset, modelFor } from './config.js';
import { printReport, downloadReportHtml } from './report.js';
import {
  ANALYZE_SCHEMA, GRADE_SCHEMA, OCR_SCHEMA, GENERATE_SCHEMA,
  analyzeMessages, gradeMessages, ocrMessages, generateMessages,
} from './prompts.js';
import { countChars, charStatus, findCopiedSpans } from './grading.js';
import { fitToLength } from './fit.js';
import * as store from './storage.js';
import { renderResult, renderHistory, renderUserHighlights, esc } from './render.js';
import { fileToJpegBase64 } from './ocr.js';
import { quoteOfTheDay, computeStreak } from './daily.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  problem: null,
  attempt: null,
  photoBase64: null,
  inputMethod: 'type',
  suppressHlClickUntil: 0,
};

/* ══════════════ 共通UI ══════════════ */

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  window.scrollTo(0, 0);
}

function busy(text, sub = '') {
  const q = quoteOfTheDay();
  $('#busy-text').textContent = text;
  $('#busy-sub').textContent = sub;
  $('#busy-quote-ja').textContent = q.ja;
  $('#busy-quote-en').textContent = q.en;
  $('#busy').classList.remove('hidden');
}

function idle() {
  $('#busy').classList.add('hidden');
}

function updateCost() {
  const yen = `¥${Math.round(getCostJpy()).toLocaleString('ja-JP')}`;
  $('#cost-badge').textContent = yen;
  $('#cost-total').textContent = yen;
}

function fail(e) {
  console.error(e);
  alert(e instanceof ApiError || e instanceof Error ? e.message : String(e));
}

/* ══════════════ 設定 ══════════════ */

function openSettings() {
  $('#api-key').value = getApiKey();
  $('#test-result').textContent = '';
  $('#test-result').className = 'test-result';
  updateCost();
  $('#settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('#settings-modal').classList.add('hidden');
}

$('#open-settings').onclick = openSettings;
$('#close-settings').onclick = closeSettings;

$('#save-key').onclick = () => {
  setApiKey($('#api-key').value);
  closeSettings();
};

$('#test-btn').onclick = async () => {
  const el = $('#test-result');
  setApiKey($('#api-key').value);
  el.className = 'test-result';
  el.textContent = '接続中…';
  try {
    await testConnection();
    el.className = 'test-result ok';
    el.textContent = '✓ 接続できました。このキーで使えます。';
  } catch (e) {
    el.className = 'test-result ng';
    el.textContent = `✗ ${e.message}`;
  }
  updateCost();
};

/* ── 品質と速さのプリセット ── */

function paintPreset() {
  const p = getPreset();
  $('#preset-note').textContent = `${p.desc}　${p.note}`;
  const note = $('#mode-note');
  if (note) note.textContent = `採点モード: ${p.label} — ${p.desc}　／　変更は右上の⚙から`;
}

(function initPresetUI() {
  const sel = $('#preset-select');
  sel.innerHTML = Object.entries(PRESETS)
    .map(([key, p]) => `<option value="${key}">${p.label}</option>`)
    .join('');
  sel.value = getPresetKey();
  sel.onchange = () => { setPresetKey(sel.value); paintPreset(); };
  paintPreset();
})();

$('#reset-cost').onclick = () => {
  resetCost();
  updateCost();
};

$('#wipe-data').onclick = async () => {
  if (!confirm('保存した問題と採点結果をすべて削除します。元に戻せません。よろしいですか？')) return;
  await store.wipeAll();
  await refreshHome();
  closeSettings();
  show('home');
};

/* ══════════════ ホーム ══════════════ */

function paintStreak(attempts) {
  const { count, doneToday, total } = computeStreak(attempts);
  const el = $('#streak-row');

  if (!total) {
    el.innerHTML = '<span class="streak-msg todo">まずは1問。ここから始まる。</span>';
    return;
  }

  const flame = count > 0 ? `<span class="streak-badge">🔥 ${count}日連続</span>` : '';
  const today = doneToday
    ? '<span class="streak-msg done">✓ 今日はもう解いた</span>'
    : '<span class="streak-msg todo">今日の1問がまだ</span>';

  el.innerHTML = `${flame}${today}<span class="streak-total">通算 ${total}日・${attempts.length}回</span>`;
}

async function refreshHome() {
  const problems = await store.listProblems();
  const attempts = await store.listAttempts();
  const list = $('#problem-list');

  paintStreak(attempts);

  if (!problems.length) {
    list.innerHTML = '<p class="empty">まだ問題がありません。上のボタンから作ってください。</p>';
    return;
  }

  list.innerHTML = problems.map((p) => {
    const mine = attempts.filter((a) => a.problemId === p.id);
    const last = mine[0];
    const meta = mine.length
      ? `${mine.length}回解答・最新 ${last.result.totalScore}点`
      : '未解答';
    return `<div class="card" data-id="${p.id}">
      <h3>${esc(p.title)}</h3>
      <div class="meta">${esc(p.theme)}　|　${p.targetChars}字　|　${meta}</div>
      <div class="excerpt">${esc(p.text.slice(0, 90))}…</div>
      <div class="row between">
        <button class="btn small open-btn">解く</button>
        <button class="btn ghost small danger del-btn">削除</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.open-btn').forEach((b) => {
    b.onclick = () => openSolve(b.closest('.card').dataset.id);
  });
  list.querySelectorAll('.del-btn').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('この問題を削除しますか？')) return;
      await store.deleteProblem(b.closest('.card').dataset.id);
      refreshHome();
    };
  });
}

$('#nav-home').onclick = () => { refreshHome(); show('home'); };
$('#back-home').onclick = () => { refreshHome(); show('home'); };
$('#go-create').onclick = () => {
  $('#src-text').value = '';
  $('#src-title').value = '';
  $('#src-count').textContent = '0 字';
  switchTab('paste');
  show('create');
};

/* ══════════════ 問題作成：タブ ══════════════ */

function switchTab(name) {
  $$('#source-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
}

$$('#source-tabs .tab').forEach((t) => {
  t.onclick = () => { if (!t.disabled) switchTab(t.dataset.tab); };
});

/* ══════════════ 問題作成：AI生成 ══════════════ */

function setSourceText(text) {
  $('#src-text').value = text;
  $('#src-count').textContent = `${countChars(text)} 字`;
}

$('#generate-btn').onclick = async () => {
  const theme = $('#gen-theme').value.trim();
  const level = $('#gen-level').value;
  const length = Number($('#gen-length').value);

  busy('練習用の文章を書いています…', `${length}字程度の評論文（15〜30秒）`);
  try {
    const { system, messages } = generateMessages({ theme, level, length });
    const { json } = await callClaude({
      ...modelFor('generate'),
      system, messages,
      schema: GENERATE_SCHEMA,
    });

    setSourceText(json.text);
    $('#src-title').value = json.title || '';
    switchTab('paste');
    updateCost();
    idle();
    alert('文章ができました。目を通して、よければ「この文章を分析して問題にする」を押してください。\n気に入らなければ「AI生成」タブに戻って作り直せます。');
  } catch (e) {
    idle();
    fail(e);
  }
};

/* ══════════════ 問題作成：分析 ══════════════ */

$('#src-text').addEventListener('input', (e) => {
  $('#src-count').textContent = `${countChars(e.target.value)} 字`;
});

$('#src-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setSourceText(await file.text());
});

$('#analyze-btn').onclick = async () => {
  const text = $('#src-text').value.trim();
  if (countChars(text) < 300) {
    alert('本文が短すぎます。300字以上の文章を貼り付けてください。');
    return;
  }
  if (countChars(text) > 6000) {
    alert('本文が長すぎます。6000字以内にしてください。');
    return;
  }

  const targetChars = Number($('#src-chars').value);
  busy('この文章を分析しています…', `${getPreset().desc} で模範解答と採点基準を作っています`);

  try {
    const { system, messages } = analyzeMessages(text, targetChars);
    const { json } = await callClaude({
      ...modelFor('analyze'),
      system, messages,
      schema: ANALYZE_SCHEMA,
    });

    if (!json.rubric?.length) throw new Error('採点基準を作れませんでした。別の文章で試してください。');

    // 模範解答が指定字数を超えていたら詰め直させる（字数はこちらで実測する）
    const finalTarget = targetChars || json.recommendedChars;
    json.modelAnswer = await fitToLength(
      json.modelAnswer, finalTarget, 'model',
      (m) => busy('この文章を分析しています…', m),
    );

    const problem = {
      id: store.newId(),
      title: $('#src-title').value.trim() || json.title,
      theme: json.theme,
      text,
      targetChars: finalTarget,
      analysis: json,
      highlights: [],
      createdAt: Date.now(),
    };
    await store.saveProblem(problem);
    updateCost();
    idle();
    openSolve(problem);
  } catch (e) {
    idle();
    fail(e);
  }
};

/* ══════════════ 演習 ══════════════ */

async function openSolve(problemOrId) {
  const problem = typeof problemOrId === 'string'
    ? await store.getProblem(problemOrId)
    : problemOrId;
  if (!problem) return;

  if (!problem.highlights) problem.highlights = [];

  state.problem = problem;
  state.photoBase64 = null;
  state.inputMethod = 'type';

  $('#solve-title').textContent = problem.title;
  $('#solve-meta').textContent = `${problem.theme}　|　${problem.targetChars}字にまとめる`;
  paintSource();
  $('#answer-text').value = '';
  $('#answer-target').textContent = `目標 ${problem.targetChars}字`;
  $('#photo-preview').classList.add('hidden');
  $('#photo-label').textContent = '📷 解答用紙を撮影／写真を選ぶ';
  $('#ocr-btn').disabled = true;
  switchInput('type');
  updateAnswerCount();
  paintPreset();

  show('solve');
}

function switchInput(mode) {
  state.inputMethod = mode;
  $$('.seg').forEach((b) => b.classList.toggle('active', b.dataset.input === mode));
  $$('.input-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.inputPanel !== mode));
}

$$('.seg').forEach((b) => { b.onclick = () => switchInput(b.dataset.input); });

function updateAnswerCount() {
  const count = countChars($('#answer-text').value);
  const el = $('#answer-count');
  el.textContent = `${count} 字`;
  el.className = 'counter';
  if (count > 0 && state.problem) {
    el.classList.add(charStatus(count, state.problem.targetChars));
  }
}

$('#answer-text').addEventListener('input', updateAnswerCount);

/* ── 本文のマーカー ── */

const sourceEl = $('#solve-source');

function paintSource() {
  sourceEl.innerHTML = renderUserHighlights(state.problem.text, state.problem.highlights);
}

async function saveHighlights(ranges) {
  state.problem.highlights = ranges;
  paintSource();
  await store.saveProblem(state.problem);
}

/** 本文コンテナ内の (node, offset) を、本文先頭からの文字数に変換する。 */
function charOffsetOf(node, offset) {
  if (!sourceEl.contains(node)) return null;
  const walker = document.createTreeWalker(sourceEl, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return acc + offset;
    acc += n.nodeValue.length;
  }
  // 選択端がテキストノードでない場合（要素の境界）は、その要素までの累積を返す
  if (node.nodeType === Node.ELEMENT_NODE) {
    const probe = node.childNodes[offset] || node.lastChild;
    return probe ? charOffsetOf(probe, 0) : null;
  }
  return null;
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

function subtractRange(ranges, a, b) {
  const out = [];
  for (const r of ranges) {
    if (r.end <= a || r.start >= b) { out.push(r); continue; }
    if (r.start < a) out.push({ start: r.start, end: a });
    if (r.end > b) out.push({ start: b, end: r.end });
  }
  return out;
}

function applySelection() {
  if (!state.problem) return;
  if (!$('.view[data-view=solve]').classList.contains('active')) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  if (!sourceEl.contains(range.commonAncestorContainer)) return;

  const start = charOffsetOf(range.startContainer, range.startOffset);
  const end = charOffsetOf(range.endContainer, range.endOffset);
  if (start === null || end === null || end - start < 2) return;

  sel.removeAllRanges();
  state.suppressHlClickUntil = Date.now() + 700; // 直後のクリックで消えないように
  saveHighlights(mergeRanges([...state.problem.highlights, { start, end }]));
}

// スマホの長押し選択とPCのドラッグ選択の両方を拾うため、
// selectionchange が落ち着いてから確定させる
let selectionTimer;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(applySelection, 450);
});

sourceEl.addEventListener('click', (e) => {
  if (Date.now() < state.suppressHlClickUntil) return;
  const mark = e.target.closest('mark.user-hl');
  if (!mark || !state.problem) return;
  const start = charOffsetOf(mark.firstChild, 0);
  if (start === null) return;
  saveHighlights(subtractRange(state.problem.highlights, start, start + mark.textContent.length));
});

$('#clear-hl').onclick = () => {
  if (!state.problem?.highlights?.length) return;
  saveHighlights([]);
};

/* ── 手書きの撮影と読み取り ── */

$('#answer-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { base64, dataUrl } = await fileToJpegBase64(file);
    state.photoBase64 = base64;
    $('#photo-preview').src = dataUrl;
    $('#photo-preview').classList.remove('hidden');
    $('#photo-label').textContent = '📷 別の写真を選ぶ';
    $('#ocr-btn').disabled = false;
  } catch (err) {
    fail(err);
  }
});

$('#ocr-btn').onclick = async () => {
  if (!state.photoBase64) return;
  busy('手書きの文字を読み取っています…', '読み取り後に自分で直せます');
  try {
    const { system, messages } = ocrMessages(state.photoBase64);
    const { json } = await callClaude({
      ...modelFor('ocr'),
      system, messages,
      schema: OCR_SCHEMA,
      maxTokens: 4000,
    });

    $('#answer-text').value = json.text;
    updateAnswerCount();
    switchInput('type');
    updateCost();
    idle();

    const warn = json.confidence !== 'high' || json.uncertain?.length
      ? `\n\n読み取りに自信がない箇所: ${json.uncertain?.join('、') || '（複数）'}`
      : '';
    alert(`読み取りました。誤りがないか確認して、必要なら直してから採点してください。${warn}`);
  } catch (e) {
    idle();
    fail(e);
  }
};

/* ── 採点 ── */

$('#grade-btn').onclick = async () => {
  const problem = state.problem;
  const answer = $('#answer-text').value.trim();

  if (countChars(answer) < 20) {
    alert('解答が短すぎます。要約を書いてから採点してください。');
    return;
  }

  busy('採点しています…', `${getPreset().desc} で採点基準に沿って添削しています`);

  try {
    const charCount = countChars(answer);
    const copiedSpans = findCopiedSpans(problem.text, answer);

    const { system, messages } = gradeMessages({
      source: problem.text,
      analysis: problem.analysis,
      answer,
      charCount,
      targetChars: problem.targetChars,
      copiedSpans,
    });

    const { json } = await callClaude({
      ...modelFor('grade'),
      system, messages,
      schema: GRADE_SCHEMA,
    });

    // 直した例が指定字数を超えていたら詰め直させる
    json.revisedAnswer = await fitToLength(
      json.revisedAnswer, problem.targetChars, 'revised',
      (m) => busy('採点しています…', m),
    );

    const attempt = {
      id: store.newId(),
      problemId: problem.id,
      answer,
      inputMethod: state.inputMethod === 'photo' ? 'photo' : 'type',
      charCount,
      copiedSpans,
      result: json,
      createdAt: Date.now(),
    };

    await store.saveAttempt(attempt);
    state.attempt = attempt;
    updateCost();
    idle();

    $('#result-body').innerHTML = renderResult(problem, attempt);
    show('result');
  } catch (e) {
    idle();
    fail(e);
  }
};

$('#retry-btn').onclick = () => openSolve(state.problem);

/* ══════════════ レポート出力 ══════════════ */

$('#print-btn').onclick = () => {
  if (!state.problem || !state.attempt) return;
  printReport(state.problem, state.attempt);
};

$('#html-btn').onclick = () => {
  if (!state.problem || !state.attempt) return;
  downloadReportHtml(state.problem, state.attempt);
};

/* ══════════════ 履歴 ══════════════ */

async function openHistory() {
  const attempts = await store.listAttempts();
  const problems = await store.listProblems();
  const byId = Object.fromEntries(problems.map((p) => [p.id, p]));
  $('#history-body').innerHTML = renderHistory(attempts, byId);
  show('history');
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'go-history') openHistory();
});

/* ══════════════ 起動 ══════════════ */

(async function init() {
  const q = quoteOfTheDay();
  $('#quote-ja').textContent = q.ja;
  $('#quote-en').textContent = q.en;

  updateCost();
  await refreshHome();

  const hero = document.querySelector('.hero');
  const link = document.createElement('button');
  link.className = 'btn ghost';
  link.id = 'go-history';
  link.textContent = '📈 これまでの記録を見る';
  link.style.marginTop = '10px';
  link.style.width = '100%';
  hero.appendChild(link);

  show('home');

  if (!getApiKey()) openSettings();
})();
