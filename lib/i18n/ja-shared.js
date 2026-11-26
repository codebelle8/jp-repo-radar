// App shell, providers and shared components.
export const JA_SHARED = {
  // relative times (lib/format.js)
  "never": "なし",
  "just now": "たった今",
  "{n} min ago": "{n} 分前",
  "{n} h ago": "{n} 時間前",
  "{n} d ago": "{n} 日前",
  "{n} mo ago": "{n} か月前",
  "{n} y ago": "{n} 年前",
  // language switch (also the "Language" column in RepoTable)
  "Language": "言語",

  // AppShell: navigation and header
  "Overview": "概要",
  "Companies": "企業",
  "Repositories": "リポジトリ",
  "Contribute": "コントリビュート",
  "Discovery": "探索",
  "Tracker": "トラッカー",
  "Settings": "設定",
  "Japanese web-dev companies on GitHub": "GitHub 上の日本の Web 開発企業",
  "Sections": "セクション",
  "Switch theme": "テーマを切り替え",
  // AppShell: banners and footer
  "Storage is not connected: data on this deployment is temporary. In Vercel, open <b>Storage</b>, create a <b>Neon</b> (Postgres) or <b>Upstash for Redis</b> database, connect it to this project and redeploy.":
    "ストレージが接続されていないため、このデプロイのデータは一時的なものです。Vercel で <b>Storage</b> を開き、<b>Neon</b>（Postgres）または <b>Upstash for Redis</b> のデータベースを作成してこのプロジェクトに接続し、再デプロイしてください。",
  "Cannot reach the server: {message}": "サーバーに接続できません：{message}",
  "Counts cover public, non-fork repositories only. Data from the GitHub API.": "件数は公開リポジトリ（フォークを除く）のみを対象としています。データは GitHub API から取得しています。",
  "Last collection: {when} ({status}).": "最終収集：{when}（{status}）。",
  "Not collected yet.": "まだ収集していません。",
  // AppShell: job bar
  "Paused for GitHub's rate limit until {time}": "GitHub のレート制限のため {time} まで一時停止中",
  "{n} found": "{n} 件検出",
  "Log": "ログ",
  "Stop": "停止",
  "Runs in short steps while this page is open. You can close it and continue later.":
    "このページを開いている間、短いステップに分けて実行されます。ページを閉じても、後で続きから再開できます。",
  "Runs in short steps while this page is open (and daily via Vercel Cron). You can close it and continue later.":
    "このページを開いている間（および Vercel Cron で毎日）、短いステップに分けて実行されます。ページを閉じても、後で続きから再開できます。",

  // providers: toasts (translate() calls) and run-button tooltips
  "Collection finished: {orgs} organizations, {repos} repositories": "収集が完了しました（Organization {orgs} 件、リポジトリ {repos} 件）",
  "Collection finished: {orgs} organizations, {repos} repositories ({problems} with problems)": "収集が完了しました（Organization {orgs} 件、リポジトリ {repos} 件、問題あり {problems} 件）",
  "Discovery finished: {n} new candidates": "探索が完了しました（新しい候補 {n} 件）",
  "Job failed: {error}": "ジョブが失敗しました：{error}",
  "Job stopped": "ジョブを停止しました",
  "Collection started": "収集を開始しました",
  "Discovery started": "探索を開始しました",
  "Loading…": "読み込み中…",
  "Sign in on the Settings page first": "先に設定ページでサインインしてください",
  "Add a GitHub token on the Settings page first": "先に設定ページで GitHub トークンを追加してください",
  "Another job is running": "別のジョブが実行中です",

  // ui.js
  "Not found on GitHub": "GitHub に見つかりません",
  "Error: {error}": "エラー：{error}",
  "Not collected yet": "未収集",
  "Segment": "セグメント",
  "All segments": "すべてのセグメント",
  "Archived repositories are read-only; their issues are frozen.": "アーカイブ済みのリポジトリは読み取り専用のため、Issue も更新されません。",
  "Include archived repos": "アーカイブ済みを含める",
  "Export CSV": "CSV 出力",
  "Connect GitHub to start collecting": "GitHub を接続してデータ収集を始めましょう",
  "Create a token: {link} — choose “Public repositories (read-only)”. No extra permissions are needed.":
    "トークンを作成します：{link} を開き、「Public repositories (read-only)」を選択してください。追加の権限は不要です。",
  "Paste it on the <link>Settings</link> page.": "<link>設定</link>ページに貼り付けます。",
  "Paste it on the <link>Settings</link> page (sign in there first).": "<link>設定</link>ページに貼り付けます（先にそのページでサインインしてください）。",
  "Add it as {name} in Vercel → Project Settings → Environment Variables, then redeploy.":
    "Vercel の Project Settings → Environment Variables に {name} として追加し、再デプロイします。",
  "Click “Collect data”. The first run over the starter list takes a few minutes.": "「データ収集」をクリックします。初回は初期リスト全体を収集するため、数分かかります。",
  "Something went wrong": "エラーが発生しました",

  // DataTable
  "Nothing to show yet.": "まだ表示するデータがありません。",

  // charts
  "The trend line appears after the second collection.": "推移グラフは 2 回目の収集後に表示されます。",
  "{label} over time": "{label} の推移",

  // RepoTable
  "Repository": "リポジトリ",
  "archived": "アーカイブ済み",
  "Company": "企業",
  "Branches": "ブランチ",
  "Open issues": "オープン Issue",
  "Closed issues": "クローズ済み Issue",
  "Open PRs": "オープン PR",
  "Stars": "スター",
  "Last push": "最終プッシュ",

  // CompanyForm
  "Edit company": "企業を編集",
  "Add a company": "企業を追加",
  "GitHub orgs: the login in github.com/<login>, separated by commas": "GitHub Organization：github.com/<login> の login 部分をカンマ区切りで入力",
  "Company name": "企業名",
  "Japanese name": "日本語名",
  "Website": "Web サイト",
  "e.g. SaaS / B2B": "例：SaaS / B2B",
  "GitHub organizations": "GitHub Organization",
  "Collect its repositories right away": "すぐにリポジトリを収集する",
  "Cancel": "キャンセル",
  "Save changes": "変更を保存",
  "Add company": "企業を追加",

  // skills.js
  "You use: {list}": "使用中：{list}",
  "Related (half credit): {list}": "関連言語（半分の重みで加点）：{list}",
  "Not in your list: {list}": "リストにない言語：{list}",
  "Based on {n} repositories: {top}": "{n} 件のリポジトリに基づく：{top}",
  "Based on {n} recently active repositories: {top}": "最近アクティブな {n} 件のリポジトリに基づく：{top}",
  "Search:": "検索：",
  "Added by you": "手動で追加",
  "10%+ of the code in {n} of your repositories": "あなたのリポジトリ {n} 件でコードの 10% 以上",
  "{n} repositories you contributed to": "コントリビュートしたリポジトリ {n} 件",
  "Remove {name}": "{name} を削除",
  "No languages yet.": "まだ言語がありません。",
  "Add a language": "言語を追加",
  "Add": "追加",
  "Hidden:": "非表示：",
  "restore": "元に戻す",
};
