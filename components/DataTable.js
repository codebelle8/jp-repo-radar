"use client";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/format";

/**
 * Column header that sorts on click / Enter / Space. `sort` is { key, dir }; clicking the active column
 * flips the direction, clicking another starts at `firstDir` (default: desc for numbers, asc for text).
 */
export function SortTh({ sortKey, label, sort, onSort, num = false, firstDir, title, sortable = true }) {
  if (!sortable) return <th scope="col" className={num ? "num" : undefined} title={title}>{label}</th>;
  const active = sort?.key === sortKey;
  const activate = () => onSort(active ? { key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" }
    : { key: sortKey, dir: firstDir || (num ? "desc" : "asc") });
  const arrow = <span className="arrow" aria-hidden="true">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>;
  return (
    <th scope="col" title={title} className={num ? "num sortable" : "sortable"} tabIndex={0}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={activate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } }}>
      {/* Numeric columns are right-aligned: arrow first keeps the label flush with the numbers. */}
      {num ? <>{arrow}{label}</> : <>{label}{arrow}</>}
    </th>
  );
}

/**
 * Sortable table.
 * columns: [{ key, label, num?, sortable?, firstDir?, sortValue?(row), render?(row), className?, title? }]
 * Pass `onSort(key, dir)` to sort on the server instead (rows are then shown as given).
 */
export function DataTable({ columns, rows, initialSort = null, onRowClick, empty = "Nothing to show yet.", onSort, rowKey }) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    if (onSort || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const value = col?.sortValue || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (va == null || va === "") return vb == null || vb === "" ? 0 : 1;
      if (vb == null || vb === "") return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns, onSort]);

  function changeSort(next) {
    setSort(next);
    if (onSort) onSort(next.key, next.dir);
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <SortTh key={col.key} sortKey={col.key} label={col.label} title={col.title} num={!!col.num}
                firstDir={col.firstDir} sortable={col.sortable !== false} sort={sort} onSort={changeSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>
          ) : sorted.map((row, i) => (
            <tr key={rowKey ? rowKey(row) : i} className={onRowClick ? "clickable" : undefined}
              onClick={onRowClick ? (e) => { if (!e.target.closest("a, button, input, select, label")) onRowClick(row); } : undefined}>
              {columns.map((col) => (
                <td key={col.key} className={col.num ? "num" : col.className}>
                  {col.render ? col.render(row) : col.num ? fmt(row[col.key]) : (row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
