"use client";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { useT } from "@/components/providers";
import { Dash, ExtLink, TimeAgo } from "@/components/ui";

export function RepoTable({ rows, showCompany = false, initialSort = null, onSort, empty }) {
  const { t } = useT();
  const columns = [
    {
      key: "name", label: t("Repository"), sortValue: (r) => r.fullName.toLowerCase(),
      render: (r) => (
        <div>
          <div className="cell-title">
            <ExtLink href={r.url}>{r.fullName}</ExtLink>
            {r.archived ? <span className="chip" style={{ marginLeft: 6 }}>{t("archived")}</span> : null}
          </div>
          {r.description ? <div className="cell-desc" title={r.description}>{r.description}</div> : null}
        </div>
      ),
    },
    ...(showCompany ? [{ key: "company", label: t("Company"), render: (r) => <Link href={`/companies/${r.companyId}`}>{r.company}</Link> }] : []),
    { key: "language", label: t("Language"), render: (r) => r.language || <Dash /> },
    { key: "branches", label: t("Branches"), num: true },
    { key: "openIssues", label: t("Open issues"), num: true },
    { key: "closedIssues", label: t("Closed issues"), num: true },
    { key: "openPrs", label: t("Open PRs"), num: true },
    { key: "stars", label: t("Stars"), num: true },
    { key: "pushedAt", label: t("Last push"), className: "nowrap", firstDir: "desc", render: (r) => <TimeAgo iso={r.pushedAt} /> },
  ];
  return <DataTable columns={columns} rows={rows} initialSort={initialSort} onSort={onSort} empty={empty} rowKey={(r) => r.id} />;
}
