// 品質と速さのプリセット。⚙の設定画面から切り替える。
//
// effort は low / medium / high。上げるほど深く考えるが、遅く・高くなる。
// 時間と費用は本文1500字・120字要約でのおおよその目安。

const PRESET_KEY = 'yoyaku.preset';

export const PRESETS = {
  fast: {
    label: '速さ優先',
    model: 'claude-sonnet-5',
    effort: 'low',
    desc: 'Sonnet 5 / 浅め',
    note: '1回10〜15秒・1問あたり約7円。数をこなす日はこれで十分。',
  },
  standard: {
    label: '標準（おすすめ）',
    model: 'claude-sonnet-5',
    effort: 'medium',
    desc: 'Sonnet 5 / 標準',
    note: '1回15〜30秒・1問あたり約10円。速さと質のバランスが良い。',
  },
  careful: {
    label: '質を優先',
    model: 'claude-sonnet-5',
    effort: 'high',
    desc: 'Sonnet 5 / 深め',
    note: '1回25〜45秒・1問あたり約13円。採点が浅いと感じたらここへ。',
  },
  best: {
    label: '最高品質',
    model: 'claude-opus-5',
    effort: 'high',
    desc: 'Opus 5 / 深め',
    note: '1回40〜90秒・1問あたり約25円。難関二次レベルの読み込みが要るとき。',
  },
};

export const DEFAULT_PRESET = 'standard';

export function getPresetKey() {
  const k = localStorage.getItem(PRESET_KEY);
  return PRESETS[k] ? k : DEFAULT_PRESET;
}

export function setPresetKey(key) {
  if (PRESETS[key]) localStorage.setItem(PRESET_KEY, key);
}

export function getPreset() {
  return PRESETS[getPresetKey()];
}

/**
 * 用途ごとのモデル設定を返す。
 * 手書きの文字起こしは考える作業ではないので、どのプリセットでも effort は low で固定。
 * （モデル自体は追従するので、最高品質にすると読み取りにくい字にも強くなる）
 */
export function modelFor(task) {
  const p = getPreset();
  return task === 'ocr'
    ? { model: p.model, effort: 'low' }
    : { model: p.model, effort: p.effort };
}
