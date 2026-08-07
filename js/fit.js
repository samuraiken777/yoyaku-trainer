// 字数の後始末。
//
// モデルに「◯字以内で」と指示しても日本語の字数は正確に数えられないので、
// 返ってきた文章を JS で実測し、超えていたら圧縮し直させる。
// 数えるのは常にこちら、直すのはモデル、という役割分担にしている。

import { callClaude } from './api.js';
import { modelFor } from './config.js';
import { countChars } from './grading.js';
import { FIT_SCHEMA, fitMessages } from './prompts.js';

const MAX_ATTEMPTS = 2;

/**
 * text が target 字を超えていたら、収まるまで圧縮させる。
 * 失敗しても例外は投げず、その時点で一番短いものを返す
 * （画面には実測字数がそのまま出るので、直らなかったことは隠れない）。
 *
 * @param {string} text    元の文章
 * @param {number} target  指定字数
 * @param {'model'|'revised'} kind  模範解答か、生徒の解答を直した例か
 * @param {(msg: string) => void} [onProgress] 進捗表示用
 */
export async function fitToLength(text, target, kind, onProgress) {
  if (!text || !target) return text;

  let best = text;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const count = countChars(best);
    if (count <= target) break;

    onProgress?.(`字数を調整しています…（${count}字 → ${target}字以内へ）`);

    try {
      const { system, messages } = fitMessages({ text: best, target, kind });
      const { json } = await callClaude({
        ...modelFor('grade'),
        system, messages,
        schema: FIT_SCHEMA,
        maxTokens: 4000,
      });

      const next = json?.text?.trim();
      if (!next) break;

      // 短くなっていなければこれ以上粘っても改善しない
      if (countChars(next) >= countChars(best)) {
        if (countChars(next) <= target) best = next;
        break;
      }
      best = next;
    } catch (e) {
      console.warn('字数の調整に失敗しました', e);
      break;
    }
  }

  return best;
}
