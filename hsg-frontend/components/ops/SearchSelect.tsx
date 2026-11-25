"use client";
/**
 * Searchable select (ARIA combobox + listbox). Type to filter by any of an option's search text,
 * arrow keys to move, Enter to pick, Escape to close. Used where a plain <select> is too long to scan
 * (e.g. 100+ virtual accounts in the NIP inflow simulator).
 */
import { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchOption {
  value: string;
  /** Text shown in the closed field. */
  label: string;
  /** Extra text matched by the search (e.g. account number). */
  search?: string;
  /** Optional rich row; defaults to `label`. */
  render?: ReactNode;
}

const MAX_ROWS = 60;

export function SearchSelect({ id, options, value, onChange, placeholder = "Search…", disabled, emptyText = "No matches" }: {
  id: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
}) {
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(
    () => options.filter((o) => {
      const hay = `${o.label} ${o.search ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, query],
  );
  const shown = matches.slice(0, MAX_ROWS);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 && idx < MAX_ROWS ? idx : 0);
  }
  function close() { setOpen(false); setQuery(""); }
  function pick(o: SearchOption) { onChange(o.value); close(); input.current?.blur(); }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close();
  }

  return (
    <div ref={wrap} className="relative">
      <div className={`flex items-center h-[46px] rounded-[14px] bg-white text-teal ${open ? "ring-2 ring-lime" : ""} ${disabled ? "opacity-60" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="ml-3.5 shrink-0 text-teal-grey">
          <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth={1.8} /><path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          disabled={disabled}
          autoComplete="off"
          value={open ? query : selected?.label ?? ""}
          placeholder={open ? placeholder : selected ? "" : placeholder}
          onFocus={openList}
          onClick={() => !open && openList()}
          onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          onKeyDown={onKey}
          className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none px-2.5 text-[14px] placeholder:text-teal-grey"
        />
        <button type="button" tabIndex={-1} aria-label={open ? "Close list" : "Open list"} disabled={disabled}
          onClick={() => (open ? close() : (input.current?.focus(), openList()))}
          className="h-full px-3.5 text-teal-grey cursor-pointer bg-transparent border-0">
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1.5 rounded-[14px] bg-white text-teal shadow-[0_18px_44px_rgba(8,37,46,0.35)] overflow-hidden">
          <ul ref={list} id={listId} role="listbox" className="max-h-[280px] overflow-y-auto m-0 p-1.5 list-none">
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-[14px] cursor-pointer ${i === active ? "bg-lime-soft" : ""} ${isSel ? "font-semibold" : ""}`}
                >
                  <span className="flex-1 min-w-0">{o.render ?? o.label}</span>
                  {isSel && <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-3 py-3 text-[14px] text-teal-grey">{emptyText}</li>}
          </ul>
          <div className="px-4 py-2 border-t border-line-soft text-[12px] text-teal-grey">
            {matches.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${matches.length} · keep typing to narrow` : `${matches.length} of ${options.length}`} · ↑↓ to move, Enter to pick
          </div>
        </div>
      )}
    </div>
  );
}
