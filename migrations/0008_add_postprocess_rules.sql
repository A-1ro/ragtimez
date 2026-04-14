-- カタカナ音写辞書: 誤表記→正表記の置換ルール
CREATE TABLE IF NOT EXISTS postprocess_katakana (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wrong_form TEXT NOT NULL UNIQUE,
  correct_form TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 禁止フレーズ: 検出時に警告するパターン
CREATE TABLE IF NOT EXISTS postprocess_banned_phrases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL DEFAULT 'warn',
  suggestion TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 初期データ: カタカナ辞書
INSERT INTO postprocess_katakana (wrong_form, correct_form, note) VALUES
  ('エントープライズ', 'エンタープライズ', 'enterprise'),
  ('ガートウェイ', 'ゲートウェイ', 'gateway'),
  ('ソーバー', 'ソブリン', 'sovereign'),
  ('ソバリン', 'ソブリン', 'sovereign'),
  ('セキュリティー', 'セキュリティ', 'security (長音不要)'),
  ('アーキテクチャー', 'アーキテクチャ', 'architecture (長音不要)');

-- 初期データ: 禁止フレーズ
INSERT INTO postprocess_banned_phrases (pattern, severity, suggestion) VALUES
  ('必要がある', 'warn', '具体的な手段・手順に置き換える'),
  ('必要である', 'warn', '具体的な手段・手順に置き換える'),
  ('不可欠', 'warn', '具体的な理由・代替策を記述する'),
  ('ができます', 'warn', '主語を明確にし能動態で書く'),
  ('することができ', 'warn', '主語を明確にし能動態で書く'),
  ('することが重要', 'warn', '具体的なアクションに置き換える'),
  ('を向上させる', 'warn', '具体的な改善内容を記述する'),
  ('重要な役割', 'warn', '具体的な機能・効果を記述する');
