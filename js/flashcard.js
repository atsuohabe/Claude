/**
 * flashcard.js - カード UI コントローラー
 * カードの描画、フリップアニメーション、声調カラー変換を担当する
 */

import { attachGestures } from './gestures.js';
import { Store } from './store.js';

// ─── 発声機能（Web Speech API） ──────────────────────────────────────

// Electron では voiceschanged が非同期で一度だけ発火する。
// モジュール読み込み時に getVoices() を呼んでロードを開始しておく。
if (window.speechSynthesis) {
  speechSynthesis.getVoices();
}

/**
 * 台湾華語（zh-TW）で指定テキストを読み上げる
 * @param {string} text - 読み上げるテキスト（漢字）
 */
export function speakWord(text) {
  if (!text || !window.speechSynthesis) return;
  const rate = Store.getSettings().ttsRate ?? 0.8;
  window.speechSynthesis.cancel();

  function speak() {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = rate;
    utterance.volume = 1.0;
    speechSynthesis.speak(utterance);
  }

  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    speak();
  } else {
    let spoken = false;
    function speakOnce() {
      if (spoken) return;
      spoken = true;
      speak();
    }
    speechSynthesis.addEventListener('voiceschanged', speakOnce, { once: true });
    // voiceschanged が既に発火済みの場合に備えて 200ms 間隔で最大 3 秒ポーリング
    let retries = 0;
    function poll() {
      if (spoken) return;
      if (speechSynthesis.getVoices().length > 0) {
        speakOnce();
      } else if (retries++ < 15) {
        setTimeout(poll, 200);
      }
    }
    setTimeout(poll, 200);
  }
}

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
    this.swipeRight.textContent = '覚えた ✓';
    this.swipeLeft = el('div', 'swipe-indicator swipe-indicator--left');
    this.swipeLeft.textContent = 'まだまだ ✗';

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
      { key: 'not-yet',    label: 'まだまだ' },
      { key: 'remembered', label: '覚えた' },
    ];

    this.ratingButtons = {};
    for (const { key, label } of ratings) {
      const btn = el('button', `rating-btn rating-btn--${key}`);
      btn.textContent = label;
      btn.addEventListener('click', () => this._onRated(key));
      this.ratingButtons[key] = btn;
      this.ratingContainer.appendChild(btn);
    }
  }

  _attachGestures() {
    if (this._gestureDetach) this._gestureDetach.detach();

    this._gestureDetach = attachGestures(this.card, {
      onTap: () => this._handleFlip(),
      onFlip: () => this._handleFlip(),
      onRemembered: () => this._flipped && this._onRated('remembered'),
      onNotYet: () => this._flipped && this._onRated('not-yet'),
      onDrag: (dx, dy) => this._onDrag(dx, dy),
    });
  }

  // ─── カード描画 ─────────────────────────────────────────────────

  /**
   * 単語を描画する
   * @param {object} wordData - 単語オブジェクト
   * @param {object|null} srsData - SRS データ（null = 新規）
   * @param {boolean} isNew - 新規カードかどうか（false = 復習カード）
   */
  render(wordData, srsData = null, isNew = true) {
    this._currentWord = wordData;
    this._currentSRS = srsData;
    this._flipped = false;
    this._isNew = isNew;

    // カードをリセット
    this.card.classList.remove('is-flipped', 'dismiss-right', 'dismiss-left');
    this.ratingContainer.classList.remove('visible');

    this._renderFront(wordData);
    this._renderBack(wordData, srsData);

    // 新規カードは表面表示時に自動発音（設定が有効な場合）
    if (isNew && Store.getSettings().autoplayAudio) {
      setTimeout(() => speakWord(wordData?.hanzi), 300);
    }
  }

  _renderFront(word) {
    this.front.innerHTML = '';

    // メタ情報（カード番号のみ、カテゴリバッジは非表示）
    const meta = el('div', 'card__front-meta');
    const num = el('span', 'card__number');
    num.textContent = `#${word.id}`;
    meta.appendChild(num);

    // 台湾特有フラグ
    if (word.taiwan_specific) {
      const twBadge = el('span', 'card__badge card__badge--taiwan');
      twBadge.textContent = '台湾特有';
      meta.insertBefore(twBadge, num);
    }

    // 漢字（大）- 文字数に応じてフォントサイズを調整
    const hanzi = el('div', 'card__hanzi-main hanzi');
    hanzi.textContent = word.hanzi;
    const len = (word.hanzi || '').length;
    if (len === 1) {
      hanzi.style.fontSize = 'clamp(72px, 18vw, 96px)';
    } else if (len <= 2) {
      hanzi.style.fontSize = 'clamp(60px, 14vw, 80px)';
    } else if (len <= 4) {
      hanzi.style.fontSize = 'clamp(44px, 11vw, 60px)';
    } else if (len <= 6) {
      hanzi.style.fontSize = 'clamp(36px, 9vw, 48px)';
      hanzi.style.whiteSpace = 'normal';
    } else {
      hanzi.style.fontSize = 'clamp(32px, 8vw, 42px)';
      hanzi.style.whiteSpace = 'normal';
    }

    // ヒント
    const hint = el('div', 'card__hint');
    hint.innerHTML = `<span>タップして答えを見る</span>`;

    this.front.appendChild(meta);
    this.front.appendChild(hanzi);

    // ピンイン（表面）：新規カードのみ表示、復習では非表示
    if (this._isNew) {
      const pinyinEl = el('div', 'card__pinyin card__pinyin--front');
      pinyinEl.innerHTML = parsePinyinToHTML(word.pinyin);
      this.front.appendChild(pinyinEl);
    }

    this.front.appendChild(hint);
  }

  _renderBack(word, srsData) {
    this.back.innerHTML = '';

    const backInner = el('div', 'card__back');

    // 漢字（小、中央）
    const hanziSmall = el('div', 'card__hanzi-small hanzi');
    hanziSmall.textContent = word.hanzi;
    backInner.appendChild(hanziSmall);

    // ピンイン（中央）
    const pinyinEl = el('div', 'card__pinyin');
    pinyinEl.innerHTML = parsePinyinToHTML(word.pinyin);
    backInner.appendChild(pinyinEl);

    // 発声ボタン（表面から移動）
    const speakBtn = el('button', 'speak-btn');
    speakBtn.setAttribute('aria-label', '発音を聴く');
    speakBtn.setAttribute('title', '発音を聴く');
    speakBtn.textContent = '🔊';
    speakBtn.addEventListener('click', () => speakWord(word.hanzi));
    backInner.appendChild(speakBtn);

    // 日本語意味（大、中央）
    const meaning = el('div', 'card__meaning');
    meaning.textContent = word.meaning_ja || '';
    backInner.appendChild(meaning);

    // 英語意味（直下、小さめ）
    if (word.meaning_en) {
      const meaningEn = el('div', 'card__meaning-en');
      meaningEn.textContent = word.meaning_en;
      backInner.appendChild(meaningEn);
    }

    // 品詞
    if (word.part_of_speech) {
      const pos = el('div', 'text-muted text-sm');
      pos.textContent = word.part_of_speech;
      pos.style.marginTop = 'var(--space-2)';
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
    // 自動読み上げ（設定で有効な場合、フリップアニメーション後）
    if (Store.getSettings().autoplayAudio) {
      setTimeout(() => speakWord(this._currentWord?.hanzi), 150);
    }
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
    const animClass = rating === 'remembered' ? 'dismiss-right' : 'dismiss-left';
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
