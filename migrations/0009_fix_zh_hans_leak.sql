-- 簡体字混入の修正: Workers AI フォールバック(Qwen)が稀に日本語の漢字の代わりに
-- 簡体字を出力する事例が確認された（例: 2026-07-08 記事「生产環境」）。
-- 「产」は日本語の正字（産）に対応する簡体字であり、日本語の文章に単独で出現することはないため、
-- 既存の postprocess_katakana 置換テーブルに追加して機械的に修正する。
INSERT OR IGNORE INTO postprocess_katakana (wrong_form, correct_form, note) VALUES
  ('生产環境', '本番環境', 'simplified Chinese character leak (产→産) from Qwen fallback model; IT context uses 本番環境'),
  ('产', '産', 'simplified Chinese character (产) leaking into Japanese text; correct Japanese form is 産');
