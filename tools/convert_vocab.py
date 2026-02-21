#!/usr/bin/env python3
"""
Excel (TOCFL 華語八千詞) → vocab JSON 変換スクリプト
使い方:
  python3 tools/convert_vocab.py
      --xlsx data/vocab.xlsx          # Excelファイルのパス（デフォルト）
      --sheet "準備級一級"              # 対象シート名（省略時は全シート）
      --out  data/vocab-core.json     # 出力ファイル（省略時は自動分割）
"""
import argparse, json, sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl が必要です: pip install openpyxl")

# ────────────────────────────────────────────────
# 設定
# ────────────────────────────────────────────────
TAIWAN_CATS = {"taiwan_specific"}

# TOCFL シート名 → difficulty 数値
LEVEL_MAP: dict[str, int] = {
    "準備級一級": 1, "準備級二級": 1,
    "novice1": 1, "novice 1": 1, "novice2": 1, "novice 2": 1,
    "入門級": 1, "入門": 1, "基礎級": 1, "基礎": 1,
    "a1": 1, "a2": 1,
    "進階級": 2, "b1": 2, "b2": 2,
    "高階級": 3, "c1": 3, "c2": 3,
    "進階": 2, "高階": 3,
}

# 声調記号 → (基母音, 声調番号)
# ブレーブ記号（旧式）とカロン記号（現代標準）の両方をサポート
DIACRITIC_TABLE: dict[str, tuple[str, str]] = {
    # 現代標準ピンイン（カロン）
    'ā':('a','1'), 'á':('a','2'), 'ǎ':('a','3'), 'à':('a','4'),
    'ē':('e','1'), 'é':('e','2'), 'ě':('e','3'), 'è':('e','4'),
    'ī':('i','1'), 'í':('i','2'), 'ǐ':('i','3'), 'ì':('i','4'),
    'ō':('o','1'), 'ó':('o','2'), 'ǒ':('o','3'), 'ò':('o','4'),
    'ū':('u','1'), 'ú':('u','2'), 'ǔ':('u','3'), 'ù':('u','4'),
    'ǖ':('ü','1'), 'ǘ':('ü','2'), 'ǚ':('ü','3'), 'ǜ':('ü','4'),
    # ブレーブ記号（旧式・TOCFL Excelで使用）→ 第3声として扱う
    'ă':('a','3'), 'ĕ':('e','3'), 'ĭ':('i','3'),
    'ŏ':('o','3'), 'ŭ':('u','3'),
}

# ブレーブ → カロン変換テーブル（piyin正規化用）
BREVE_TO_CARON = str.maketrans({
    'ă': 'ǎ', 'ĕ': 'ě', 'ĭ': 'ǐ', 'ŏ': 'ǒ', 'ŭ': 'ǔ',
})

def normalize_pinyin(pinyin: str) -> str:
    """ブレーブ記号をカロン記号に正規化してピンインを標準化する"""
    return pinyin.translate(BREVE_TO_CARON)

def to_pinyin_tones(pinyin: str) -> str:
    """nǐ hǎo → ni3 hao3"""
    result = []
    for syllable in pinyin.split():
        tone = "5"
        cleaned = ""
        for ch in syllable:
            if ch in DIACRITIC_TABLE:
                base, t = DIACRITIC_TABLE[ch]
                cleaned += base
                tone = t
            else:
                cleaned += ch
        result.append(cleaned + tone)
    return " ".join(result)

# TOCFL 任務領域（コンテキスト）→ カテゴリID マッピング
CONTEXT_TO_CATEGORY: dict[str, str] = {
    "個人資料": "family",
    "家庭": "family",
    "家人": "family",
    "人際關係": "family",
    "食物": "food",
    "飲食": "food",
    "食": "food",
    "購物": "shopping",
    "商業": "shopping",
    "交通": "transport",
    "旅遊": "transport",
    "旅行": "transport",
    "教育": "education_work",
    "工作": "education_work",
    "娛樂": "entertainment",
    "休閒": "entertainment",
    "身體": "body",
    "健康": "body",
    "衣服": "clothing",
    "服飾": "clothing",
    "住家": "home_furniture",
    "居家": "home_furniture",
    "時間": "daily_time",
    "日常": "daily_time",
    "數字": "numbers",
    "量詞": "numbers",
    "感情": "emotions",
    "情感": "emotions",
}

def context_to_category(context: str) -> str:
    """任務領域（コンテキスト）をカテゴリIDに変換する"""
    for key, cat in CONTEXT_TO_CATEGORY.items():
        if key in context:
            return cat
    return "greetings"  # デフォルト

# 詞類（品詞）→ part_of_speech マッピング
POS_MAP: dict[str, str] = {
    "n": "noun", "v": "verb", "a": "adjective", "adv": "adverb",
    "prep": "preposition", "conj": "conjunction", "int": "interjection",
    "pron": "pronoun", "m": "classifier", "aux": "auxiliary",
    "adj": "adjective", "num": "number",
}

def map_pos(raw_pos: str) -> str:
    """品詞コード（N, V, A 等）を英語に変換する"""
    return POS_MAP.get(raw_pos.lower().strip(), "noun")

def sheet_difficulty(sheet_name: str) -> int:
    key = sheet_name.strip().lower()
    for k, v in LEVEL_MAP.items():
        if k.lower() == key or k.lower() in key:
            return v
    return 2  # デフォルト

