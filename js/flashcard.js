/**
 * flashcard.js - カード UI コントローラー
 * カードの描画、フリップアニメーション、声調カラー変換を担当する
 */

import { attachGestures } from './gestures.js';
import { RATING, intervalToLabel, previewIntervals } from './srs.js';

// ─── 声調カラー変換 ───────────────────────────────────────────────────

/**
 * ピンイン文字列をパースして声調カラーのHTMLを返す
 * "nǐ hǎo" → '<span class="tone-3">nǐ</span> <span class="tone-3">hǎo</span>'
 * @param {string} pinyin
 * @returns {string} HTML string
 */
export function parsePinyinToHTML(pinyin) {
  if (!pinyin) return '';

  // 声調記号 → 番号マッピング
  const toneMap = {
    'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
    'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
    'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
    'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
    'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
    'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
  };

  const syllables = pinyin.split(' ');
  return syllables.map(syllable => {
    let tone = 5; // デフォルト：軽声

    for (const [char, t] of Object.entries(toneMap)) {
      if (syllable.includes(char)) {
        tone = t;
        break;
      }
    }

    // XSS 対策：テキストノード経由でエスケープ
    const escaped = escapeHtml(syllable);
    return `<span class="tone-${tone}">${escaped}</span>`;
  }).join(' ');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Flashcard コントローラー ────────────────────────────────────────

export class Flashcard {
  /**
   * @param {HTMLElement} container - カードを描画するコンテナ要素
   * @param {{ onRated: (rating: number) => void }} callbacks
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this._flipped = false;
    this._gestureDetach = null;
    this._keyboardHandlers = null;
    this._currentWord = null;
    this._currentSRS = null;

    this._buildDOM();
  }

  // ─── DOM 構築 ───────────────────────────────────────────────────

  _buildDOM() {
    this.container.innerHTML = '';

    // セッション進捗バー
    this.progressBar = el('div', 'study-progress-bar');
    this.progressFill = el('div', 'study-progress-bar__fill');
    this.progressBar.appendChild(this.progressFill);
    this.container.appendChild(this.progressBar);

    // セッションヘッダー
    this.header = el('div', 'study-header');
    this.headerLeft = el('div', 'study-header__left');
    this.headerCenter = el('div', 'study-header__center');
    this.headerRight = el('div', 'study-header__right');
    this.header.appendChild(this.headerLeft);
    this.header.appendChild(this.headerCenter);
    this.header.appendChild(this.headerRight);
    this.container.appendChild(this.header);

    // カードシーン
    this.scene = el('div', 'card-scene');
    this.card = el('div', 'card');
    this.front = el('div', 'card__face card__face--front');
    this.back = el('div', 'card__face card__face--back');

    // スワイプインジケーター
    this.swipeRight = el('div', 'swipe-indicator swipe-indicator--right');
    this.swipeRight.textContent = '良い ✓';
    this.swipeLeft = el('div', 'swipe-indicator swipe-indicator--left');
    this.swipeLeft.textContent = 'もう一度 ✗';

    this.card.appendChild(this.front);
    this.card.appendChild(this.back);
    this.card.appendChild(this.swipeRight);
    this.card.appendChild(this.swipeLeft);
    this.scene.appendChild(this.card);
    this.container.appendChild(this.scene);

    // 評価ボタン
    this.ratingContainer = el('div', 'rating-container');
    this._buildRatingButtons();
    this.container.appendChild(this.ratingContainer);

    this._attachGestures();
  }

  _buildRatingButtons() {
    const ratings = [
      { key: 'again', label: 'もう一度', rating: RATING.AGAIN },
      { key: 'hard',  label: '難しい',   rating: RATING.HARD },
      { key: 'good',  label: '良い',     rating: RATING.GOOD },
      { key: 'easy',  label: '簡単',     rating: RATING.EASY },
    ];

    this.ratingButtons = {};
    for (const { key, label, rating } of ratings) {
      const btn = el('button', `rating-btn rating-btn--${key}`);
      const labelEl = el('span');
      labelEl.textContent = label;
      const intervalEl = el('span', 'rating-btn__interval');
      intervalEl.textContent = '';
      btn.appendChild(labelEl);
      btn.appendChild(intervalEl);
      btn.addEventListener('click', () => this._onRated(rating));
      btn.dataset.intervalEl = '';
      btn._intervalEl = intervalEl;
      this.ratingButtons[key] = btn;
      this.ratingContainer.appendChild(btn);
    }
  }

  _attachGestures() {
    if (this._gestureDetach) this._gestureDetach.detach();

    this._gestureDetach = attachGestures(this.card, {
      onTap: () => this._handleFlip(),
      onFlip: () => this._handleFlip(),
      onAgain: () => this._flipped && this._onRated(RATING.AGAIN),
      onGood: () => this._flipped && this._onRated(RATING.GOOD),
      onHard: () => this._flipped && this._onRated(RATING.HARD),
      onEasy: () => this._flipped && this._onRated(RATING.EASY),
      onDrag: (dx, dy) => this._onDrag(dx, dy),
    });
  }

  // ─── カード描画 ─────────────────────────────────────────────────

  /**
   * 単語を描画する
   * @param {object} wordData - 単語オブジェクト
   * @param {object|null} srsData - SRS データ（null = 新規）
   */
  render(wordData, srsData = null) {
    this._currentWord = wordData;
    this._currentSRS = srsData;
    this._flipped = false;

    // カードをリセット
    this.card.classList.remove('is-flipped', 'dismiss-right', 'dismiss-left');
    this.ratingContainer.classList.remove('visible');

    this._renderFront(wordData);
    this._renderBack(wordData, srsData);
    this._updateRatingIntervals(srsData);
  }

  _renderFront(word) {
    this.front.innerHTML = '';

    // メタ情報（カテゴリバッジ + カード番号）
    const meta = el('div', 'card__front-meta');
    const badge = el('span', 'card__badge');
    badge.textContent = word.category_label || word.category || '';
    const num = el('span', 'card__number');
    num.textContent = `#${word.id}`;
    meta.appendChild(badge);
    meta.appendChild(num);

    // 台湾特有フラグ
    if (word.taiwan_specific) {
      const twBadge = el('span', 'card__badge card__badge--taiwan');
      twBadge.textContent = '台湾特有';
      meta.insertBefore(twBadge, num);
    }

    // 漢字（大）
    const hanzi = el('div', 'card__hanzi-main hanzi');
    hanzi.textContent = word.hanzi;

    // ヒント
    const hint = el('div', 'card__hint');
    hint.innerHTML = `<span>タップして答えを見る</span>`;

    this.front.appendChild(meta);
    this.front.appendChild(hanzi);
    this.front.appendChild(hint);
  }

  _renderBack(word, srsData) {
    this.back.innerHTML = '';

    const backInner = el('div', 'card__back');

    // ヘッダー：漢字（小）+ ピンイン
    const header = el('div', 'card__back-header');
    const hanziSmall = el('div', 'card__hanzi-small hanzi');
    hanziSmall.textContent = word.hanzi;

    const pinyinEl = el('div', 'card__pinyin');
    pinyinEl.innerHTML = parsePinyinToHTML(word.pinyin);

    header.appendChild(hanziSmall);
    header.appendChild(pinyinEl);
    backInner.appendChild(header);

    // 日本語意味（大）
    const meaning = el('div', 'card__meaning');
    meaning.textContent = word.meaning_ja || word.meaning_en || '';
    backInner.appendChild(meaning);

    // 品詞
    if (word.part_of_speech) {
      const pos = el('div', 'text-muted text-sm');
      pos.textContent = word.part_of_speech;
      pos.style.marginBottom = 'var(--space-3)';
      backInner.appendChild(pos);
    }

    // 例文
    if (word.example_sentence?.hanzi) {
      const ex = el('div', 'card__example');
      const exHanzi = el('div', 'card__example-hanzi hanzi');
      exHanzi.textContent = word.example_sentence.hanzi;
      const exPinyin = el('div', 'card__example-pinyin');
      exPinyin.innerHTML = parsePinyinToHTML(word.example_sentence.pinyin || '');
      const exMeaning = el('div', 'card__example-meaning');
      exMeaning.textContent = word.example_sentence.meaning_ja || '';
      ex.appendChild(exHanzi);
      if (word.example_sentence.pinyin) ex.appendChild(exPinyin);
      ex.appendChild(exMeaning);
      backInner.appendChild(ex);
    }

    // メモ
    if (word.notes_ja) {
      const notes = el('div', 'card__notes');
      notes.textContent = word.notes_ja;
      backInner.appendChild(notes);
    }

    this.back.appendChild(backInner);
  }

  _updateRatingIntervals(srsData) {
    const intervals = previewIntervals(srsData);
    const keys = ['again', 'hard', 'good', 'easy'];
    const ratingKeys = [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY];

    keys.forEach((key, i) => {
      const btn = this.ratingButtons[key];
      if (btn && btn._intervalEl) {
        btn._intervalEl.textContent = intervalToLabel(intervals[ratingKeys[i]]);
      }
    });
  }

  // ─── フリップ ────────────────────────────────────────────────────

  _handleFlip() {
    if (!this._flipped) {
      this.flip();
    }
  }

  flip() {
    this._flipped = true;
    this.card.classList.add('is-flipped');
    this.ratingContainer.classList.add('visible');
  }

  // ─── ドラッグ視覚フィードバック ─────────────────────────────────

  _onDrag(dx, dy) {
    this.card.classList.remove('swipe-right', 'swipe-left', 'swipe-up');

    if (dx > 20) {
      this.card.classList.add('swipe-right');
      this.swipeRight.classList.add('visible');
      this.swipeLeft.classList.remove('visible');
    } else if (dx < -20) {
      this.card.classList.add('swipe-left');
      this.swipeLeft.classList.add('visible');
      this.swipeRight.classList.remove('visible');
    } else {
      this.swipeRight.classList.remove('visible');
      this.swipeLeft.classList.remove('visible');
    }
  }

  // ─── 評価 ────────────────────────────────────────────────────────

  _onRated(rating) {
    if (!this._flipped) return; // 裏面が見えていない場合は評価させない

    // 却下アニメーション
    const animClass = rating >= 2 ? 'dismiss-right' : 'dismiss-left';
    this.card.classList.add(animClass);
    this.ratingContainer.classList.remove('visible');
    this.swipeRight.classList.remove('visible');
    this.swipeLeft.classList.remove('visible');

    setTimeout(() => {
      this.callbacks.onRated?.(rating);
    }, 280);
  }

  // ─── プログレス更新 ─────────────────────────────────────────────

  updateProgress(current, total) {
    const pct = total > 0 ? (current / total) * 100 : 0;
    this.progressFill.style.width = `${pct}%`;
    this.headerCenter.textContent = total > 0 ? `${current} / ${total}` : '';
  }

  setHeaderLeft(html) {
    this.headerLeft.innerHTML = html;
  }

  setHeaderRight(html) {
    this.headerRight.innerHTML = html;
  }

  // ─── クリーンアップ ──────────────────────────────────────────────

  destroy() {
    this._gestureDetach?.detach();
    this.container.innerHTML = '';
  }
}

// ─── ユーティリティ ──────────────────────────────────────────────────

function el(tag, className = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
