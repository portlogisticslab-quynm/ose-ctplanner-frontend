import { ReactNode, useEffect, useRef } from "react";
import * as echarts from "echarts";
import { ApiError } from "../api/client";

export function Button({ children, onClick, variant = "primary", disabled, type = "button", title }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean; type?: "button" | "submit"; title?: string;
}) {
  const cls = {
    primary: "bg-navy text-white hover:bg-[#0f2440]",
    secondary: "bg-white text-navy border border-navy/40 hover:bg-navy-light",
    danger: "bg-red-700 text-white hover:bg-red-800",
    ghost: "text-navy hover:bg-navy-light",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}>
      {children}
    </button>
  );
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-navy">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ text = "Đang tải…" }: { text?: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{text}</p>;
}

export function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{text}</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = Array.isArray(e.details) ? (e.details as Record<string, unknown>[]) : [];
  return (
    <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <p className="font-medium">{e.message || String(error)} {e.code ? <span className="text-xs text-red-600">({e.code})</span> : null}</p>
      {details.length > 0 && (
        <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-xs">
          {details.slice(0, 50).map((d, i) => (
            <li key={i}>{String(d.message ?? d.msg ?? JSON.stringify(d))}{d.path ? ` – ${String(d.path)}` : ""}</li>
          ))}
        </ul>
      )}
      {e.requestId && <p className="mt-1 text-xs text-red-500">request_id: {e.requestId}</p>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "rounded border border-slate-300 px-2 py-1 text-sm focus:border-navy focus:outline-none";

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const cls = { slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-800", amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800", blue: "bg-blue-100 text-blue-800" }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function Chart({ option, height = 280 }: { option: object; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(option as echarts.EChartsOption);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [option]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

export function Table({ head, rows, empty = "Không có dữ liệu" }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-navy text-left text-white">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 ? "bg-slate-50" : "bg-white"}>
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onClose}>
      <div className={`mt-10 w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-lg bg-white p-4 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-navy">{title}</h2>
          <button className="text-xl leading-none text-slate-500 hover:text-slate-800" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
