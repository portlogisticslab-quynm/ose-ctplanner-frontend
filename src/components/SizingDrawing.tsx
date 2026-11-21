// V1.7 – live drawing of the tab "Quy hoạch sơ bộ": plan (to scale, zoom with the wheel, drag to pan) and a schematic
// cross-section (ship – STS – apron lanes A·B·C·E – one yard block). Redrawn from the results on every input change.
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import { Button } from "./ui";
import type { Group, SizingResult } from "../lib/sizing";

const GROUP_FILL: Record<Group, string> = { main: "#5D6D7E", reefer: "#16A085", empty: "#B3B6B7" };
const GROUP_LABEL: Record<Group, string> = { main: "Có hàng", reefer: "Lạnh", empty: "Rỗng" };
const WATER = "#D6EAF8", SHIP = "#1F618D", STS = "#C0392B", APRON = "#E5E8E8", ROAD = "#F4F6F6", INK = "#1B2631";

type View = { x: number; y: number; w: number; h: number };

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function saveSvg(svg: SVGSVGElement | null, name: string, png: boolean) {
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const text = new XMLSerializer().serializeToString(clone);
  if (!png) { download(`${name}.svg`, new Blob([text], { type: "image/svg+xml" })); return; }
  const vb = svg.viewBox.baseVal;
  const scale = 2400 / Math.max(vb.width, 1);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(vb.width * scale); c.height = Math.round(vb.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => b && download(`${name}.png`, b), "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
}

export default function SizingDrawing({ r }: { r: SizingResult }) {
  const [mode, setMode] = useState<"plan" | "section">("plan");
  const ref = useRef<SVGSVGElement>(null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-navy/40 text-sm">
          {(["plan", "section"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 ${mode === m ? "bg-navy text-white" : "bg-white text-navy hover:bg-navy-light"}`}>
              {m === "plan" ? "Mặt bằng" : "Mặt cắt ngang"}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{mode === "plan" ? "Lăn chuột để phóng to, kéo để di chuyển, nhấp đúp để về toàn cảnh" : "Sơ đồ đúng tỷ lệ theo mét"}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" onClick={() => saveSvg(ref.current, `${r.inputs.project.code}_${mode === "plan" ? "mat_bang" : "mat_cat"}`, true)}>Tải PNG</Button>
          <Button variant="ghost" onClick={() => saveSvg(ref.current, `${r.inputs.project.code}_${mode === "plan" ? "mat_bang" : "mat_cat"}`, false)}>Tải SVG</Button>
        </div>
      </div>
      {mode === "plan" ? <Plan r={r} svgRef={ref} /> : <Section r={r} svgRef={ref} />}
    </div>
  );
}

function Plan({ r, svgRef }: { r: SizingResult; svgRef: React.RefObject<SVGSVGElement> }) {
  const lay = r.layout;
  const W = lay.width_m, D = lay.depth_m;
  const beam = r.vessels.design.beam_m;
  const water = Math.max(60, beam * 2.2);
  const siteL = r.site.length_m, siteD = r.site.depth_m;
  const full: View = useMemo(() => {
    const w = Math.max(W, siteL || 0) + 120, h = Math.max(D, siteD || 0) + water + 90;
    return { x: -60, y: -water - 40, w, h };
  }, [W, D, siteL, siteD, water]);
  const [view, setView] = useState<View | null>(null);
  const v = view && view.w <= full.w * 1.01 ? view : full;
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const fs = Math.max(full.w, full.h) / 48;   // text size in metres, readable at full view

  function onWheel(e: RWheelEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = v.x + (e.clientX - rect.left) / rect.width * v.w, py = v.y + (e.clientY - rect.top) / rect.height * v.h;
    const k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.min(full.w, Math.max(full.w / 20, v.w * k)), h = w * v.h / v.w;
    setView({ x: px - (px - v.x) * w / v.w, y: py - (py - v.y) * h / v.h, w, h });
  }
  function onDown(e: RPointerEvent<SVGSVGElement>) {
    drag.current = { x: e.clientX, y: e.clientY, v };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: RPointerEvent<SVGSVGElement>) {
    const d = drag.current, svg = svgRef.current;
    if (!d || !svg) return;
    const rect = svg.getBoundingClientRect();
    setView({ ...d.v, x: d.v.x - (e.clientX - d.x) / rect.width * d.v.w, y: d.v.y - (e.clientY - d.y) / rect.height * d.v.h });
  }

  const stsPer = r.inputs.berth.sts_per_berth;
  const groupsShown = (["main", "reefer", "empty"] as Group[]).filter((g) => r.yard.groups[g].blocks > 0);
  const mid = W / 2;
  const by1 = D - 5;
  const gwIn = Math.max(r.gate.lanes_in, 1) * 3.5 + 6, gwOut = Math.max(r.gate.lanes_out, 1) * 3.5 + 6;
  return (
    <svg ref={svgRef} viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} className="h-[520px] w-full cursor-grab touch-none select-none rounded border border-slate-200 bg-white"
      onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
      onDoubleClick={() => setView(null)} role="img" aria-label="Mặt bằng sơ bộ cảng">
      <rect x={full.x} y={-water} width={full.w} height={water} fill={WATER} />
      {/* berths + design vessels + STS */}
      {lay.berths.map((b, i) => {
        const len = Math.min(r.vessels.design.loa_m, b.x1 - b.x0 - 4);
        const cx = (b.x0 + b.x1) / 2;
        return (
          <g key={b.code}>
            <rect x={b.x0} y={-1.25 * beam} width={b.x1 - b.x0} height={1.25 * beam} fill="none" stroke="#5DADE2" strokeDasharray={`${fs / 2} ${fs / 3}`} strokeWidth={fs / 12} />
            <rect x={cx - len / 2} y={-beam - 2} width={len} height={beam} rx={beam / 2} fill={SHIP} opacity={0.85}>
              <title>{`${b.code}: tàu thiết kế ${r.vessels.design.name}, LOA ${r.vessels.design.loa_m} m, B ${beam} m`}</title>
            </rect>
            <text x={cx} y={-beam / 2 - 2 + fs / 3} fontSize={fs} fill="#fff" textAnchor="middle">{b.code}</text>
            {Array.from({ length: stsPer }, (_, k) => {
              const x = b.x0 + (b.x1 - b.x0) * (k + 1) / (stsPer + 1);
              return <rect key={k} x={x - 4} y={-beam * 0.9} width={8} height={beam * 0.9 + r.inputs.apron.edge_m + r.inputs.apron.rail_span_m} fill={STS} opacity={0.85}><title>{`STS tại ${b.code}`}</title></rect>;
            })}
            {i > 0 && <line x1={b.x0} y1={-1.25 * beam} x2={b.x0} y2={0} stroke="#5DADE2" strokeWidth={fs / 10} />}
          </g>
        );
      })}
      {/* land */}
      <rect x={0} y={0} width={W} height={D} fill={ROAD} stroke={INK} strokeWidth={fs / 8} />
      <rect x={0} y={0} width={W} height={lay.apron_m} fill={APRON} />
      <line x1={0} y1={0} x2={W} y2={0} stroke={INK} strokeWidth={fs / 4} />
      {lay.blocks.map((b) => {
        const g = r.yard.groups[b.group];
        const L = b.rotation_deg ? b.width_m : b.length_m, Wd = b.rotation_deg ? b.length_m : b.width_m;
        return (
          <g key={b.code}>
            <rect x={b.cx - L / 2} y={b.cy - Wd / 2} width={L} height={Wd} fill={GROUP_FILL[b.group]} stroke="#fff" strokeWidth={fs / 15}>
              <title>{`${b.code} – ${GROUP_LABEL[b.group]}, ${g.system}: ${g.rows} hàng × ${g.bays} bay × ${g.tiers} tầng = ${(g.rows * g.bays * g.tiers).toLocaleString("vi-VN")} TEU; ${b.length_m.toFixed(1)} × ${b.width_m.toFixed(1)} m`}</title>
            </rect>
            {Math.min(L, Wd) > fs * 1.4 && <text x={b.cx} y={b.cy + fs / 3} fontSize={fs * 0.8} fill="#fff" textAnchor="middle" pointerEvents="none">{b.code}</text>}
          </g>
        );
      })}
      {/* back zone: gates in / out, office */}
      <rect x={0} y={lay.yard_end_m} width={W} height={lay.back_m} fill="#FBFCFC" />
      <rect x={mid - 10 - gwIn} y={by1 - 30} width={gwIn} height={30} fill="#F5B041"><title>{`Cổng vào: ${r.gate.lanes_in} làn`}</title></rect>
      <rect x={mid + 10} y={by1 - 30} width={gwOut} height={30} fill="#F8C471"><title>{`Cổng ra: ${r.gate.lanes_out} làn`}</title></rect>
      <text x={mid} y={by1 - 34} fontSize={fs * 0.8} textAnchor="middle" fill={INK}>{`Cổng ${r.gate.lanes_in} vào / ${r.gate.lanes_out} ra`}</text>
      {mid - 30 - gwIn > 70 && <rect x={20} y={lay.yard_end_m + 15} width={Math.min(80, mid - 30 - gwIn) - 20} height={Math.max(10, lay.back_m - 30)} fill="#D5DBDB"><title>Nhà điều hành</title></rect>}
      {/* site boundary */}
      {(siteL || siteD) && (
        <rect x={0} y={0} width={siteL || W} height={siteD || D} fill="none" stroke={r.site.fits ? "#27AE60" : "#E74C3C"} strokeWidth={fs / 5} strokeDasharray={`${fs} ${fs / 2}`}>
          <title>{r.site.fits ? "Ranh đất: đủ" : "Ranh đất: không đủ"}</title>
        </rect>
      )}
      {/* dimensions */}
      <g stroke={INK} strokeWidth={fs / 12} fill={INK} fontSize={fs}>
        <line x1={0} y1={-water - 15} x2={W} y2={-water - 15} />
        <line x1={0} y1={-water - 22} x2={0} y2={-water - 8} /><line x1={W} y1={-water - 22} x2={W} y2={-water - 8} />
        <text x={W / 2} y={-water - 20} textAnchor="middle" stroke="none">{`L_q = ${Math.round(W).toLocaleString("vi-VN")} m (${r.berth.n_berths} bến)`}</text>
        <line x1={W + 25} y1={0} x2={W + 25} y2={D} />
        <line x1={W + 18} y1={0} x2={W + 32} y2={0} /><line x1={W + 18} y1={D} x2={W + 32} y2={D} />
        <text x={W + 30} y={D / 2} stroke="none" transform={`rotate(90 ${W + 30} ${D / 2})`} textAnchor="middle">{`sâu ${Math.round(D).toLocaleString("vi-VN")} m`}</text>
      </g>
      {/* legend */}
      <g fontSize={fs * 0.85} fill={INK}>
        {groupsShown.map((g, i) => (
          <g key={g} transform={`translate(${i * fs * 9}, ${D + fs * 2.2})`}>
            <rect width={fs * 1.2} height={fs * 0.9} y={-fs * 0.8} fill={GROUP_FILL[g]} />
            <text x={fs * 1.6}>{`${GROUP_LABEL[g]} (${r.yard.groups[g].blocks})`}</text>
          </g>
        ))}
        <g transform={`translate(${groupsShown.length * fs * 9}, ${D + fs * 2.2})`}>
          <rect width={fs * 1.2} height={fs * 0.9} y={-fs * 0.8} fill={STS} /><text x={fs * 1.6}>{`STS (${r.sts.count})`}</text>
        </g>
      </g>
    </svg>
  );
}

function Section({ r, svgRef }: { r: SizingResult; svgRef: React.RefObject<SVGSVGElement> }) {
  const ap = r.inputs.apron, y = r.inputs.yard;
  const B = r.vessels.design.beam_m, T = r.vessels.design.draft_m;
  const shipRows = Math.max(4, Math.floor(B / 2.5));
  const outreach = B + 5;
  const A = ap.edge_m, S = ap.rail_span_m, Cb = ap.backreach_m, E = ap.lanes * ap.lane_width_m;
  const apronEnd = A + S + Cb + E;
  const road = y.road_m;
  const g = r.yard.groups.main;
  const blockW = y.system === "ASC" ? g.block_length_m : g.block_width_m;
  const yardX = Math.max(apronEnd, r.quay.apron_m) + road;
  const stackW = g.rows * 2.9;
  const tierH = 2.9;
  const legH = Math.max(g.tiers * tierH + 4, 18);
  const total = yardX + blockW + 20;
  const x0 = -outreach - 25;
  const top = 50, bottom = T + 8;
  const fs = (total - x0) / 60;
  const stsH = 42;
  return (
    <svg ref={svgRef} viewBox={`${x0} ${-top - 6} ${total - x0} ${top + bottom + 18}`} className="h-[440px] w-full rounded border border-slate-200 bg-white" role="img" aria-label="Mặt cắt ngang sơ bộ">
      <rect x={x0} y={0} width={-x0} height={bottom} fill={WATER} />
      <line x1={x0} y1={0} x2={total} y2={0} stroke={INK} strokeWidth={fs / 6} />
      {/* ship */}
      <path d={`M ${-B - 2} ${-3} L ${-2} ${-3} L ${-2} ${T * 0.8} Q ${-B / 2 - 2} ${T + 1} ${-B - 2} ${T * 0.8} Z`} fill={SHIP} opacity={0.9} />
      {Array.from({ length: shipRows }, (_, i) => Array.from({ length: 4 }, (_, k) => (
        <rect key={`${i}-${k}`} x={-B - 2 + i * (B / shipRows) + 0.2} y={-3 - (k + 1) * 2.6} width={B / shipRows - 0.4} height={2.4} fill={["#E67E22", "#2E86C1", "#7F8C8D", "#16A085"][(i + k) % 4]} />
      )))}
      {/* STS */}
      <g stroke={STS} strokeWidth={fs / 3} fill="none">
        <line x1={A} y1={0} x2={A} y2={-stsH} /><line x1={A + S} y1={0} x2={A + S} y2={-stsH} />
        <line x1={-outreach} y1={-stsH} x2={A + S + Cb} y2={-stsH} />
      </g>
      <text x={-outreach} y={-stsH - 2} fontSize={fs} fill={STS}>{`STS – tầm với ≈ ${Math.round(outreach)} m, khẩu độ ${S} m`}</text>
      {/* apron strips */}
      {[[0, A, "A"], [A, S, "B"], [A + S, Cb, "C"], [A + S + Cb, E, "E"]].map(([x, w, l]) => (
        <g key={String(l)}>
          <rect x={Number(x)} y={0} width={Number(w)} height={3} fill={l === "B" ? "#AEB6BF" : l === "E" ? "#D5DBDB" : APRON} stroke="#fff" strokeWidth={0.2} />
          <text x={Number(x) + Number(w) / 2} y={7.5} fontSize={fs} textAnchor="middle" fill={INK}>{String(l)}</text>
          <text x={Number(x) + Number(w) / 2} y={11.5} fontSize={fs * 0.8} textAnchor="middle" fill="#566573">{`${Number(w).toFixed(1)} m`}</text>
        </g>
      ))}
      <text x={apronEnd / 2} y={15.5} fontSize={fs} textAnchor="middle" fill={INK}>{`Apron ${r.quay.apron_m.toFixed(1)} m`}</text>
      {/* yard block */}
      <rect x={apronEnd} y={0} width={yardX - apronEnd} height={3} fill={ROAD} />
      {y.system === "ASC" ? (
        <g>
          <rect x={yardX} y={-legH} width={blockW} height={legH} fill="none" stroke="#7D3C98" strokeWidth={fs / 4} />
          {Array.from({ length: g.tiers }, (_, k) => <rect key={k} x={yardX + 2} y={-(k + 1) * tierH} width={blockW - 4} height={tierH - 0.3} fill="#5D6D7E" opacity={0.75} />)}
          <text x={yardX + blockW / 2} y={-legH - 2} fontSize={fs} textAnchor="middle" fill={INK}>{`Khối ASC vuông góc bến: dài ${g.block_length_m.toFixed(0)} m, ${g.rows} hàng × ${g.tiers} tầng`}</text>
        </g>
      ) : (
        <g>
          <line x1={yardX} y1={0} x2={yardX} y2={-legH} stroke="#7D3C98" strokeWidth={fs / 3} />
          <line x1={yardX + blockW} y1={0} x2={yardX + blockW} y2={-legH} stroke="#7D3C98" strokeWidth={fs / 3} />
          <line x1={yardX - 1} y1={-legH} x2={yardX + blockW + 1} y2={-legH} stroke="#7D3C98" strokeWidth={fs / 2} />
          {Array.from({ length: g.rows }, (_, i) => Array.from({ length: g.tiers }, (_, k) => (
            <rect key={`${i}-${k}`} x={yardX + 1.5 + i * 2.9} y={-(k + 1) * tierH} width={2.6} height={tierH - 0.3} fill={k >= Math.round(g.tiers * y.height_ratio) ? "#D5D8DC" : "#5D6D7E"} />
          )))}
          <rect x={yardX + 1.5 + stackW + 0.5} y={-3.5} width={blockW - stackW - 3.5} height={3.5} fill="#F5B041" />
          <text x={yardX + blockW / 2} y={-legH - 2} fontSize={fs} textAnchor="middle" fill={INK}>{`${y.system} khẩu độ ≈ ${blockW.toFixed(1)} m: ${g.rows} hàng + làn xe × ${g.tiers} tầng`}</text>
        </g>
      )}
      <text x={yardX} y={7.5} fontSize={fs * 0.8} fill="#566573">{`ô xám nhạt = để trống đảo chuyển (H = ${y.height_ratio})`}</text>
      <text x={-B / 2 - 2} y={T + 5} fontSize={fs * 0.8} textAnchor="middle" fill="#1A5276">{`B ${B} m · mớn ${T} m`}</text>
    </svg>
  );
}
