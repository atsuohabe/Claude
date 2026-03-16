/**
 * stats.js - 統計計算・描画
 * 学習履歴の集計、ヒートマップ、予測グラフを担当する
 */

import { Store } from './store.js';
import { getMasteredCount, getLearningCount, getCardStateCounts, getForecast } from './srs.js';
import { animateCounter } from './ui.js';
import { Vocab } from './vocab.js';

// ─── 統計集計 ────────────────────────────────────────────────────────

/**
 * ダッシュボード用の概要統計を返す
 */
export function getOverview() {
  const mastered = getMasteredCount();
  const learning = getLearningCount();
  const allCards = Store.getAllCards();
  const totalSeen = Object.keys(allCards).length;
  const totalWords = Vocab.getLoadedCount() || 160;
  const notStarted = totalWords - totalSeen;

  return {
    mastered,
    learning,
    totalSeen,
    total: totalWords,
    notStarted: Math.max(0, notStarted),
    percentage: Math.round((mastered / totalWords) * 100),
  };
}

/**
 * 保持率（正解率）を返す - 直近30日
 */
export function getRetentionRate() {
  const history = Store.getHistory();
  const recent = history.slice(-30);
  if (recent.length === 0) return 0;

  const totalReviewed = recent.reduce((s, r) => s + (r.reviewed || 0), 0);
  const totalCorrect = recent.reduce((s, r) => s + (r.correct || 0), 0);

  return totalReviewed > 0 ? Math.round((totalCorrect / totalReviewed) * 100) : 0;
}

/**
 * ストリーク情報を返す
 */
export function getStreakInfo() {
  return Store.getStreak();
}

/**
 * 総学習時間（分）を返す
 */
export function getTotalStudyMinutes() {
  const history = Store.getHistory();
  const totalMs = history.reduce((s, r) => s + (r.timeMs || 0), 0);
  return Math.round(totalMs / 60000);
}

/**
 * 過去365日分のヒートマップデータを返す
 * @returns {{ date: string, count: number, level: number }[]}
 */
export function getHeatmapData() {
  const history = Store.getHistory();
  const map = {};

  for (const record of history) {
    const day = new Date(record.date).toDateString();
    if (!map[day]) map[day] = 0;
    map[day] += record.reviewed || 0;
  }

  const result = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toDateString();
    const count = map[key] || 0;
    result.push({
      date: d.toISOString(),
      count,
      level: count === 0 ? 0 : count < 10 ? 1 : count < 25 ? 2 : count < 50 ? 3 : 4,
    });
  }

  return result;
}

// ─── 描画 ────────────────────────────────────────────────────────────

/**
 * 統計ページを描画する
 * @param {HTMLElement} container
 */
