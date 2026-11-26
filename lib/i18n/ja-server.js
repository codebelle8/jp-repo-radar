// Messages that come from the server: API errors, job progress and logs, welcome-score and discovery signals.
// Sources: lib/http.js, lib/client.js, lib/github.js, lib/jobs.js, lib/collector.js, lib/contrib.js, lib/discovery.js,
// lib/companies.js, lib/tracker.js, lib/skills.js, lib/store-redis.js and app/api/**/route.js.
export const JA_SERVER = {
  // ---------------------------------------------------------------- enum values shown to users
  // job status / kind (lib/jobs.js)
  "running": "実行中",
  "done": "完了",
  "failed": "失敗",
  "stopped": "停止",
  "collect": "データ収集",
  "discover": "探索",
  // candidate status (lib/discovery.js, app/api/candidates)
  "pending": "未判定",
  "approved": "承認済み",
  "rejected": "却下",
  // organization status (lib/collector.js)
  "ok": "正常",
  "error": "エラー",
  "not_found": "見つかりません",
  // tracker stages (lib/tracker.js STAGES / APP_STAGES)
  "Watching": "ウォッチ中",
  "Commented": "コメント済み",
  "PR open": "PR オープン",
  "Merged": "マージ済み",
  "Dropped": "見送り",
  "Not started": "未着手",
  "Preparing": "準備中",
  "Applied": "応募済み",
  "Casual interview": "カジュアル面談",
  "Interviewing": "選考中",
  "Offer": "内定",
  "Not this time": "今回は見送り",

  // ---------------------------------------------------------------- jobs (lib/jobs.js)
  "Collect: all companies": "データ収集: すべての企業",
  "Discover Japanese organizations": "日本の Organization を探索",
  "Starting": "開始しています",
  "Finished": "完了",
  "Stopped": "停止",
  "Failed": "失敗",

  // ---------------------------------------------------------------- API errors
  // lib/http.js
  "GitHub rejected the token. Check it on the Settings page.": "GitHub にトークンが拒否されました。設定ページで確認してください。",
  "Host not allowed": "このホスト名からのアクセスは許可されていません",
  "Cross-origin request blocked": "クロスオリジンのリクエストをブロックしました",
  "Use Content-Type: application/json": "Content-Type: application/json を指定してください",
  "Editing is disabled: set ADMIN_PASSWORD in the Vercel project settings.": "編集は無効になっています。Vercel のプロジェクト設定で ADMIN_PASSWORD を設定してください。",
  "Sign in on the Settings page to make changes.": "変更するには設定ページでサインインしてください。",
  "Sign in on the Settings page to see your tracker.": "トラッカーを表示するには設定ページでサインインしてください。",
  "Request too large": "リクエストが大きすぎます",
  "Body is not valid JSON": "リクエスト本文が有効な JSON ではありません",
  "JSON body must be an object": "JSON の本文はオブジェクトである必要があります",
  // lib/client.js (non-JSON error responses)
  "Request failed (HTTP {status})": "リクエストに失敗しました（HTTP {status}）",
  // lib/github.js and lib/jobs.js (also stored as job / organization / token errors)
  "GitHub rejected the token (401 Unauthorized). Check that it is valid and not expired.": "GitHub にトークンが拒否されました（401 Unauthorized）。トークンが有効で、期限切れでないことを確認してください。",
  "No GitHub token configured. Add GITHUB_TOKEN (see Settings).": "GitHub トークンが設定されていません。GITHUB_TOKEN を追加してください（設定ページを参照）。",
  "No GitHub token configured": "GitHub トークンが設定されていません",
  "GitHub rate limit reached": "GitHub のレート制限に達しました",
  "GraphQL rate limit reached": "GraphQL のレート制限に達しました",
  "GraphQL points almost used up": "GraphQL のポイントがまもなく上限に達します",
  "GitHub returned a response that is not JSON": "GitHub から JSON ではない応答が返されました",
  "Not Found": "見つかりません",
  "Add a GitHub token first (see Settings).": "先に GitHub トークンを追加してください（設定ページを参照）。",
  // lib/companies.js
  "Company name is required": "企業名は必須です",
  "Company not found": "企業が見つかりません",
  // lib/tracker.js
  "Paste a GitHub issue link like https://github.com/owner/repo/issues/123": "https://github.com/owner/repo/issues/123 のような GitHub の Issue リンクを貼り付けてください",
  "That is a pull request. Track the issue it fixes instead; pull requests are picked up automatically.": "これはプルリクエストです。代わりに、修正対象の Issue をトラッカーに追加してください。プルリクエストは自動的に取り込まれます。",
  "Not tracked": "トラッカーに登録されていません",
  "Unknown stage": "不明なステージです",
  "Careers link must start with http:// or https://": "採用ページのリンクは http:// または https:// で始めてください",
  // lib/skills.js
  "Send lists of language names": "言語名のリストを送信してください",
  // app/api/auth
  "No ADMIN_PASSWORD is configured.": "ADMIN_PASSWORD が設定されていません。",
  "Wrong password": "パスワードが違います",
  // app/api/candidates/[login]
  "Candidate not found": "候補が見つかりません",
  "action must be approve, reject or reset": "action には approve、reject、reset のいずれかを指定してください",
  // app/api/cron/collect
  "Unauthorized": "認証されていません",
  "No GITHUB_TOKEN configured": "GITHUB_TOKEN が設定されていません",
  // app/api/export/[kind]
  "Unknown export": "不明なエクスポート形式です",
  // app/api/settings
  "Storage is temporary on this deployment: set GITHUB_TOKEN in Vercel → Project Settings → Environment Variables instead.": "このデプロイではストレージが一時的です。代わりに Vercel の Project Settings → Environment Variables で GITHUB_TOKEN を設定してください。",
  "Nothing to update": "更新する内容がありません",

  // ---------------------------------------------------------------- welcome-score signals (lib/contrib.js welcomeScore)
  "Only team PRs merged in 12 months": "過去 12 か月にマージされた PR はチーム内のもののみ",
  "team PRs only": "チームPRのみ",
  "CONTRIBUTING guide": "CONTRIBUTING ガイド",
  "Pushed in the last 3 months": "過去 3 か月以内にプッシュあり",
  "active": "アクティブ",

  // ---------------------------------------------------------------- discovery signals (lib/discovery.js scoreOrg)
  "Japanese text in profile": "プロフィールに日本語の記述あり",
  "Verified domain on GitHub": "GitHub で認証済みのドメイン",
  "Company wording (株式会社 / Inc. / Co., Ltd.)": "企業を示す表記（株式会社 / Inc. / Co., Ltd.）",
  "Pushed in the last 12 months": "過去 12 か月以内にプッシュあり",
  "No pushes for over 3 years": "3 年以上プッシュなし",
  "Looks like a community / school / personal account": "コミュニティ・学校・個人のアカウントと思われる",
  "Academic, government or GitHub Pages website": "教育機関・行政機関または GitHub Pages の Web サイト",
  // short chip texts the Discovery page derives from the labels above (app/discovery/page.js SHORT, via msg();
  // "$1" is filled by String.replace there)
  "web $1%": "Web 系 $1%",
  "$1 repos": "$1 リポジトリ",
  "Japan": "日本",
  "Japanese text": "日本語",
  "verified": "認証済み",
  "company": "企業",
  "community?": "コミュニティ？",
  "non-company site": "企業以外のサイト",
  "inactive": "非アクティブ",
  "website": "Web サイト",
};

