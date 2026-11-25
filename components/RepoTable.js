"use client";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { Dash, ExtLink, TimeAgo } from "@/components/ui";

export function RepoTable({ rows, showCompany = false, initialSort = null, onSort, empty }) {
  const columns = [
    {
      key: "name", label: "Repository", sortValue: (r) => r.fullName.toLowerCase(),
      render: (r) => (
        <div>
          <div className="cell-title">
            <ExtLink href={r.url}>{r.fullName}</ExtLink>
            {r.archived ? <span className="chip" style={{ marginLeft: 6 }}>archived</span> : null}
          </div>
          {r.description ? <div className="cell-desc" title={r.description}>{r.description}</div> : null}
        </div>
      ),
    },
    ...(showCompany ? [{ key: "company", label: "Company", render: (r) => <Link href={`/companies/${r.companyId}`}>{r.company}</Link> }] : []),
    { key: "language", label: "Language", render: (r) => r.language || <Dash /> },
    { key: "branches", label: "Branches", num: true },
    { key: "openIssues", label: "Open issues", num: true },
    { key: "closedIssues", label: "Closed issues", num: true },
    { key: "openPrs", label: "Open PRs", num: true },
    { key: "stars", label: "Stars", num: true },
    { key: "pushedAt", label: "Last push", className: "nowrap", firstDir: "desc", render: (r) => <TimeAgo iso={r.pushedAt} /> },
  ];
  return <DataTable columns={columns} rows={rows} initialSort={initialSort} onSort={onSort} empty={empty} rowKey={(r) => r.id} />;
}
