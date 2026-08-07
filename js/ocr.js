// 撮影した解答用紙の前処理。
// 長辺 2576px（Opus 5 / Sonnet 5 の高解像度上限）に収めて JPEG 化する。
// 手書きは解像度が効くので、むやみに小さくしない。

const MAX_EDGE = 2576;
const QUALITY = 0.85;

async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch { /* 下の <img> 経由にフォールバック */ }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 画像ファイルを縮小して JPEG の base64 にする。
 * @returns {{ base64: string, dataUrl: string, width: number, height: number }}
 */
export async function fileToJpegBase64(file) {
  let src;
  try {
    src = await decode(file);
  } catch {
    throw new Error(
      'この画像を読み込めませんでした。HEIC形式の場合は、iPhoneの「設定 › カメラ › フォーマット」を' +
      '「互換性優先」にするか、JPEGに変換してから試してください。',
    );
  }

  const w0 = src.width;
  const h0 = src.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  if (!base64) throw new Error('画像の変換に失敗しました。別の写真で試してください。');

  return { base64, dataUrl, width: w, height: h };
}