// ---------------------------------------------------------------- building blocks for the patterns

/** Regex source matching `text` literally. */
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Renumber $1, $2 ... in a replacement when `k` capture groups come before it. */
const shift = (out, k) => out.replace(/\$(\d+)/g, (m, d) => `$${Number(d) + k}`);
/** Job log lines start with "HH:MM:SS  " (lib/jobs.js addLog); the time is optional so bare messages match too. */
const TIME = String.raw`((?:\d{1,2}:\d{2}:\d{2}\s+)?)`;
const LOGIN = String.raw`([A-Za-z0-9][A-Za-z0-9-]*)`;

const src = (re) => (typeof re === "string" ? re : re.source);
/** Whole-message pattern: `before` (regex source with `groups` capture groups) + each [source, replacement] of `list`. */
const around = (before, outBefore, groups, list) =>
  list.map(([re, out]) => [new RegExp(`^${before}${src(re)}$`), outBefore + shift(out, groups)]);
/** A job log line, with or without its time stamp. */
const log = (re, out) => [new RegExp(`^${TIME}${src(re)}$`), `$1${shift(out, 1)}`];

// GitHub / storage error messages (lib/github.js, lib/collector.js, lib/store-redis.js). They are shown on their own
// (job.error, organization errors, token check) and inside other messages ("GitHub: …", "ERROR: …", "<org>: failed - …").
const ERROR_TEXTS = [
  "GitHub rejected the token (401 Unauthorized). Check that it is valid and not expired.",
  "No GitHub token configured. Add GITHUB_TOKEN (see Settings).",
  "No GitHub token configured",
  "GitHub rate limit reached",
  "GraphQL rate limit reached",
  "GraphQL points almost used up",
  "GitHub returned a response that is not JSON",
  "Not Found",
];
const ERROR_PATTERNS = [
  [/GitHub refused the request \(HTTP (\d+)\): (.*)/, "GitHub がリクエストを拒否しました（HTTP $1）: $2"],
  [/GitHub returned HTTP (\d+)/, "GitHub から HTTP $1 が返されました"],
  [/GitHub GraphQL timeout: (.*)/, "GitHub GraphQL がタイムアウトしました: $1"],
  [/GraphQL error: (.*)/, "GraphQL エラー: $1"],
  [/Network error talking to GitHub: (.*)/, "GitHub との通信でネットワークエラーが発生しました: $1"],
  [/No GitHub organization named '([^']*)'/, "「$1」という名前の GitHub Organization はありません"],
  [/Redis REST returned HTTP (\d+)/, "Redis REST から HTTP $1 が返されました"],
];
const ERRORS = [...ERROR_TEXTS.map((en) => [esc(en), JA_SERVER[en]]), ...ERROR_PATTERNS];

