"use client";
// English / 日本語 switch with flag icons. Flags are inline SVG because Windows does not draw flag emoji.
import { useT } from "@/components/providers";
import { LANGS } from "@/lib/i18n";

export function Flag({ code }) {
  if (code === "jp") {
    return (
      <svg className="flag" viewBox="0 0 3 2" aria-hidden="true">
        <rect width="3" height="2" fill="#fff" />
        <circle cx="1.5" cy="1" r="0.6" fill="#bc002d" />
      </svg>
    );
  }
  // United States, simplified for 20 px: stripes and the blue canton (stars are too small to see).
  return (
    <svg className="flag" viewBox="0 0 195 130" preserveAspectRatio="xMinYMid slice" aria-hidden="true">
      <rect width="247" height="130" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => <rect key={i} y={i * 10} width="247" height="10" fill="#b22234" />)}
      <rect width="98.8" height="70" fill="#3c3b6e" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => (
        <circle key={`${r}-${c}`} cx={12 + c * 18.5 + (r % 2) * 9} cy={10 + r * 16} r="3.2" fill="#fff" />
      )))}
    </svg>
  );
}

export function LanguageSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <div className="seg lang-switch" role="group" aria-label={t("Language")}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} aria-label={l.label} onClick={() => setLang(l.code)}>
          <Flag code={l.flag} />
          <span className="lang-full">{l.label}</span>
          <span className="lang-short" aria-hidden="true">{l.short}</span>
        </button>
      ))}
    </div>
  );
}
