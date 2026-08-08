// その日の一言と、連続日数（ストリーク）。
//
// 一言は日付から決まるので、同じ日に何度開いても変わらない。
// 日が変わると次の一言になる。

export const QUOTES = [
  { ja: '削る勇気が、伝える力になる。',                       en: 'Cut until only the point remains.' },
  { ja: '要約とは、何を残すかではなく、何を捨てるかを決める作業だ。', en: 'Summarizing is deciding what to throw away.' },
  { ja: '百字で言えないことは、まだわかっていない。',           en: "If you can't say it briefly, you don't understand it yet." },
  { ja: '短く書けたぶんだけ、深く読めている。',                 en: 'The shorter you write it, the deeper you read it.' },
  { ja: '「わかったつもり」は、書いた瞬間に崩れる。',           en: 'Reading feels easy — until you have to write it down.' },
  { ja: '一語削るごとに、残りの言葉が強くなる。',               en: 'Every word you delete makes the rest louder.' },
  { ja: 'たくさん読む必要はない。深く読めばいい。',             en: "You don't need to read more. You need to read deeper." },
  { ja: '要約は、理解の証明であって、近道ではない。',           en: 'A summary is proof of understanding, not a shortcut around it.' },
  { ja: '毎日ひとつ。一年で三百六十五。',                       en: "One passage a day. That's 365 a year." },
  { ja: '昨日の自分より、1点でいい。',                          en: "Beat yesterday by one point. That's enough." },
  { ja: '今日の一問が、本番の日の力になる。',                   en: "Today's one question becomes your strength on the real day." },
  { ja: 'あとはやるだけだ。',                                   en: 'JUST DO IT!' },
  { ja: '継続は力なり。',                                       en: 'Persistence is power.' },
  { ja: '千里の道も一歩から。',                                 en: 'A journey of a thousand miles begins with a single step.' },
  { ja: '簡潔は才能の姉妹である。　― チェーホフ',               en: '"Brevity is the sister of talent." — Anton Chekhov' },
];

/** ローカル日付の 'YYYY-MM-DD'。 */
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** その日の一言。日付から決まるので同じ日なら何度開いても同じ。 */
export function quoteOfTheDay(date = new Date()) {
  const n = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  return QUOTES[n % QUOTES.length];
}

/**
 * 連続で解いた日数。
 * 今日まだ解いていなくても、昨日まで続いていれば記録は生きている扱いにする
 * （その日のうちに解けば途切れないので、朝の時点で0にしない）。
 */
export function computeStreak(attempts) {
  const days = new Set(attempts.map((a) => dayKey(a.createdAt)));
  const doneToday = days.has(dayKey(Date.now()));
  if (!days.size) return { count: 0, doneToday: false, total: 0 };

  const cursor = new Date();
  if (!doneToday) cursor.setDate(cursor.getDate() - 1);

  let count = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { count, doneToday, total: days.size };
}

/** ストリークの状態に応じた一言。淡々と、でも積み上がりが見えるように。 */
export function streakMessage({ count, doneToday, total }) {
  if (!total) return { cls: 'todo', text: 'まずは1本。ここから始まる。' };

  if (doneToday) {
    if (count >= 30) return { cls: 'done', text: '今日のぶんも書けた。もう習慣だ。' };
    if (count >= 7)  return { cls: 'done', text: '今日のぶんも書けた。いい流れ。' };
    if (count >= 2)  return { cls: 'done', text: '今日のぶんも書けた。' };
    return { cls: 'done', text: '今日のぶん、完了。' };
  }

  if (count > 0) return { cls: 'todo', text: `今日のぶんがまだ。${count}日の流れを切らすな。` };
  return { cls: 'todo', text: '今日からまた積み上げよう。' };
}

/* ────────────── 週次サマリー ────────────── */

/** その週の月曜日 0:00。 */
function weekStart(base) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 月曜始まり
  return d;
}

function bucket(attempts, from, to) {
  const list = attempts.filter((a) => a.createdAt >= from && (to === null || a.createdAt < to));
  const days = new Set(list.map((a) => dayKey(a.createdAt))).size;
  const scores = list.map((a) => a.result?.totalScore).filter((s) => typeof s === 'number');
  const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
  return { days, count: list.length, avg };
}

/** 今週と先週の成績。先週と比べた平均点の差も返す。 */
export function weeklySummary(attempts) {
  const thisWeek = weekStart(new Date()).getTime();
  const lastWeek = thisWeek - 7 * 86400000;

  const cur = bucket(attempts, thisWeek, null);
  const prev = bucket(attempts, lastWeek, thisWeek);
  const delta = cur.avg !== null && prev.avg !== null ? cur.avg - prev.avg : null;

  return { cur, prev, delta };
}