export function renderStats(container) {
  const overview = getOverview();
  const retention = getRetentionRate();
  const streak = getStreakInfo();
  const totalMin = getTotalStudyMinutes();
  const stateCounts = getCardStateCounts();
  const forecast = getForecast(14);

  container.innerHTML = '';

  // ─── 概要グリッド ───────────────────────────────────────────
  const grid = _el('div', 'stats-grid');
  grid.style.marginBottom = 'var(--space-6)';

  _appendStatTile(grid, String(overview.totalSeen), '覚えた語数');
  _appendStatTile(grid, String(overview.mastered), '習得済み語数');
  _appendStatTile(grid, `${streak.current}日`, '現在のストリーク');
  _appendStatTile(grid, `${totalMin}分`, '総学習時間');

  container.appendChild(grid);

  // ─── カード状態の内訳 ────────────────────────────────────────
  const stateCard = _el('div', 'surface-card');
  stateCard.style.marginBottom = 'var(--space-4)';

  const stateTitle = _el('h3', 'section-title');
  stateTitle.textContent = 'カード状態の内訳';
  stateTitle.style.marginBottom = 'var(--space-4)';
  stateCard.appendChild(stateTitle);

  const stateDefs = [
    { key: 'new',      label: '未学習',         color: '#E0E0E0' },
    { key: 'learning', label: '学習中',         color: '#9E9E9E' },
    { key: 'young',    label: '覚えた（練習中）', color: '#616161' },
    { key: 'mature',   label: '習得済み',        color: '#212121' },
    { key: 'burned',   label: '完全定着',        color: '#000000' },
  ];

  const total = Object.values(stateCounts).reduce((a, b) => a + b, 0) || 1;

  const legend = _el('div', 'donut-legend');
  for (const def of stateDefs) {
    const count = stateCounts[def.key] || 0;
    const pct = Math.round((count / total) * 100);
    const item = _el('div', 'donut-legend__item');

    const dot = _el('div', 'donut-legend__dot');
    dot.style.background = def.color;

    const label = _el('span');
    label.textContent = def.label;

    const bar = _el('div', 'progress-bar');
    bar.style.flex = '1';
    bar.style.margin = '0 var(--space-3)';
    const fill = _el('div', 'progress-bar__fill');
    fill.style.width = `${pct}%`;
    fill.style.background = def.color;
    bar.appendChild(fill);

    const countEl = _el('span', 'donut-legend__count');
    countEl.textContent = count;

    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(bar);
    item.appendChild(countEl);
    legend.appendChild(item);
  }

  stateCard.appendChild(legend);
  container.appendChild(stateCard);

  // ─── 予測グラフ ──────────────────────────────────────────────
  const forecastCard = _el('div', 'surface-card');
  forecastCard.style.marginBottom = 'var(--space-4)';

  const forecastTitle = _el('h3', 'section-title');
  forecastTitle.textContent = '今後14日間の予測復習数';
  forecastTitle.style.marginBottom = 'var(--space-4)';
  forecastCard.appendChild(forecastTitle);

  const maxCount = Math.max(...forecast.map(f => f.count), 1);
  const chartEl = _el('div', 'forecast-chart');

  for (let i = 0; i < forecast.length; i++) {
    const { date, count } = forecast[i];
    const bar = _el('div', 'forecast-bar');
    if (i === 0) bar.classList.add('today');
    bar.style.height = `${Math.max(2, (count / maxCount) * 100)}%`;
    bar.title = `${new Date(date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}: ${count}件`;
    chartEl.appendChild(bar);
  }

  forecastCard.appendChild(chartEl);

  // 日付ラベル（0, 7, 13日目）
  const labels = _el('div', 'text-xs text-muted');
  labels.style.display = 'flex';
  labels.style.justifyContent = 'space-between';
  labels.style.marginTop = 'var(--space-1)';
  labels.textContent = '今日';
  const midLabel = _el('span');
  midLabel.textContent = '7日後';
  const endLabel = _el('span');
  endLabel.textContent = '14日後';
  labels.appendChild(midLabel);
  labels.appendChild(endLabel);
  forecastCard.appendChild(labels);
  container.appendChild(forecastCard);

  // ─── ヒートマップ ────────────────────────────────────────────
  const heatCard = _el('div', 'surface-card');

  const heatTitle = _el('h3', 'section-title');
  heatTitle.textContent = '学習カレンダー（過去1年）';
  heatTitle.style.marginBottom = 'var(--space-4)';
  heatCard.appendChild(heatTitle);

  const heatData = getHeatmapData();
  const heatGrid = _el('div', 'heatmap');

  // 最初の日の曜日（0=日〜6=土）に合わせて空セルで埋める
  const firstDate = new Date(heatData[0].date);
  const startDow = firstDate.getDay(); // 0(日)〜6(土)
  for (let i = 0; i < startDow; i++) {
    heatGrid.appendChild(_el('div', 'heatmap__cell heatmap__cell--empty'));
  }

  for (const cell of heatData) {
    const c = _el('div', 'heatmap__cell');
    c.dataset.level = cell.level;
    const d = new Date(cell.date);
    c.title = `${d.toLocaleDateString('ja-JP')}: ${cell.count}件`;
    heatGrid.appendChild(c);
  }

  heatCard.appendChild(heatGrid);

  // 凡例
  const heatLegend = _el('div', 'text-xs text-muted');
  heatLegend.style.display = 'flex';
  heatLegend.style.alignItems = 'center';
  heatLegend.style.gap = 'var(--space-2)';
  heatLegend.style.marginTop = 'var(--space-3)';
  heatLegend.innerHTML = `少ない
    <div class="heatmap__cell" style="width:12px;height:12px;display:inline-block;" data-level="0"></div>
    <div class="heatmap__cell" style="width:12px;height:12px;display:inline-block;" data-level="1"></div>
    <div class="heatmap__cell" style="width:12px;height:12px;display:inline-block;" data-level="2"></div>
    <div class="heatmap__cell" style="width:12px;height:12px;display:inline-block;" data-level="3"></div>
    <div class="heatmap__cell" style="width:12px;height:12px;display:inline-block;" data-level="4"></div>
    多い`;
  heatCard.appendChild(heatLegend);
  container.appendChild(heatCard);
}

/**
 * プログレスリングを更新する
 * @param {SVGElement} svg
 * @param {{ mastered: number, learning: number }} counts
 */
export function updateProgressRing(svg, { mastered, learning, totalSeen }) {
  const TOTAL = Vocab.getLoadedCount() || 160;
  const CIRCUMFERENCE = 2 * Math.PI * 52; // r=52

  const masteredPct = Math.min(mastered / TOTAL, 1);
  const learningPct = Math.min(learning / TOTAL, 1 - masteredPct);

  const masteredTrack = svg.querySelector('.progress-ring__track--mastered');
  const learningTrack = svg.querySelector('.progress-ring__track--learning');

  if (masteredTrack) {
    masteredTrack.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
    masteredTrack.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - masteredPct)}`;
  }
  if (learningTrack) {
    learningTrack.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
    learningTrack.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - learningPct)}`;
    // 成熟アークの後ろに配置するため回転オフセット
    learningTrack.style.transform = `rotate(${masteredPct * 360}deg)`;
    learningTrack.style.transformOrigin = '60px 60px';
  }

  // 中央には「覚えた」総数（学習中 + 習得済み）を表示
  const numberEl = svg.querySelector('.progress-ring__number');
  if (numberEl) {
    animateCounter(numberEl, 0, totalSeen ?? mastered, 800);
  }
}

// ─── ユーティリティ ──────────────────────────────────────────────────

function _el(tag, className = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function _appendStatTile(parent, number, label, color) {
  const tile = _el('div', 'stat-tile');
  const numEl = _el('div', 'stat-tile__number');
  numEl.textContent = number;
  if (color) numEl.style.color = color;
  const labelEl = _el('div', 'stat-tile__label');
  labelEl.textContent = label;
  tile.appendChild(numEl);
  tile.appendChild(labelEl);
  parent.appendChild(tile);
  return tile;
}
