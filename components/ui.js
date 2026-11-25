"use client";
import Link from "next/link";
import { usePrefs, useStatus } from "@/components/providers";
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
  return orgs.map((o) => {
    const bad = o.status === "error" || o.status === "not_found";
    const title = o.status === "not_found" ? "Not found on GitHub" : o.status === "error" ? `Error: ${o.error || ""}`
      : o.status === "pending" ? "Not collected yet" : o.name || o.login;
    return (
      <a key={o.login} className={`chip${bad ? " chip-minus" : ""}`} href={ghUrl(o.login)} target="_blank"
        rel="noopener noreferrer" title={title}>{o.login}</a>
    );
  });
}

export function SegmentSelect({ segments }) {
  const { prefs, setPrefs } = usePrefs();
  const value = segments.includes(prefs.segment) ? prefs.segment : "";
  return (
    <select aria-label="Segment" value={value} onChange={(e) => setPrefs({ segment: e.target.value })}>
      <option value="">All segments</option>
      {segments.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

export function ArchivedToggle() {
  const { prefs, setPrefs } = usePrefs();
  return (
    <label className="check" title="Archived repositories are read-only; their issues are frozen.">
      <input type="checkbox" checked={prefs.includeArchived} onChange={(e) => setPrefs({ includeArchived: e.target.checked })} />
      Include archived repos
    </label>
  );
}

export function ExportLink({ kind, label = "Export CSV", all = false }) {
  const { prefs } = usePrefs();
  const href = `/api/export/${kind}?${qs(all ? { includeArchived: 1 } : { includeArchived: prefs.includeArchived ? 1 : 0, segment: prefs.segment })}`;
  return <a className="btn" href={href} download>{label}</a>;
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
  if (!status) return null;
  if (status.token.configured) return null;
  return (
    <div className="notice">
      <div>
        <h2>Connect GitHub to start collecting</h2>
        <ol className="steps">
          <li>Create a token: <ExtLink href="https://github.com/settings/personal-access-tokens/new">github.com/settings/personal-access-tokens/new</ExtLink>{" "}
            — choose “Public repositories (read-only)”. No extra permissions are needed.</li>
          {status.canSaveToken
            ? <li>Paste it on the <Link href="/settings">Settings</Link> page{status.admin.required && !status.admin.ok ? " (sign in there first)" : ""}.</li>
            : <li>Add it as <code>GITHUB_TOKEN</code> in Vercel → Project Settings → Environment Variables, then redeploy.</li>}
          <li>Click “Collect data”. The first run over the starter list takes a few minutes.</li>
        </ol>
      </div>
    </div>
  );
}

export function ErrorNotice({ error }) {
  if (!error) return null;
  return (
    <div className="notice warn">
      <div><h2>Something went wrong</h2><p>{error.message || String(error)}</p></div>
    </div>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;
