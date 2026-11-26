"use client";
// In-app notifications (signed-in owner only): bell with unread count in the header, a panel with the latest items,
// and a toast when something new arrives. The unread count comes with the regular status poll.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStatus, useT, useToast } from "@/components/providers";
import { api } from "@/lib/client";
import { ago } from "@/lib/format";

export function NotificationBell() {
  const { status, refresh } = useStatus();
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const prev = useRef(null);
  const ref = useRef(null);
  const signedIn = !!status?.admin?.ok;
  const unread = status?.notifications?.unread ?? 0;

  // GitHub values inside a title (review state) are translated too.
  const varsOf = (item) => (item.vars?.state ? { ...item.vars, state: t(item.vars.state) } : item.vars);

  async function load(announce = false) {
    try {
      const d = await api("/api/notifications");
      setData(d);
      const newest = d.items.find((n) => !n.read);
      if (announce && newest) toast(t("New notification: {title}", { title: t(newest.title, varsOf(newest)) }));
    } catch { /* shown on next open */ }
  }

  useEffect(() => {   // announce new notifications that arrive with the status poll
    if (!signedIn) return;
    if (prev.current != null && unread > prev.current) load(true);
    prev.current = unread;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, signedIn]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!signedIn) return null;

  async function mark(body) {
    try { setData(await api("/api/notifications", { body })); refresh(); } catch (err) { toast(err.message, true); }
  }
  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  return (
    <div className="notif" ref={ref}>
      <button type="button" className="icon-btn notif-btn" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? t("Notifications ({n} unread)", { n: unread }) : t("Notifications")} title={t("Notifications")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z" /></svg>
        {unread ? <span className="notif-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel" role="dialog" aria-label={t("Notifications")}>
          <div className="notif-head">
            <strong>{t("Notifications")}</strong>
            <button type="button" className="link-btn small" onClick={() => mark({ all: true })} disabled={!data?.unread}>{t("Mark all as read")}</button>
          </div>
          {!data ? <div className="notif-empty">{t("Loading…")}</div>
            : !data.items.length ? <div className="notif-empty">{t("No notifications yet. Auto-fix results and pull request reviews will appear here.")}</div>
              : (
                <ul className="notif-list">
                  {data.items.map((n) => (
                    <li key={n.id}>
                      <Link href={n.link || "/fixes"} className={`notif-item${n.read ? "" : " unread"}`}
                        onClick={() => { setOpen(false); if (!n.read) mark({ ids: [n.id] }); }}>
                        <span className="notif-title">{t(n.title, varsOf(n))}</span>
                        {n.body ? <span className="notif-body">{t(n.body, n.vars)}</span> : null}
                        <span className="notif-time">{ago(n.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      ) : null}
    </div>
  );
}
