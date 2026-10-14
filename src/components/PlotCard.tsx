// V1.2: one chart of the "Plot results" tab with PNG / CSV export. Charts register themselves so the page can
// export all of them at once.
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { toCsv, type Plot } from "../lib/plots";
import { Button, Card } from "./ui";

type Exporter = { title: string; png: () => Promise<Blob | null>; csv: () => string };
export const PLOT_REGISTRY = new Map<string, Exporter>();

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/** PNG of the chart with its title drawn above (2× pixel ratio, white background). */
async function chartPng(chart: echarts.ECharts, title: string, note?: string): Promise<Blob | null> {
  const url = chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
  const img = new Image();
  await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error("png")); img.src = url; });
  const head = 70, foot = note ? 50 : 10;
  const cv = document.createElement("canvas");
  cv.width = img.width; cv.height = img.height + head + foot;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#0b0b0b"; g.font = "bold 30px sans-serif"; g.fillText(title, 24, 46);
  g.drawImage(img, 0, head);
  if (note) { g.fillStyle = "#52514e"; g.font = "22px sans-serif"; g.fillText(note.slice(0, 160), 24, head + img.height + 34); }
  return new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
}

export default function PlotCard({ plot, filePrefix }: { plot: Plot; filePrefix: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const key = `${filePrefix}:${plot.id}`;
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    inst.current = chart;
    chart.setOption(plot.option as echarts.EChartsOption);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    PLOT_REGISTRY.set(key, { title: plot.title, png: () => chartPng(chart, plot.title, plot.note), csv: () => toCsv(plot.csv) });
    return () => { ro.disconnect(); PLOT_REGISTRY.delete(key); chart.dispose(); inst.current = null; };
  }, [plot, key]);

  async function png() {
    if (!inst.current) return;
    const b = await chartPng(inst.current, plot.title, plot.note);
    if (b) saveBlob(b, `${filePrefix}_${plot.id}.png`);
  }
  function csv() {
    saveBlob(new Blob([toCsv(plot.csv)], { type: "text/csv;charset=utf-8" }), `${filePrefix}_${plot.id}.csv`);
  }
  return (
    <div className="plot-card break-inside-avoid">
      <Card title={plot.title} actions={<span className="flex gap-1 print:hidden">
        <Button variant="secondary" onClick={() => void png()}>PNG</Button>
        <Button variant="secondary" onClick={csv}>CSV</Button>
      </span>}>
        <div ref={ref} style={{ width: "100%", height: plot.height ?? 280 }} />
        {plot.note && <p className="mt-1 text-xs text-slate-500">{plot.note}</p>}
      </Card>
    </div>
  );
}
