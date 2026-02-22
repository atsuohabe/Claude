/**
 * srs.js - SM-2 改アルゴリズム
 * 間隔反復スケジューリングの全ロジックを担当する
 */

import { Store } from './store.js';

// ─── 定数 ────────────────────────────────────────────────────────────

const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const MATURE_INTERVAL = 21;   // 21日以上 = 成熟（習得済み）
const BURNED_INTERVAL = 90;   // 90日以上 = 定着済み

/** 評価値（0-3）の定義 */
export const RATING = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

/** カード状態 */
export const STATE = {
  NEW: 'new',
  LEARNING: 'learning',
  YOUNG: 'young',
  MATURE: 'mature',
  BURNED: 'burned',
  RELEARN: 'relearn',
};

// ─── 新規カードのデフォルト SRS データ ───────────────────────────────

export function newCardData(wordId) {
  return {
    wordId,
    interval: 0,
    repetitions: 0,
    easeFactor: DEFAULT_EASE,
    dueDate: new Date().toISOString(),
    lastReviewed: null,
    firstSeen: null,
    streak: 0,
    lapses: 0,
    state: STATE.NEW,
  };
}

// ─── SM-2 コア計算 ────────────────────────────────────────────────────

/**
 * 評価を受けて次回レビュー日を計算する
 * @param {object} card - 現在のカード SRS データ
 * @param {number} rating - RATING.AGAIN(0) ～ RATING.EASY(3)
 * @returns {object} 更新された SRS データ（dueDate を含む）
 */
export function calculateNextReview(card, rating) {
  let { interval, repetitions, easeFactor, lapses, streak } = card;

  const now = new Date();

  if (rating === RATING.AGAIN) {
    // 完全忘却：再学習へ
    repetitions = 0;
    interval = 1;
    lapses += 1;
    streak = 0;
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    return {
      ...card,
      interval,
      repetitions,
      easeFactor,
      lapses,
      streak,
      state: STATE.RELEARN,
      dueDate: addDays(now, interval).toISOString(),
      lastReviewed: now.toISOString(),
      firstSeen: card.firstSeen || now.toISOString(),
    };
  }

  // 正解時の Ease Factor 調整
  const easeAdjust = {
    [RATING.HARD]: -0.15,
    [RATING.GOOD]: 0,
    [RATING.EASY]: 0.15,
  }[rating];

  easeFactor = Math.max(MIN_EASE, easeFactor + easeAdjust);
  streak += 1;

  // インターバル計算
  if (repetitions === 0) {
    interval = 1;
  } else if (repetitions === 1) {
    interval = 6;
  } else {
    interval = Math.round(interval * easeFactor);
  }

  // Easy ボーナス
  if (rating === RATING.EASY) {
    interval = Math.round(interval * 1.3);
  }

  // Hard ペナルティ（インターバルを小さめに）
  if (rating === RATING.HARD) {
    interval = Math.max(1, Math.round(interval * 0.8));
  }

  repetitions += 1;

  const state = classifyState(interval);

  return {
    ...card,
    interval,
    repetitions,
    easeFactor,
    lapses,
    streak,
    state,
    dueDate: addDays(now, interval).toISOString(),
    lastReviewed: now.toISOString(),
    firstSeen: card.firstSeen || now.toISOString(),
  };
}

// ─── カード状態分類 ────────────────────────────────────────────────────

export function classifyState(interval) {
  if (interval === 0) return STATE.NEW;
  if (interval >= BURNED_INTERVAL) return STATE.BURNED;
  if (interval >= MATURE_INTERVAL) return STATE.MATURE;
  if (interval >= 7) return STATE.YOUNG;
  return STATE.LEARNING;
}

/** 習得判定（1,000語ゴールのカウント基準） */
export function isMastered(card) {
  return (
    card.interval >= MATURE_INTERVAL &&
    card.repetitions >= 3 &&
    card.lapses <= 2
  );
}

/** 習得レベル 0-4 を返す */
export function getMasteryLevel(card) {
  if (!card || card.state === STATE.NEW) return 0;
  if (card.state === STATE.BURNED) return 4;
  if (card.state === STATE.MATURE) return 3;
  if (card.state === STATE.YOUNG) return 2;
  return 1;
}

// ─── デューキュー生成 ──────────────────────────────────────────────────

/**
 * 今日レビューすべきカードを返す（期限が来ているもの）
 * @param {number} limit
 * @returns {string[]} wordId の配列
 */
