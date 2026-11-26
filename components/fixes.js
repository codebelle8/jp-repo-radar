"use client";
// Shared pieces of the Auto-fix pages.
import { useT } from "@/components/providers";
import { msg } from "@/lib/i18n";

export const STATUS = {
  running: [msg("Working"), ""],
  blocked: [msg("Blocked"), "chip-minus"],
  failed: [msg("Failed"), "chip-minus"],
  needs_attention: [msg("Needs attention"), "chip-minus"],
  ready: [msg("Ready for review"), "chip-plus"],
  pr_open: [msg("PR open"), ""],
  reply_ready: [msg("Reply ready"), "chip-plus"],
  merged: [msg("Merged"), "chip-plus"],
  closed: [msg("Closed"), ""],
  cancelled: [msg("Cancelled"), ""],
};

export function FixStatus({ status, phase }) {
  const { t } = useT();
  const [label, cls] = STATUS[status] || [status, ""];
  const text = status === "running" && phase === "review" ? t("Addressing review") : t(label);
  return <span className={`chip ${cls}`}>{status === "running" ? <span className="spinner" aria-hidden="true" /> : null}{text}</span>;
}

/** A stored {text, vars} message, translated. */
export function Note({ note }) {
  const { t } = useT();
  if (!note) return null;
  return <>{t(note.text, note.vars)}</>;
}

export const dollars = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

/** Unified diff with added / removed lines coloured. */
export function Patch({ patch }) {
  if (!patch) return null;
  return (
    <pre className="code-block">
      {patch.split("\n").map((line, i) => (
        <span key={i} className={line.startsWith("+") ? "diff-line-add" : line.startsWith("-") ? "diff-line-del" : line.startsWith("@@") ? "diff-line-hunk" : undefined}>
          {line}{"\n"}
        </span>
      ))}
    </pre>
  );
}
