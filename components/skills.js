"use client";
// Skill match pieces shared by the Tracker and Contribute pages (only rendered for a signed-in owner).
import { useState } from "react";
import { useToast } from "@/components/providers";
import { Dash } from "@/components/ui";
import { api, useApi } from "@/lib/client";

export function useSkills(canEdit, deps = []) {
  return useApi(canEdit ? "/api/skills" : null, deps);
}

/** "62%" with a bar; the tooltip says which languages matched. */
export function SkillMatch({ m }) {
  if (!m) return <Dash />;
  const parts = [
    m.shared.length ? `You use: ${m.shared.join(", ")}` : null,
    m.related.length ? `Related (half credit): ${m.related.join(", ")}` : null,
    m.missing.length ? `Not in your list: ${m.missing.join(", ")}` : null,
    `Based on ${m.repos} ${m.recent ? "recently active " : ""}repositories: ${m.top.map((l) => `${l.name} ${l.share}%`).join(", ")}`,
  ].filter(Boolean);
  return (
    <div className="score" title={parts.join("\n")}>
      <strong className="num" style={{ minWidth: 34 }}>{m.score}%</strong>
      <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${m.score}%` }} /></div>
    </div>
  );
}

const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/** Search links for a company's engineering hiring page and casual interviews. */
export function HiringLinks({ name }) {
  if (!name) return null;
  return (
    <span className="small muted nowrap">
      Search:{" "}
      <a href={google(`${name} エンジニア 採用`)} target="_blank" rel="noopener noreferrer">採用</a>{" · "}
      <a href={google(`${name} カジュアル面談`)} target="_blank" rel="noopener noreferrer">カジュアル面談</a>
    </span>
  );
}

const lower = (s) => s.toLowerCase();

/** Your languages as removable chips, hidden ones with Restore, and an Add field. */
export function SkillsEditor({ skills, onSaved }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const detected = new Map(skills.detected.map((l) => [lower(l.name), l]));
  const without = (list, name) => list.filter((n) => lower(n) !== lower(name));

  async function save(added, removed) {
    setBusy(true);
    try { onSaved(await api("/api/skills", { method: "PUT", body: { added, removed } })); } catch (err) { toast(err.message, true); } finally { setBusy(false); }
  }
  const remove = (name) => save(without(skills.added, name), detected.has(lower(name)) ? [...without(skills.removed, name), name] : skills.removed);
  const restore = (name) => save(skills.added, without(skills.removed, name));
  function add(e) {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    const known = skills.allLanguages.find((l) => lower(l) === lower(name)) || name;   // use GitHub's spelling
    setText("");
    if (skills.removed.some((n) => lower(n) === lower(known))) restore(known);
    else if (!skills.languages.some((n) => lower(n) === lower(known))) save([...skills.added, known], skills.removed);
  }
  const hint = (name) => {
    const d = detected.get(lower(name));
    if (!d) return "Added by you";
    return [d.repos ? `10%+ of the code in ${d.repos} of your repositories` : null,
      d.contributed ? `${d.contributed} repositories you contributed to` : null].filter(Boolean).join("; ");
  };

  return (
    <div>
      <div className="row" style={{ gap: 4 }}>
        {skills.languages.length ? skills.languages.map((name) => (
          <span key={name} className="chip" title={hint(name)}>
            {name}
            <button type="button" className="chip-x" onClick={() => remove(name)} disabled={busy} aria-label={`Remove ${name}`}>×</button>
          </span>
        )) : <span className="faint">No languages yet.</span>}
        <form className="row" onSubmit={add} style={{ gap: 6, marginLeft: 4 }}>
          <input type="text" list="skill-languages" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a language"
            aria-label="Add a language" style={{ width: 150 }} maxLength={40} />
          <datalist id="skill-languages">{skills.allLanguages.map((l) => <option key={l} value={l} />)}</datalist>
          <button type="submit" className="btn btn-sm" disabled={busy || !text.trim()}>Add</button>
        </form>
      </div>
      {skills.removed.length ? (
        <div className="small muted" style={{ marginTop: 6 }}>
          Hidden:{" "}
          {skills.removed.map((name, i) => (
            <span key={name}>{i ? ", " : ""}{name} (<button type="button" className="link-btn" onClick={() => restore(name)} disabled={busy}>restore</button>)</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
