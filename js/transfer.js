// 問題の受け渡しと、データのバックアップ。
//
// 端末どうしでデータが共有されないので、ファイルで持ち運べるようにする。
//   ・問題ファイル … 父がPCで作った問題を息子のiPadへ渡す（AirDrop・メール等）
//   ・バックアップ … Safariのデータ消去で全部消えたときの保険

const APP = 'summaringo';

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
}

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ────────────── 書き出し ────────────── */

/** 問題1つ（本文＋採点基準）をファイルにする。解答履歴は含めない。 */
export function exportProblem(problem) {
  download(
    { app: APP, kind: 'problem', version: 1, exportedAt: new Date().toISOString(), problem },
    `問題_${safeName(problem.title)}_${stamp()}.json`,
  );
}

/** 全データ（問題＋解答履歴）をファイルにする。 */
export function exportBackup(data) {
  download(
    { app: APP, kind: 'backup', version: 1, exportedAt: new Date().toISOString(), ...data },
    `Summaringoバックアップ_${stamp()}.json`,
  );
}

/* ────────────── 読み込み ────────────── */

export class TransferError extends Error {}

/**
 * ファイルを読んで中身を返す。
 * @returns {{ kind:'problem'|'backup', problems: object[], attempts: object[] }}
 */
export async function readTransferFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new TransferError('このファイルは読み取れませんでした。Summaringo で書き出したファイルを選んでください。');
  }

  if (data?.app !== APP) {
    throw new TransferError('Summaringo のファイルではないようです。書き出したファイルをそのまま選んでください。');
  }

  if (data.kind === 'problem') {
    if (!data.problem?.text || !data.problem?.analysis?.rubric?.length) {
      throw new TransferError('問題の中身が壊れています。書き出し直してください。');
    }
    return { kind: 'problem', problems: [data.problem], attempts: [] };
  }

  if (data.kind === 'backup') {
    return { kind: 'backup', problems: data.problems || [], attempts: data.attempts || [] };
  }

  throw new TransferError('対応していない種類のファイルです。');
}
