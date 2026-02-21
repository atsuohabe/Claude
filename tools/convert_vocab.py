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
    "入門": 1, "基礎": 1,
    "a1": 1, "a2": 1,
    "b1": 2, "b2": 2,
    "c1": 3, "c2": 3,
    "進階": 2, "高階": 3,
}

# 声調記号 → (基母音, 声調番号)
DIACRITIC_TABLE: dict[str, tuple[str, str]] = {
    'ā':('a','1'), 'á':('a','2'), 'ǎ':('a','3'), 'à':('a','4'),
    'ē':('e','1'), 'é':('e','2'), 'ě':('e','3'), 'è':('e','4'),
    'ī':('i','1'), 'í':('i','2'), 'ǐ':('i','3'), 'ì':('i','4'),
    'ō':('o','1'), 'ó':('o','2'), 'ǒ':('o','3'), 'ò':('o','4'),
    'ū':('u','1'), 'ú':('u','2'), 'ǔ':('u','3'), 'ù':('u','4'),
    'ǖ':('ü','1'), 'ǘ':('ü','2'), 'ǚ':('ü','3'), 'ǜ':('ü','4'),
}

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

CATEGORY_POS: dict[str, str] = {
    "basic_verbs": "verb",
    "adjectives": "adjective",
    "numbers": "number",
    "greetings": "interjection",
}

def guess_pos(category: str) -> str:
    return CATEGORY_POS.get(category, "noun")

def sheet_difficulty(sheet_name: str) -> int:
    key = sheet_name.strip().lower()
    for k, v in LEVEL_MAP.items():
        if k.lower() == key or k.lower() in key:
            return v
    return 2  # デフォルト

# ────────────────────────────────────────────────
# ヘッダー解析
# ────────────────────────────────────────────────
HANZI_ALIASES  = ["hanzi", "漢字", "繁体字", "中文", "華語", "詞語"]
PINYIN_ALIASES = ["pinyin", "拼音", "ピンイン"]
JA_ALIASES     = ["meaning_ja", "日本語", "日本語意味", "意味(日)", "和訳"]
EN_ALIASES     = ["meaning_en", "english", "英語", "英語意味", "英訳"]
CAT_ALIASES    = ["category", "カテゴリ", "分類", "品詞", "詞類"]

def find_col(header: list[str], aliases: list[str]) -> int | None:
    for alias in aliases:
        for i, h in enumerate(header):
            if alias.lower() == h.lower().strip():
                return i
    return None

def parse_sheet(sheet, difficulty: int, start_id: int) -> list[dict]:
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []

    # ヘッダー行を探す（最初の5行以内）
    header_idx = 0
    for idx, row in enumerate(rows[:5]):
        cells = [str(c).lower().strip() if c else "" for c in row]
        if any(a.lower() in cells for a in HANZI_ALIASES):
            header_idx = idx
            break

    header = [str(c).strip() if c else "" for c in rows[header_idx]]

    ci_hanzi  = find_col(header, HANZI_ALIASES)
    ci_pinyin = find_col(header, PINYIN_ALIASES)
    ci_ja     = find_col(header, JA_ALIASES)
    ci_en     = find_col(header, EN_ALIASES)
    ci_cat    = find_col(header, CAT_ALIASES)

    if ci_hanzi is None:
        print(f"  ⚠️  漢字列が見つかりません（シート: {sheet.title}）。スキップします。")
        print(f"     ヘッダー: {header}")
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

        cat    = cell(row, ci_cat) or "greetings"
        pinyin = cell(row, ci_pinyin)

        words.append({
            "id": word_id,
            "hanzi": hanzi,
            "pinyin": pinyin,
            "pinyin_tones": to_pinyin_tones(pinyin) if pinyin else "",
            "meaning_ja": cell(row, ci_ja),
            "meaning_en": cell(row, ci_en),
            "part_of_speech": guess_pos(cat),
            "category": cat,
            "frequency_rank": word_id,
            "difficulty": difficulty,
            "example_sentence": {"hanzi": "", "pinyin": "", "meaning_ja": ""},
            "notes_ja": "",
            "taiwan_specific": cat in TAIWAN_CATS,
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
