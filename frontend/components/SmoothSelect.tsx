"use client";

// Animated dropdown that replaces native <select> — pops open smoothly,
// options stagger in, chevron spins. Keyboard: Esc closes. Styled to match
// .modal-input on the original teacher-panel design.
import { useEffect, useRef, useState } from "react";
import "./smooth-select.css";

export interface SSOption {
  value: string;
  label: string;
}

interface SmoothSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: SSOption[];
  placeholder?: string;
  className?: string;
}

export default function SmoothSelect({ value, onChange, options, placeholder = "Select…", className }: SmoothSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`ss-root${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`ss-trigger${open ? " open" : ""}${!selected ? " empty" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ss-trigger-text">{selected ? selected.label : placeholder}</span>
        <i className="fa-solid fa-chevron-down ss-chevron" />
      </button>
      {open && (
        <div className="ss-list" role="listbox">
          {options.map((o, i) => (
            <button
              type="button"
              role="option"
              aria-selected={o.value === value}
              key={o.value}
              className={`ss-option${o.value === value ? " selected" : ""}`}
              style={{ animationDelay: `${Math.min(i * 18, 180)}ms` }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