# ────────────────────────────────────────────────
# ヘッダー解析
# ────────────────────────────────────────────────
HANZI_ALIASES  = ["hanzi", "漢字", "繁体字", "中文", "華語", "詞語", "詞彙", "vocabulary"]
PINYIN_ALIASES = ["pinyin", "拼音", "ピンイン", "漢語拼音"]
JA_ALIASES     = ["meaning_ja", "日本語", "日本語意味", "意味(日)", "和訳", "japanese"]
EN_ALIASES     = ["meaning_en", "english", "英語", "英語意味", "英訳"]
CAT_ALIASES    = ["category", "カテゴリ", "分類", "任務領域", "context", "domain"]
POS_ALIASES    = ["品詞", "詞類", "part", "parts of speech", "pos"]

def _normalize_header(h: str) -> str:
    """複数行ヘッダー（改行含む）を正規化：最初の行のみ取得・小文字化・空白除去"""
    return h.split('\n')[0].strip().lower()

def find_col(header: list[str], aliases: list[str]) -> int | None:
    for alias in aliases:
        for i, h in enumerate(header):
            if alias.lower() == _normalize_header(h):
                return i
    return None

def parse_sheet(sheet, difficulty: int, start_id: int) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []

    # ヘッダー行を探す（最初の5行以内）
    header_idx = 0
    for idx, row in enumerate(rows[:5]):
        cells = [_normalize_header(str(c)) if c else "" for c in row]
        if any(a.lower() in cells for a in HANZI_ALIASES):
            header_idx = idx
            break

    header = [str(c).strip() if c else "" for c in rows[header_idx]]

    ci_hanzi  = find_col(header, HANZI_ALIASES)
    ci_pinyin = find_col(header, PINYIN_ALIASES)
    ci_ja     = find_col(header, JA_ALIASES)
    ci_en     = find_col(header, EN_ALIASES)
    ci_cat    = find_col(header, CAT_ALIASES)
    ci_pos    = find_col(header, POS_ALIASES)

    if ci_hanzi is None:
        print(f"  ⚠️  漢字列が見つかりません（シート: {sheet.title}）。スキップします。")
        print(f"     ヘッダー: {[_normalize_header(h) for h in header]}")
        return []

    def cell(row, idx) -> str:
        if idx is None or idx >= len(row) or row[idx] is None:
            return ""
        return str(row[idx]).strip()

    words = []
    word_id = start_id
    for row in rows[header_idx + 1:]:
        if not row:
            continue
        hanzi = cell(row, ci_hanzi)
        if not hanzi:
            continue

        context = cell(row, ci_cat) or ""
        raw_pos = cell(row, ci_pos) or ""
        pinyin_raw = cell(row, ci_pinyin)
        # ブレーブ→カロン正規化
        pinyin = normalize_pinyin(pinyin_raw) if pinyin_raw else ""

        words.append({
            "id": word_id,
            "hanzi": hanzi,
            "pinyin": pinyin,
            "pinyin_tones": to_pinyin_tones(pinyin) if pinyin else "",
            "meaning_ja": cell(row, ci_ja),
            "meaning_en": cell(row, ci_en),
            "part_of_speech": map_pos(raw_pos) if raw_pos else "noun",
            "category": context_to_category(context),
            "category_label": context,
            "frequency_rank": word_id,
            "difficulty": difficulty,
            "example_sentence": {"hanzi": "", "pinyin": "", "meaning_ja": ""},
            "notes_ja": "",
            "taiwan_specific": False,
        })
        word_id += 1

    return words

# ────────────────────────────────────────────────
# メイン
# ────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Excel → vocab JSON 変換")
    parser.add_argument("--xlsx",  default="data/vocab.xlsx",      help="Excelファイルのパス")
    parser.add_argument("--sheet", default=None,                   help="対象シート名（省略時は全シート）")
    parser.add_argument("--out",   default=None,                   help="出力JSONパス（省略時は自動分割）")
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx)
    if not xlsx_path.exists():
        sys.exit(f"❌  Excelファイルが見つかりません: {xlsx_path}\n"
                 f"   {xlsx_path} に配置してください。")

    print(f"📂  {xlsx_path} を読み込み中...")
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)

    print(f"   シート一覧: {wb.sheetnames}")

    words: list[dict] = []
    word_id = 1

    for sheet in wb.worksheets:
        if args.sheet and sheet.title != args.sheet:
            continue
        diff = sheet_difficulty(sheet.title)
        print(f"   処理中: 「{sheet.title}」 (difficulty={diff})")
        sheet_words = parse_sheet(sheet, diff, word_id)
        print(f"   → {len(sheet_words)} 語")
        words.extend(sheet_words)
        word_id += len(sheet_words)

    wb.close()

    if not words:
        sys.exit("❌  単語が1件も取得できませんでした。\n"
                 "   --sheet でシート名を指定するか、ヘッダー列名を確認してください。")

    print(f"\n合計 {len(words)} 語を読み込みました")

    out_dir = Path("data")

    if args.out:
        # 単一ファイル出力
        out_path = Path(args.out)
        out_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✅  {out_path}: {len(words)} 語")
    else:
        # 自動分割: 1-300, 301-600, 601+
        chunks = [
            ("vocab-core.json",     words[:300]),
            ("vocab-everyday.json", words[300:600]),
            ("vocab-advanced.json", words[600:]),
        ]
        for fname, chunk in chunks:
            if chunk:
                path = out_dir / fname
                path.write_text(json.dumps(chunk, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"✅  {path}: {len(chunk)} 語")


if __name__ == "__main__":
    main()