export function getDueCardIds(limit = 200) {
  const allCards = Store.getAllCards();
  const now = new Date();

  const due = Object.entries(allCards)
    .filter(([, card]) =>
      card.state !== STATE.NEW &&
      new Date(card.dueDate) <= now
    )
    .sort(([, a], [, b]) => new Date(a.dueDate) - new Date(b.dueDate))
    .map(([id]) => id);

  return due.slice(0, limit);
}

/**
 * 今日導入する新規カード ID を返す
 * 全単語データから、まだ SRS に登録されていないものを最大 limit 件返す
 * @param {number[]} allWordIds - vocab から取得した全単語 ID リスト（frequency_rank 順）
 * @param {number} limit
 * @returns {number[]}
 */
export function getNewCardIds(allWordIds, limit = 10) {
  const allCards = Store.getAllCards();
  const newIds = allWordIds.filter(id => !allCards[String(id)]);
  return newIds.slice(0, limit);
}

// ─── 統計向け集計 ──────────────────────────────────────────────────────

/** 全カードの状態別カウントを返す */
export function getCardStateCounts() {
  const allCards = Store.getAllCards();
  const counts = {
    [STATE.NEW]: 0,
    [STATE.LEARNING]: 0,
    [STATE.YOUNG]: 0,
    [STATE.MATURE]: 0,
    [STATE.BURNED]: 0,
    [STATE.RELEARN]: 0,
  };
  for (const card of Object.values(allCards)) {
    const s = card.state || STATE.LEARNING;
    if (counts[s] !== undefined) counts[s]++;
  }
  return counts;
}

/** 習得済み語数（1,000語ゴール用） */
export function getMasteredCount() {
  const allCards = Store.getAllCards();
  return Object.values(allCards).filter(isMastered).length;
}

/** 学習中語数（SRS に登録済みだが未成熟） */
export function getLearningCount() {
  const allCards = Store.getAllCards();
  return Object.values(allCards).filter(c =>
    !isMastered(c) && c.state !== STATE.NEW
  ).length;
}

/**
 * 今後 N 日間の予測レビュー数を返す
 * @param {number} days
 * @returns {{ date: string, count: number }[]}
 */
export function getForecast(days = 14) {
  const allCards = Store.getAllCards();
  const forecast = [];

  for (let i = 0; i < days; i++) {
    const target = addDays(new Date(), i);
    const targetStr = target.toDateString();
    const count = Object.values(allCards).filter(card => {
      if (!card.dueDate) return false;
      return new Date(card.dueDate).toDateString() === targetStr;
    }).length;
    forecast.push({ date: target.toISOString(), count });
  }

  return forecast;
}

// ─── 覚えた/まだまだ方式 ─────────────────────────────────────────────

/**
 * セッション内の試行回数から次回レビューを計算する
 * @param {object} card - 現在のカード SRS データ
 * @param {number} sessionAttempts - 何回表示されて覚えたか（1 = 一発で覚えた）
 * @returns {object} 更新された SRS データ
 */
export function calculateNextReviewSimple(card, sessionAttempts) {
  const rating = sessionAttempts <= 1 ? RATING.EASY
               : sessionAttempts === 2 ? RATING.GOOD
               : sessionAttempts === 3 ? RATING.HARD
               : RATING.AGAIN;
  return calculateNextReview(card, rating);
}

// ─── 次回インターバルのプレビュー ────────────────────────────────────

/**
 * 現在のカードに各評価を下した場合のインターバル（日数）を返す
 * ボタンのヒント表示用
 */
export function previewIntervals(card) {
  const cardData = card || { interval: 0, repetitions: 0, easeFactor: DEFAULT_EASE, lapses: 0, streak: 0, state: STATE.NEW };
  return {
    [RATING.AGAIN]: calculateNextReview(cardData, RATING.AGAIN).interval,
    [RATING.HARD]: calculateNextReview(cardData, RATING.HARD).interval,
    [RATING.GOOD]: calculateNextReview(cardData, RATING.GOOD).interval,
    [RATING.EASY]: calculateNextReview(cardData, RATING.EASY).interval,
  };
}

// ─── ユーティリティ ──────────────────────────────────────────────────

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** インターバル日数を日本語表示に変換 */
export function intervalToLabel(days) {
  if (days === 0) return '今日';
  if (days === 1) return '1日後';
  if (days < 7) return `${days}日後`;
  if (days < 30) return `${Math.round(days / 7)}週後`;
  return `${Math.round(days / 30)}ヶ月後`;
}
