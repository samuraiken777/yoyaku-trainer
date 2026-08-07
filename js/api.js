// Claude API ラッパ。ブラウザから api.anthropic.com を直接叩く（BYOK方式）。
//
// CORS は `anthropic-dangerous-direct-browser-access: true` ヘッダで有効になる。
// キーはこの端末の localStorage にのみ保存し、他のどこにも送らない。

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const KEY_STORAGE = 'yoyaku.apiKey';
const COST_STORAGE = 'yoyaku.cost';

/** 1トークンあたり USD（$/1M トークン ÷ 1e6） */
const PRICING = {
  'claude-opus-5':   { in: 5 / 1e6,  out: 25 / 1e6 },
  'claude-sonnet-5': { in: 2 / 1e6,  out: 10 / 1e6 }, // 導入価格（2026-08-31まで。以降は $3/$15）
};
const USD_JPY = 150; // 概算表示用

/* ────────────── APIキー ────────────── */

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

export function setApiKey(key) {
  const trimmed = (key || '').trim();
  if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed);
  else localStorage.removeItem(KEY_STORAGE);
}

/* ────────────── 費用の積算 ────────────── */

export function getCostJpy() {
  return Number(localStorage.getItem(COST_STORAGE) || 0);
}

export function resetCost() {
  localStorage.setItem(COST_STORAGE, '0');
}

function addCost(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  // キャッシュ読み書きは今のところ使っていないので、通常の入出力のみで概算する
  const usd = (usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out;
  const jpy = usd * USD_JPY;
  localStorage.setItem(COST_STORAGE, String(getCostJpy() + jpy));
  return jpy;
}

/* ────────────── 本体 ────────────── */

export class ApiError extends Error {
  constructor(message, { status = 0, type = '', retryable = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Messages API を1回呼ぶ。
 * schema を渡すと structured outputs でJSONを強制し、パース済みの値を json に入れて返す。
 */
export async function callClaude({
  model = 'claude-opus-5',
  system,
  messages,
  schema = null,
  effort = 'high',
  maxTokens = 16000,
  tools = null,
  thinking = null,
  maxRetries = 2,
} = {}) {
  const key = getApiKey();
  if (!key) throw new ApiError('APIキーが設定されていません。右上の⚙から設定してください。');

  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (tools) body.tools = tools;
  // 省略時は各モデルの既定（Opus 5 / Sonnet 5 とも adaptive thinking が有効）に任せる
  if (thinking) body.thinking = thinking;

  const outputConfig = { effort };
  if (schema) outputConfig.format = { type: 'json_schema', schema };
  body.output_config = outputConfig;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(1200 * 2 ** (attempt - 1) + Math.random() * 400);

    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = new ApiError(
        'APIに接続できませんでした。ネットワーク接続を確認してください。',
        { retryable: true },
      );
      continue;
    }

    if (!res.ok) {
      const err = await readError(res);
      if (err.retryable && attempt < maxRetries) { lastError = err; continue; }
      throw err;
    }

    const data = await res.json();
    const costJpy = addCost(model, data.usage);

    if (data.stop_reason === 'refusal') {
      throw new ApiError(
        'このリクエストはAnthropic側の安全性チェックで拒否されました。本文の内容を確認してください。',
        { type: 'refusal' },
      );
    }

    // thinking ブロックが先頭に来ることがあるので、text ブロックを明示的に探す
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (data.stop_reason === 'max_tokens') {
      throw new ApiError('応答が上限に達して途中で切れました。本文が長すぎる可能性があります。');
    }
    if (!text) {
      throw new ApiError('応答が空でした。もう一度試してください。');
    }

    let json = null;
    if (schema) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError('AIの応答をJSONとして読み取れませんでした。もう一度試してください。');
      }
    }

    return { text, json, usage: data.usage, costJpy, raw: data };
  }

  throw lastError || new ApiError('リクエストに失敗しました。');
}

async function readError(res) {
  let detail = '';
  let type = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || '';
    type = j?.error?.type || '';
  } catch { /* JSONでないレスポンスは無視 */ }

  const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
  const messages = {
    401: 'APIキーが正しくありません。⚙から確認してください。',
    403: 'このAPIキーには権限がありません（Workspaceの設定を確認してください）。',
    404: 'モデルが見つかりません。アプリの更新が必要かもしれません。',
    413: '本文が大きすぎます。短くして試してください。',
    429: 'リクエストが多すぎます。少し待ってから試してください。',
  };
  const base = messages[res.status]
    || (res.status >= 500 ? 'Anthropic側が混雑しています。少し待って試してください。' : 'APIエラーが発生しました。');

  return new ApiError(detail ? `${base}（${detail}）` : base, { status: res.status, type, retryable });
}

/**
 * 設定画面の「接続テスト」用。最小のリクエストを1回投げる。
 * 思考を切っておかないと、思考だけで max_tokens を使い切って
 * 「途中で切れました」という紛らわしいエラーになるので明示的に無効化する。
 */
export async function testConnection() {
  const res = await callClaude({
    model: 'claude-sonnet-5',
    effort: 'low',
    thinking: { type: 'disabled' },
    maxTokens: 64,
    maxRetries: 0,
    messages: [{ role: 'user', content: 'OK とだけ返してください。' }],
  });
  return res.text;
}
