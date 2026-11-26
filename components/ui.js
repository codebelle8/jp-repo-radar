"use client";
import Link from "next/link";
import { usePrefs, useStatus, useT } from "@/components/providers";
import { ago, ghUrl, hostOf, localTime, qs, safeUrl } from "@/lib/format";

export function PageHead({ title, lede, children }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Tile({ label, value, note }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note ? <div className="tile-note">{note}</div> : null}
    </div>
  );
}

export function CardHead({ title, sub, children }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {sub ? <span className="sub">{sub}</span> : null}
      {children ? <><span className="spacer" />{children}</> : null}
    </div>
  );
}

export function ExtLink({ href, children }) {
  const url = safeUrl(href);
  if (!url) return children ?? null;
  return <a href={url} target="_blank" rel="noopener noreferrer">{children ?? hostOf(url)}</a>;
}

export function TimeAgo({ iso }) {
  useT();   // re-render when the language changes (ago() and localTime() use the current language)
  return <span title={localTime(iso) || undefined} className={iso ? undefined : "faint"}>{ago(iso)}</span>;
}

export const Dash = () => <span className="faint">—</span>;

export function Avatar({ src, large = false }) {
  const url = safeUrl(src);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`avatar${large ? " avatar-lg" : ""}`} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
  );
}

export function OrgChips({ orgs }) {
  const { t } = useT();
  return orgs.map((o) => {
    const bad = o.status === "error" || o.status === "not_found";
    const title = o.status === "not_found" ? t("Not found on GitHub") : o.status === "error" ? t("Error: {error}", { error: t(o.error || "") })
      : o.status === "pending" ? t("Not collected yet") : o.name || o.login;
    return (
      <a key={o.login} className={`chip${bad ? " chip-minus" : ""}`} href={ghUrl(o.login)} target="_blank"
        rel="noopener noreferrer" title={title}>{o.login}</a>
    );
  });
}

export function SegmentSelect({ segments }) {
  const { prefs, setPrefs } = usePrefs();
  const { t } = useT();
  const value = segments.includes(prefs.segment) ? prefs.segment : "";
  return (
    <select aria-label={t("Segment")} value={value} onChange={(e) => setPrefs({ segment: e.target.value })}>
      <option value="">{t("All segments")}</option>
      {segments.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

export function ArchivedToggle() {
  const { prefs, setPrefs } = usePrefs();
  const { t } = useT();
  return (
    <label className="check" title={t("Archived repositories are read-only; their issues are frozen.")}>
      <input type="checkbox" checked={prefs.includeArchived} onChange={(e) => setPrefs({ includeArchived: e.target.checked })} />
      {t("Include archived repos")}
    </label>
  );
}

export function ExportLink({ kind, label, all = false }) {
  const { prefs } = usePrefs();
  const { t } = useT();
  const href = `/api/export/${kind}?${qs(all ? { includeArchived: 1 } : { includeArchived: prefs.includeArchived ? 1 : 0, segment: prefs.segment })}`;
  return <a className="btn" href={href} download>{label ?? t("Export CSV")}</a>;
}

/** A button that needs a GitHub token, admin rights and no running job. */
export function RunButton({ children, onClick, primary = true, small = false }) {
  const { canRun, runBlockedReason } = useStatus();
  return (
    <button type="button" className={`btn${primary ? " btn-primary" : ""}${small ? " btn-sm" : ""}`} disabled={!canRun}
      title={runBlockedReason || undefined} onClick={onClick}>{children}</button>
  );
}

export function SetupNotice() {
  const { status } = useStatus();
  const { t, rich } = useT();
  if (!status) return null;
  if (status.token.configured) return null;
  const settingsLink = (c) => <Link href="/settings">{c}</Link>;
  return (
    <div className="notice">
      <div>
        <h2>{t("Connect GitHub to start collecting")}</h2>
        <ol className="steps">
          <li>{rich("Create a token: {link} — choose “Public repositories (read-only)”. No extra permissions are needed.", {
            link: <ExtLink href="https://github.com/settings/personal-access-tokens/new">github.com/settings/personal-access-tokens/new</ExtLink>,
          })}</li>
          {status.canSaveToken
            ? <li>{status.admin.required && !status.admin.ok
              ? rich("Paste it on the <link>Settings</link> page (sign in there first).", { link: settingsLink })
              : rich("Paste it on the <link>Settings</link> page.", { link: settingsLink })}</li>
            : <li>{rich("Add it as {name} in Vercel → Project Settings → Environment Variables, then redeploy.", { name: <code>GITHUB_TOKEN</code> })}</li>}
          <li>{t("Click “Collect data”. The first run over the starter list takes a few minutes.")}</li>
        </ol>
      </div>
    </div>
  );
}

export function ErrorNotice({ error }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <div className="notice warn">
      <div><h2>{t("Something went wrong")}</h2><p>{t(error.message || String(error))}</p></div>
    </div>
  );
}

export const Loading = () => {
  const { t } = useT();
  return <div className="empty">{t("Loading…")}</div>;
};
