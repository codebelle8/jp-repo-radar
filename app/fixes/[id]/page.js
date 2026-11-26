"use client";
// One auto-fix: pre-check, the agent's result and explanation, the diff, the pull request and its review.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FixStatus, Note, Patch, dollars } from "@/components/fixes";
import { useStatus, useT, useToast } from "@/components/providers";
import { CardHead, ErrorNotice, ExtLink, Loading, PageHead, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { localTime } from "@/lib/format";

const RESTARTABLE = new Set(["blocked", "failed", "needs_attention", "cancelled", "closed"]);

function ResultCard({ title, result, t }) {
  if (!result) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <CardHead title={title} sub={result.outcome ? t("quality check: {result}", { result: t(result.outcome) }) : null} />
      {result.summary ? <p style={{ marginBottom: 10 }}><b>{result.summary}</b></p> : null}
      {result.reason ? <p className="form-error" style={{ marginBottom: 10 }}>{result.reason}</p> : null}
      {result.explanation ? (
        <details open>
          <summary>{t("Explanation (read this before opening the pull request)")}</summary>
          <div className="pre-wrap" style={{ marginTop: 8 }}>{result.explanation}</div>
        </details>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <div className="row">
          <strong>{t("Tests")}</strong>
          {result.tests.passed ? <span className="chip chip-plus">{t("Passed")}</span> : <span className="chip chip-minus">{t("Failing")}</span>}
          {result.tests.commands.map((c) => <code key={c}>{c}</code>)}
        </div>
        {result.tests.output ? <pre className="code-block" style={{ marginTop: 6 }}>{result.tests.output}</pre> : null}
      </div>
    </section>
  );
}

function DiffCard({ diff, t }) {
  if (!diff) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <CardHead title={t("Changes")} sub={t("{files} files, +{add} −{del}, {commits} commits", { files: diff.totalFiles, add: diff.additions, del: diff.deletions, commits: diff.commits })}>
        {diff.compareUrl ? <ExtLink href={diff.compareUrl}>{t("View on GitHub")}</ExtLink> : null}
      </CardHead>
      {diff.files.map((f) => (
        <details key={f.filename} style={{ marginBottom: 6 }}>
          <summary className="file-row">
            <code>{f.filename}</code>
            <span className="small diff-line-add">+{f.additions}</span>
            <span className="small diff-line-del">−{f.deletions}</span>
            <span className="small muted">{t(f.status)}</span>
          </summary>
          <Patch patch={f.patch} />
          {f.truncated ? <p className="muted small">{t("The diff is long; open it on GitHub for the rest.")}</p> : null}
        </details>
      ))}
    </section>
  );
}

export default function FixPage() {
  const { t, rich } = useT();
  const toast = useToast();
  const router = useRouter();
  const { id } = useParams();
  const { status, canEdit } = useStatus();
  const { data: fix, error, reload } = useApi(canEdit ? `/api/fixes/${encodeURIComponent(decodeURIComponent(id))}` : null, []);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(null);
  const [body, setBody] = useState(null);
  const [reply, setReply] = useState(null);
  const [understood, setUnderstood] = useState(false);

  useEffect(() => {
    if (fix?.status !== "running") return undefined;
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [fix?.status, reload]);

  const back = <Link href="/fixes" className="small">← {t("All auto-fixes")}</Link>;
  if (!status) return <Loading />;
  if (!canEdit) return <><PageHead title={t("Auto-fix")} /><section className="card"><p className="muted">{rich("Sign in on the <link>Settings</link> page to use auto-fix.", { link: (c) => <Link href="/settings">{c}</Link> })}</p></section></>;
  if (!fix) return <>{back}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  async function act(fn, success) {
    setBusy(true);
    try { const r = await fn(); if (success) toast(success); reload(); return r; } catch (err) { toast(err.message, true); return null; } finally { setBusy(false); }
  }
  const path = `/api/fixes/${encodeURIComponent(fix.id)}`;
  const prTitle = title ?? fix.result?.prTitle ?? fix.issue.title;
  const prBody = body ?? fix.result?.prBody ?? `Fixes #${fix.issue.number}`;
  const replyText = reply ?? fix.reviewResult?.reply ?? "";
  const newActivity = (fix.pr?.activity || []).filter((a) => !a.mine && !(fix.pr.respondedIds || []).includes(a.id));
  const pc = fix.precheck || {};

  return (
    <>
      {back}
      <PageHead title={fix.issue.title}
        lede={<>
          <ExtLink href={fix.issue.url}>{fix.issue.owner}/{fix.issue.repo} #{fix.issue.number}</ExtLink>
          {fix.company ? <> · <Link href={`/companies/${fix.companyId}`}>{fix.company}</Link></> : null}
          {pc.language ? <> · {pc.language}</> : null}
        </>}>
        <FixStatus status={fix.status} phase={fix.phase} />
      </PageHead>

      {fix.status === "running" ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={fix.phase === "review" ? t("Addressing the review") : t("The agent is working")} sub={t("cost so far {amount}", { amount: dollars(fix.session?.costCents) })} />
          <p className="muted">{t("It works in an isolated sandbox on your fork: reproduce, fix, test, push the branch. This usually takes 10 to 30 minutes. You will get a notification; you can close this page.")}</p>
          <div className="row" style={{ marginTop: 10 }}>
            {fix.session?.url ? <ExtLink href={fix.session.url}>{t("Watch live in the Claude Console")}</ExtLink> : null}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { if (confirm(t("Stop this run?"))) act(() => api(`${path}/cancel`, { body: {} }), t("Stopped")); }}>{t("Stop")}</button>
          </div>
        </section>
      ) : null}

      {fix.error ? <section className="card" style={{ marginBottom: 16 }}><p className="form-error"><Note note={fix.error} /></p></section> : null}

      {(pc.problems?.length || pc.warnings?.length || pc.mentions?.length) ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={t("Pre-check")} sub={pc.problems?.length ? t("blocked") : t("passed with notes")} />
          <ul style={{ margin: "0 0 0 18px" }}>
            {(pc.problems || []).map((p, i) => <li key={`p${i}`} className="form-error"><Note note={p} /></li>)}
            {(pc.warnings || []).map((w, i) => <li key={`w${i}`}><Note note={w} /></li>)}
          </ul>
          {pc.mentions?.length ? (
            <div style={{ marginTop: 8 }}>
              {pc.mentions.map((m, i) => <blockquote key={i} className="muted small" style={{ margin: "6px 0", paddingLeft: 10, borderLeft: "3px solid var(--border-strong)" }}>{m.excerpt} <span className="faint">({m.source})</span></blockquote>)}
              {pc.contributingUrl ? <ExtLink href={pc.contributingUrl}>{t("Read the contributing guide")}</ExtLink> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <ResultCard title={t("Result")} result={fix.result} t={t} />
      {fix.reviewResult ? <ResultCard title={t("Review response")} result={fix.reviewResult} t={t} /> : null}
      <DiffCard diff={fix.diff} t={t} />

      {fix.status === "ready" ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={t("Open the pull request")} sub={t("published in your name on {repo}", { repo: `${fix.issue.owner}/${fix.issue.repo}` })} />
          {fix.result?.aiDisclosure ? <p className="form-error" style={{ marginBottom: 8 }}>{t("This project asks contributors to disclose AI assistance. Keep the disclosure in the description.")}</p> : null}
          <label className="field-label" htmlFor="pr-title">{t("Title")}</label>
          <input id="pr-title" className="wide" type="text" value={prTitle} onChange={(e) => setTitle(e.target.value)} />
          <label className="field-label" htmlFor="pr-body">{t("Description")}</label>
          <textarea id="pr-body" className="wide" rows={10} value={prBody} onChange={(e) => setBody(e.target.value)} />
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            {t("I have read the changes and the explanation, and I can explain them to the maintainers.")}
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary" disabled={busy || !understood || !prTitle.trim()}
              onClick={() => act(() => api(`${path}/pr`, { body: { title: prTitle, body: prBody } }), t("Pull request created"))}>
              {t("Create pull request")}
            </button>
          </div>
        </section>
      ) : null}

      {fix.pr ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={t("Pull request #{number}", { number: fix.pr.number })}
            sub={[t(fix.pr.state), fix.pr.reviewDecision ? t(fix.pr.reviewDecision) : null, fix.pr.ci ? t("CI: {state}", { state: t(fix.pr.ci) }) : null].filter(Boolean).join(" · ")}>
            <ExtLink href={fix.pr.url}>{t("Open on GitHub")}</ExtLink>
          </CardHead>
          {fix.pr.activity?.length ? (
            <ul className="activity">
              {fix.pr.activity.slice().reverse().map((a) => (
                <li key={a.id} className={a.mine ? "mine" : undefined}>
                  <div className="small">
                    <b>@{a.author}</b> · {t(a.kind)}{a.state ? ` · ${t(a.state)}` : ""}{a.path ? <> · <code>{a.path}</code></> : null} · <span title={localTime(a.at)}><TimeAgo iso={a.at} /></span>
                    {a.url ? <> · <ExtLink href={a.url}>{t("link")}</ExtLink></> : null}
                  </div>
                  {a.body ? <div className="pre-wrap small muted" style={{ marginTop: 2 }}>{a.body.length > 600 ? `${a.body.slice(0, 600)}…` : a.body}</div> : null}
                </li>
              ))}
            </ul>
          ) : <p className="muted">{t("No reviews or comments yet. You will get a notification when the maintainers respond.")}</p>}
          {fix.status === "pr_open" && newActivity.length ? (
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-primary" disabled={busy}
                onClick={() => act(() => api(`${path}/respond`, { body: {} }), t("The agent is addressing the review."))}>
                {t("Respond to review ({n} new)", { n: newActivity.length })}
              </button>
              <span className="muted small">{t("The agent adds commits to the same branch and drafts a reply for you to check.")}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      {fix.status === "reply_ready" ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={t("Reply to the reviewers")} sub={t("the new commits are already on the pull request")} />
          <textarea className="wide" rows={6} value={replyText} onChange={(e) => setReply(e.target.value)} aria-label={t("Reply")} />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary" disabled={busy || !replyText.trim()}
              onClick={() => act(() => api(`${path}/reply`, { body: { body: replyText } }), t("Reply posted"))}>{t("Post reply")}</button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <CardHead title={t("History")} sub={fix.session ? t("total cost of the last run {amount}", { amount: dollars(fix.session.costCents) }) : null} />
        <ul className="activity">
          {(fix.history || []).slice().reverse().map((h, i) => (
            <li key={i}><span className="small"><FixStatus status={h.status} /> <span title={localTime(h.at)}><TimeAgo iso={h.at} /></span></span>{h.note ? <div className="small muted"><Note note={h.note} /></div> : null}</li>
          ))}
        </ul>
        <div className="row" style={{ marginTop: 12 }}>
          {RESTARTABLE.has(fix.status) ? (
            <button type="button" className="btn btn-sm" disabled={busy}
              onClick={async () => { const r = await act(() => api("/api/fixes", { body: { url: fix.issue.url } }), t("Started again")); if (r) router.refresh(); }}>
              {t("Run again")}
            </button>
          ) : null}
          {fix.status !== "running" ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
              onClick={async () => { if (confirm(t("Remove this auto-fix from the list? Nothing on GitHub changes."))) { const r = await act(() => api(path, { method: "DELETE" })); if (r) router.push("/fixes"); } }}>
              {t("Remove")}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
