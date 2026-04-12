/**
 * Tavily API クライアント
 *
 * Tavily の /search（URL発見＋コンテンツ取得）と /extract（指定URL本文抽出）を
 * Cloudflare Workers 環境（fetch API のみ）で使用するための薄いラッパー。
 *
 * 両関数ともエラー時は例外を投げず空配列を返す。
 * 呼び出し元は TAVILY_API_KEY が未設定の場合はそもそも呼び出さないこと。
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface TavilySearchResult {
  /** 記事 URL */
  url: string;
  /** 記事タイトル */
  title: string;
  /**
   * Tavily が返す抜粋テキスト（通常 200〜500 文字程度）。
   * include_raw_content: false の場合に返されるフィールド。
   */
  content: string;
  /** Tavily の関連スコア (0.0〜1.0) */
  score: number;
}

export interface TavilyExtractResult {
  /** 記事 URL */
  url: string;
  /**
   * Tavily が返すフルテキスト（HTML → プレーンテキスト変換済み）。
   * 本文全体が入るため、コンテキストに組み込む前にトリミングが必要。
   */
  raw_content: string;
}

// ---------------------------------------------------------------------------
// 内部型（API レスポンスの生の形）
// ---------------------------------------------------------------------------

interface TavilySearchApiResponse {
  results?: Array<{
    url: string;
    title: string;
    content: string;
    score: number;
  }>;
  error?: string;
}

interface TavilyExtractApiResponse {
  results?: Array<{
    url: string;
    raw_content: string;
  }>;
  failed_results?: Array<{ url: string; error: string }>;
  error?: string;
}

// ---------------------------------------------------------------------------
// パブリック関数
// ---------------------------------------------------------------------------

/**
 * Tavily /search — 複数クエリを並列実行し、URL＋抜粋を返す。
 *
 * @param apiKey   Tavily API キー（TAVILY_API_KEY）
 * @param queries  検索クエリの配列（例: ["Azure AI latest", "OpenAI API changes"]）
 * @returns        URL重複排除済みの検索結果。エラー時は空配列。
 */
export async function tavilySearch(
  apiKey: string,
  queries: string[],
): Promise<TavilySearchResult[]> {
  if (queries.length === 0) return [];

  // 複数クエリを並列実行
  const requests = queries.map((query) =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Tavily は Authorization ヘッダーではなくボディで API キーを受け取る
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        // コスト節約: フルテキストは /extract で取得するため不要
        include_raw_content: false,
      }),
    }).then(async (res): Promise<TavilySearchResult[]> => {
      // 429 (rate limit) / 5xx はフォールバックとして空配列を返す
      if (!res.ok) {
        console.warn(`Tavily search failed for query "${query}": HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as TavilySearchApiResponse;
      if (!data.results) return [];
      return data.results.map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content,
        score: r.score,
      }));
    }).catch((err: unknown) => {
      // ネットワークエラー等
      console.warn(
        `Tavily search error for query "${query}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return [] as TavilySearchResult[];
    }),
  );

  const resultsPerQuery = await Promise.all(requests);

  // 全クエリの結果をフラット化し、URL で重複排除（先着優先）
  const seen = new Set<string>();
  const merged: TavilySearchResult[] = [];
  for (const results of resultsPerQuery) {
    for (const result of results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
  }

  return merged;
}

/**
 * Tavily /extract — 指定 URL のページ本文をフルテキストで取得する。
 *
 * Tavily の extract エンドポイントは一度に最大 20 URL を受け取るが、
 * 安全のため 10 件に制限する（無料枠の節約）。
 *
 * @param apiKey  Tavily API キー（TAVILY_API_KEY）
 * @param urls    本文を取得したい URL の配列（上限 10 件に切り詰め）
 * @returns       URL→本文のマップ。エラー時は空配列。
 */
export async function tavilyExtract(
  apiKey: string,
  urls: string[],
): Promise<TavilyExtractResult[]> {
  if (urls.length === 0) return [];

  // 最大 10 件に制限（無料枠節約）
  const targetUrls = urls.slice(0, 10);

  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        urls: targetUrls,
      }),
    });
  } catch (err: unknown) {
    console.warn(
      `Tavily extract network error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  if (!res.ok) {
    console.warn(`Tavily extract failed: HTTP ${res.status}`);
    return [];
  }

  let data: TavilyExtractApiResponse;
  try {
    data = (await res.json()) as TavilyExtractApiResponse;
  } catch (err: unknown) {
    console.warn(
      `Tavily extract JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  if (!data.results) return [];

  return data.results.map((r) => ({
    url: r.url,
    raw_content: r.raw_content,
  }));
}
