"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CardHead } from "@/components/ui";
import { useStatus, useT } from "@/components/providers";

export function CompanyForm({ company, segments, onSave, onCancel }) {
  const { status } = useStatus();
  const { t } = useT();
  const listId = useId();
  const nameRef = useRef(null);
  const [form, setForm] = useState({
    name: company?.name || "", nameJa: company?.nameJa || "", website: company?.website || "",
    segment: company?.segment || "", orgs: company ? company.orgs.map((o) => o.login).join(", ") : "",
  });
  const [collect, setCollect] = useState(!company && !!status?.token?.configured);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const field = (key) => ({ value: form[key], onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })) });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({ ...form, orgs: form.orgs.split(/[\s,]+/).filter(Boolean), collect });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <CardHead title={company ? t("Edit company") : t("Add a company")} sub={t("GitHub orgs: the login in github.com/<login>, separated by commas")} />
      <div className="form-grid">
        <label className="field"><span>{t("Company name")}</span><input ref={nameRef} type="text" required {...field("name")} /></label>
        <label className="field"><span>{t("Japanese name")}</span><input type="text" placeholder="株式会社…" {...field("nameJa")} /></label>
        <label className="field"><span>{t("Website")}</span><input type="url" placeholder="https://example.co.jp" {...field("website")} /></label>
        <label className="field"><span>{t("Segment")}</span><input type="text" list={listId} placeholder={t("e.g. SaaS / B2B")} {...field("segment")} /></label>
        <label className="field"><span>{t("GitHub organizations")}</span><input type="text" required placeholder="github-org, another-org" {...field("orgs")} /></label>
      </div>
      <datalist id={listId}>{segments.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="row" style={{ marginTop: 12 }}>
        {company ? null : (
          <label className="check"><input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
            {t("Collect its repositories right away")}</label>
        )}
        <span className="spacer" />
        {error ? <p className="small form-error">{t(error)}</p> : null}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{company ? t("Save changes") : t("Add company")}</button>
      </div>
    </form>
  );
}