// Job labels (lib/jobs.js startJob), also quoted in "A job is already running: …".
const JOB_LABELS = [
  [esc("Collect: all companies"), JA_SERVER["Collect: all companies"]],
  [esc("Discover Japanese organizations"), JA_SERVER["Discover Japanese organizations"]],
  [/Collect: (.+)/, "データ収集: $1"],
];

/** [RegExp, replacement] for messages with values inside. Anchor with ^ and $. More specific patterns first. */
export const JA_SERVER_PATTERNS = [
  // ---------------------------------------------------------------- error messages on their own
  ...around("", "", 0, ERROR_PATTERNS),
  [/^Server error: Redis REST returned HTTP (\d+)$/, "サーバーエラー: Redis REST から HTTP $1 が返されました"],
  [/^Server error: (.+)$/, "サーバーエラー: $1"],
  // route() wraps GitHub failures as "GitHub: <message>" (lib/http.js)
  ...around("GitHub: ", "GitHub: ", 0, ERRORS),

  // ---------------------------------------------------------------- API errors with values
  ...around("A job is already running: ", "ジョブはすでに実行中です: ", 0, JOB_LABELS),
  [/^A job is already running: (.+)$/, "ジョブはすでに実行中です: $1"],
  [/^Unknown job kind '(.*)'$/, "不明なジョブの種類「$1」です"],
  [/^'(.+)' is not a valid GitHub login$/, "「$1」は有効な GitHub のログイン名ではありません"],
  [/^GitHub org '([^']+)' is already assigned to another company$/, "GitHub Organization「$1」はすでに別の企業に割り当てられています"],
  [/^GitHub org '([^']+)' is already assigned to (.+)$/, "GitHub Organization「$1」はすでに $2 に割り当てられています"],
  [/^You can track up to (\d+) issues\. Remove some first\.$/, "トラッカーに追加できる Issue は $1 件までです。先にいくつか削除してください。"],
  [/^“(.*)” is not a language name$/, "「$1」は言語名ではありません"],
  [/^Up to (\d+) languages$/, "言語は $1 件まで登録できます"],
  [/^Last collection finished (\d+(?:\.\d+)?) h ago$/, "前回のデータ収集は $1 時間前に完了しました"],

  // ---------------------------------------------------------------- job label / current step / run detail
  [/^Collect: (.+)$/, "データ収集: $1"],
  [/^Issues & contributions: (.+)$/, "Issue とコントリビューションを確認中: $1"],
  [/^Searching “([^”]*)” \((.+)\), page (\d+) · (\d+) found$/, "「$1」を検索中（$2）、$3 ページ目 · $4 件発見"],
  [/^Searching “([^”]*)” \((.+)\), page (\d+)$/, "「$1」を検索中（$2）、$3 ページ目"],
  [/^Searching “([^”]*)”, page (\d+) · (\d+) found$/, "「$1」を検索中、$2 ページ目 · $3 件発見"],
  [/^Searching “([^”]*)”, page (\d+)$/, "「$1」を検索中、$2 ページ目"],
  [/^Reading organization profiles \((\d+)\/(\d+)\)$/, "Organization のプロフィールを取得中（$1/$2）"],
  // run history detail (lib/jobs.js finishJob)
  [/^(\d+)\/(\d+) orgs ok, (\d+) repos, (\d+) open issues$/, "Organization $1/$2 件成功、リポジトリ $3 件、オープン Issue $4 件"],
  [/^(\d+)\/(\d+) orgs ok, (\d+) repos$/, "Organization $1/$2 件成功、リポジトリ $3 件"],
  [/^(\d+) new, (\d+) updated$/, "新規 $1 件、更新 $2 件"],

  // ---------------------------------------------------------------- job log lines ("HH:MM:SS  message")
  // lib/jobs.js
  log(/Collecting (\d+) GitHub organizations?/, "GitHub Organization $1 件のデータ収集を開始します"),
  log(/Searching (\d+) locations? for organizations with >= (\d+) public repos/, "公開リポジトリが $2 件以上の Organization を $1 か所の地域で検索します"),
  log(/Finished: (\d+) ok, (\d+) not found, (\d+) failed, (\d+) repositories, (\d+) open issues/, "完了: 成功 $1 件、未検出 $2 件、失敗 $3 件、リポジトリ $4 件、オープン Issue $5 件"),
  log(/Finished: (\d+) ok, (\d+) not found, (\d+) failed, (\d+) repositories/, "完了: 成功 $1 件、未検出 $2 件、失敗 $3 件、リポジトリ $4 件"),
  log(/Discovery finished: (\d+) new candidates, (\d+) re-scored/, "探索が完了しました: 新しい候補 $1 件、スコア更新 $2 件"),
  log(/Stopped by user/, "ユーザーが停止しました"),
  log(/GitHub rate limit reached; the job continues after (.+)/, "GitHub のレート制限に達しました。$1 以降にジョブを再開します"),
  ...around(`${TIME}ERROR: `, "$1エラー: ", 1, ERRORS),
  log(/ERROR: (.+)/, "エラー: $1"),
  // lib/github.js (client log)
  log(/GitHub rate limit; waiting (\d+)s/, "GitHub のレート制限のため $1 秒待機しています"),
  log(/GraphQL warning \(partial data\): (.*)/, "GraphQL の警告（一部のデータのみ取得）: $1"),
  // lib/collector.js
  log(new RegExp(`${LOGIN}: GitHub timed out, retrying with (\\d+) repos per page`), "$1: GitHub がタイムアウトしました。1 ページあたり $2 件で再試行します"),
  log(new RegExp(`${LOGIN}: (\\d+) public repositories`), "$1: 公開リポジトリ $2 件"),
  log(new RegExp(`${LOGIN}: not found on GitHub`), "$1: GitHub に見つかりません"),
  ...around(`${TIME}${LOGIN}: failed - `, "$1$2: 失敗 - ", 2, ERRORS),
  log(new RegExp(`${LOGIN}: failed - (.+)`), "$1: 失敗 - $2"),
  // lib/contrib.js
  log(/Checking open issues and outside contributions in (\d+) active repositories/, "アクティブなリポジトリ $1 件で、オープン Issue と外部コントリビューションを確認します"),
  log(new RegExp(`${LOGIN}: GitHub timed out, retrying with (\\d+) repositories per request`), "$1: GitHub がタイムアウトしました。1 リクエストあたり $2 リポジトリで再試行します"),
  ...around(`${TIME}${LOGIN}: skipped (.+?) - `, "$1$2: $3 をスキップしました - ", 3, ERRORS),
  log(new RegExp(`${LOGIN}: skipped (.+?) - (.+)`), "$1: $2 をスキップしました - $3"),
  log(new RegExp(`${LOGIN}: (\\d+) active repositories checked, (\\d+) open issues`), "$1: アクティブなリポジトリ $2 件を確認、オープン Issue $3 件"),
  // lib/discovery.js
  log(/Search finished: (\d+) organizations, (\d+) to score \((\d+) already tracked\)/, "検索が完了しました: Organization $1 件、スコア対象 $2 件（登録済み $3 件）"),
  log(/“([^”]*)” matches (\d+) organizations; splitting into (\d+) smaller searches/, "「$1」に一致する Organization が $2 件あるため、$3 件の検索に分割します"),
  log(/“([^”]*)”: (\d+) organizations/, "「$1」: Organization $2 件"),

  // ---------------------------------------------------------------- welcome-score signals (lib/contrib.js)
  // label (tooltip)
  [/^(\d+) outside PRs? merged in 12 months$/, "過去 12 か月にマージされた外部 PR $1 件"],
  [/^(\d+) outside contributors?$/, "外部コントリビューター $1 人"],
  [/^Replies to only (\d+)% of outside issues$/, "外部からの Issue への返信は $1% のみ"],
  [/^Replies to (\d+)% of outside issues$/, "外部からの Issue の $1% に返信"],
  [/^First reply in ~(\d+) h \(median\)$/, "初回返信まで約 $1 時間（中央値）"],
  [/^First reply in ~(\d+) d \(median\)$/, "初回返信まで約 $1 日（中央値）"],
  [/^License (.+)$/, "ライセンス $1"],
  [/^(\d+) open beginner issues?$/, "初心者向けラベルのオープン Issue $1 件"],
  // short (chip)
  [/^(\d+) outside PRs?$/, "外部PR $1"],
  [/^(\d+) people$/, "$1 人"],
  [/^(\d+)% replied$/, "返信率 $1%"],
  [/^reply ~(\d+) h$/, "返信 約 $1 時間"],
  [/^reply ~(\d+) d$/, "返信 約 $1 日"],
  [/^(\d+) beginner$/, "初心者向け $1"],

  // ---------------------------------------------------------------- discovery signals (lib/discovery.js)
  [/^Location in Japan \((.*)\)$/, "所在地が日本（$1）"],
  [/^Website on \.co\.jp \((.*)\)$/, "Web サイトが .co.jp（$1）"],
  [/^Website on \.jp \((.*)\)$/, "Web サイトが .jp（$1）"],
  [/^Has website \((.*)\)$/, "Web サイトあり（$1）"],
  [/^Web languages in (\d+)% of recent repos$/, "最近のリポジトリの $1% が Web 系の言語"],
  [/^(\d+) public repositories$/, "公開リポジトリ $1 件"],
];
