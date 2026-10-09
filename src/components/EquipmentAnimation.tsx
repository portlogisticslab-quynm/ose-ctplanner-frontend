// V0.3: animated equipment on the layout (vessels, STS, horizontal vehicles, yard cranes, external trucks).
// The server re-simulates replication 1 for the chosen window (same seed → identical run) and returns movement
// segments; positions are interpolated here at ~30 frames per second.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Badge, Button, Empty, ErrorBox, inputCls, Loading } from "./ui";
import { blockOccupancy, frameIndex, heat } from "../lib/occupancy";
import { buildTracks, clock, inPoly, KIND_LABEL, STATE_LABEL, stateAt, type Replay, type UnitState } from "../lib/replay";

const COLOR = {
  vessel: "#1E3A8A", sts: "#EA580C", loaded: "#DC2626", empty: "#16A34A", idleVeh: "#94A3B8",
  yc: "#CA8A04", ycWork: "#A16207", truck: "#475569", block: "#E2E8F0", blockEdge: "#94A3B8", road: "#CBD5E1",
};
const SPEEDS = [60, 300, 600, 1800, 3600];   // simulated seconds per real second

export default function EquipmentAnimation({ runId, horizonH, frames = [], blockCodes = [] }: {
  runId: string; horizonH: number; frames?: { t_h: number; bo?: number[]; yard_occupancy: number | null }[]; blockCodes?: string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [len, setLen] = useState(12);
  const [start, setStart] = useState(0);
  const [win, setWin] = useState<[number, number]>([0, Math.min(12, horizonH)]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(600);
  const [picked, setPicked] = useState<string | null>(null);
  const [show, setShow] = useState({ vessel: true, sts: true, veh: true, yc: true, truck: true });
  const [hasData, setHasData] = useState(false);
  const lastAng = useRef<Record<string, number>>({});

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(320, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const q = useQuery({
    queryKey: ["replay", runId, win[0], win[1]],
    queryFn: () => api<Replay>("GET", `/api/v1/runs/${runId}/replay?t0_h=${win[0]}&t1_h=${win[1]}`),
    staleTime: 3_600_000,
  });
  const rep = q.data;
  const tracks = useMemo(() => (rep ? buildTracks(rep) : []), [rep]);
  useEffect(() => { if (rep) { setT(rep.window_min[0]); setPlaying(false); setHasData(true); } }, [rep]);

  // playback loop
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !rep) return;
    let id = 0;
    const step = (now: number) => {
      const prev = last.current ?? now;
      last.current = now;
      setT((cur) => {
        const nxt = cur + ((now - prev) / 1000) * (speed / 60);
        return nxt >= rep.window_min[1] ? rep.window_min[0] : nxt;
      });
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(id); last.current = null; };
  }, [playing, speed, rep]);

  function load() {
    const s = Math.max(0, Math.min(start, horizonH - 1));
    setWin([s, Math.min(horizonH, s + len)]);
  }

  if (q.isLoading) return <div ref={box}><Loading text="Đang dựng lại mô phỏng cho cửa sổ thời gian…" /></div>;
  if (q.error) return <div ref={box}><ErrorBox error={q.error} /></div>;
  if (!rep) return <div ref={box}><Empty text="Không có dữ liệu hoạt ảnh" /></div>;

  const L = rep.layout;
  const xs: number[] = [], ys: number[] = [];
  const addPt = (p: number[]) => { xs.push(p[0]); ys.push(p[1]); };
  L.blocks.forEach((b) => b.poly.forEach(addPt));
  L.quay.forEach(addPt);
  L.berths.forEach((b) => { addPt(b.a); addPt(b.b); });
  addPt(L.gate);
  L.road.forEach((r) => { addPt([r[0], r[1]]); addPt([r[2], r[3]]); });
  const [nx, ny] = L.n;
  // vessels lie on the water side: extend the frame by 70 m seaward
  L.berths.forEach((b) => { addPt([b.a[0] - nx * 70, b.a[1] - ny * 70]); addPt([b.b[0] - nx * 70, b.b[1] - ny * 70]); });
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const h = Math.max(380, Math.min(640, w * 0.62));
  const zoom = Math.min((w - 30) / Math.max(1, maxX - minX), (h - 30) / Math.max(1, maxY - minY));
  const px = 1 / zoom;
  const ox = 15 - minX * zoom, oy = 15 - minY * zoom;

  const states = tracks.map((tr) => stateAt(tr, t)).filter((s): s is UnitState => s !== null);
  const vis = states.filter((s) => show[s.kind as keyof typeof show]);
  const sel = picked ? states.find((s) => s.uid === picked) || null : null;
  const count = (k: string, st?: string[]) => states.filter((s) => s.kind === k && (!st || st.includes(s.state))).length;
  const [ux, uy] = L.u;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  const waiting = states.filter((s) => s.kind === "vessel" && s.state === "wait");
  const occ = blockOccupancy(frames[frameIndex(frames, t, rep.warmup_min)], blockCodes);
  for (const s of states) if (s.ang !== null) lastAng.current![s.uid] = s.ang;

  function shape(s: UnitState) {
    const isSel = s.uid === picked;
    const on = { onClick: () => setPicked(s.uid), onTap: () => setPicked(s.uid) };
    const ring = isSel ? { stroke: "#111827", strokeWidth: 2.5 * px } : {};
    switch (s.kind) {
      case "vessel": {
        if (s.state === "wait") return null;    // drawn as a list at the anchorage
        const b = L.berths[s.seg?.b ?? 0];
        const blen = b ? Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) : 250;
        const vl = Math.max(80, blen * 0.85), vw = 32;
        return (
          <Group key={s.uid} x={s.x - nx * (vw / 2 + 6)} y={s.y - ny * (vw / 2 + 6)} rotation={angle} {...on}>
            <Rect x={-vl / 2} y={-vw / 2} width={vl} height={vw} cornerRadius={vw / 2} fill={COLOR.vessel} opacity={0.9} {...ring} />
            <Text x={-vl / 2} y={-6 * px} width={vl} align="center" fontSize={11 * px} fill="#fff" text={`${s.uid} · ${s.seg?.n ?? ""} move`} />
          </Group>
        );
      }
      case "sts":
        return (
          <Group key={s.uid} x={s.x} y={s.y} rotation={angle} {...on}>
            <Rect x={-6} y={-45} width={12} height={60} fill={COLOR.sts} opacity={s.state === "idle" ? 0.45 : 1} {...ring} />
            {zoom > 0.8 && <Text x={-20} y={18} fontSize={9 * px} fill={COLOR.sts} text={s.uid} />}
          </Group>
        );
      case "veh": {
        const c = s.state === "loaded" ? COLOR.loaded : s.state === "empty" ? COLOR.empty : COLOR.idleVeh;
        // terminal tractor + chassis: 4 × 15 m, aligned with the lane it drives on
        const vl = Math.max(15, 9 * px), vw = Math.max(4, 4 * px);
        return (
          <Group key={s.uid} x={s.x} y={s.y} rotation={s.ang ?? lastAng.current![s.uid] ?? angle} {...on}>
            <Rect x={-vl / 2} y={-vw / 2} width={vl} height={vw} fill={c} cornerRadius={vw / 3} {...ring} />
            {s.state === "loaded" && <Rect x={-vl / 2 + 1} y={-vw / 2 + 0.6} width={vl * 0.65} height={vw - 1.2} fill="#FCA5A5" />}
          </Group>
        );
      }
      case "yc": {
        // RTG gantry spanning the block: two legs across the stack, moving along the block axis
        const blk = L.blocks.find((b) => inPoly(s.x, s.y, b.poly));
        const span = (blk?.width ?? 20) + 6;
        const rot = blk ? (blk.along_u === false ? angle + 90 : angle) : (s.ang ?? angle) + 90;
        const work = s.state === "work";
        return (
          <Group key={s.uid} x={s.x} y={s.y} rotation={rot} {...on}>
            <Rect x={-4} y={-span / 2} width={8} height={span} fill={work ? COLOR.ycWork : COLOR.yc}
              opacity={s.state === "idle" ? 0.35 : 0.55} stroke={isSel ? "#111827" : COLOR.ycWork} strokeWidth={(isSel ? 2.5 : 1) * px} />
            <Line points={[-4, -span / 2, 4, -span / 2]} stroke="#713F12" strokeWidth={3} />
            <Line points={[-4, span / 2, 4, span / 2]} stroke="#713F12" strokeWidth={3} />
            {work && <Rect x={-2} y={-3} width={4} height={6} fill="#713F12" />}
            {zoom > 1.2 && <Text x={6} y={-span / 2} fontSize={9 * px} fill="#713F12" text={s.uid} />}
          </Group>
        );
      }
      case "truck":
        return <Rect key={s.uid} x={s.x - 3 * px} y={s.y - 3 * px} width={6 * px} height={6 * px} fill={COLOR.truck} {...ring} {...on} />;
      default:
        return null;
    }
  }

  const span = rep.window_min[1] - rep.window_min[0];
  return (
    <div ref={box} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">Từ giờ
          <input className={`${inputCls} w-20`} type="number" min={0} max={Math.max(0, horizonH - 1)} value={start}
            onChange={(e) => setStart(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1">dài
          <select className={inputCls} value={len} onChange={(e) => setLen(Number(e.target.value))}>
            {[6, 12, 24, 48].map((x) => <option key={x} value={x}>{x} giờ</option>)}
          </select>
        </label>
        <Button variant="secondary" onClick={load}>Tải cửa sổ</Button>
        <span className="text-xs text-slate-500">đang xem giờ {rep.window_h[0]}–{rep.window_h[1]} sau warm-up (replication 1, seed {rep.seed})</span>
        {rep.verified ? <Badge tone="green">khớp lần chạy gốc</Badge> : <Badge tone="amber">chưa đối chiếu</Badge>}
        {rep.truncated && <Badge tone="amber">quá nhiều chuyển động – rút ngắn cửa sổ</Badge>}
      </div>

      <div className="relative rounded border border-slate-200 bg-slate-50">
        <Stage width={w} height={h} x={ox} y={oy} scaleX={zoom} scaleY={zoom}>
          <Layer listening={false}>
            {/* yard lanes (8 m wide) with a dashed centre line: vehicles and trucks drive only on these */}
            {L.road.map((r, i) => <Line key={`r${i}`} points={r} stroke={COLOR.road} strokeWidth={8} lineCap="square" />)}
            {L.road.map((r, i) => <Line key={`rc${i}`} points={r} stroke="#fff" strokeWidth={0.6} dash={[4, 4]} />)}
            {L.quay.length > 1 && <Line points={L.quay.flat()} stroke="#334155" strokeWidth={2 * px} />}
            {L.berths.map((b) => (
              <Fragment key={b.code}>
                <Line points={[...b.a, ...b.b]} stroke="#1E3A8A" strokeWidth={4 * px} />
                <Text x={b.a[0] - nx * 60} y={b.a[1] - ny * 60} fontSize={11 * px} fill="#1E3A8A" text={b.code} />
              </Fragment>
            ))}
            {L.blocks.map((b) => (
              <Fragment key={b.code}>
                <Line points={b.poly.flat()} closed fill={occ.has(b.code) ? heat(occ.get(b.code)) : COLOR.block}
                  opacity={occ.has(b.code) ? 0.55 : 1} stroke={COLOR.blockEdge} strokeWidth={px} />
                {zoom > 0.5 && <Text x={b.c[0]} y={b.c[1]} offsetX={10 * px} offsetY={5 * px} fontSize={10 * px} fill="#64748B" text={occ.has(b.code) ? `${b.code} ${Math.round((occ.get(b.code) ?? 0) * 100)}%` : b.code} />}
              </Fragment>
            ))}
            <Rect x={L.gate[0] - 8 * px} y={L.gate[1] - 8 * px} width={16 * px} height={16 * px} fill="#0F766E" />
            <Text x={L.gate[0] + 10 * px} y={L.gate[1] - 6 * px} fontSize={11 * px} fill="#0F766E" text="Cổng" />
          </Layer>
          <Layer>
            {vis.filter((s) => s.kind === "vessel").map(shape)}
            {vis.filter((s) => s.kind === "yc").map(shape)}
            {vis.filter((s) => s.kind === "truck").map(shape)}
            {vis.filter((s) => s.kind === "veh").map(shape)}
            {vis.filter((s) => s.kind === "sts").map(shape)}
            {show.vessel && waiting.length > 0 && L.berths[0] && (
              <Text x={L.berths[0].a[0] - nx * 85 + 40 * px} y={L.berths[0].a[1] - ny * 85} fontSize={12 * px} fill="#B91C1C"
                text={`${waiting.length} tàu chờ bến: ${waiting.map((s) => s.uid).join(", ")}`} />
            )}
          </Layer>
        </Stage>
        <div className="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-xs shadow">
          <div className="font-semibold">{clock(t, rep.warmup_min)}</div>
          <div><span style={{ color: COLOR.loaded }}>●</span> xe có hàng <span style={{ color: COLOR.empty }}>●</span> xe rỗng <span style={{ color: COLOR.idleVeh }}>●</span> xe đứng</div>
          <div><span style={{ color: COLOR.sts }}>▮</span> STS <span style={{ color: COLOR.yc }}>■</span> cẩu bãi <span style={{ color: COLOR.truck }}>■</span> xe tải <span style={{ color: COLOR.vessel }}>▬</span> tàu</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="secondary" onClick={() => setPlaying(!playing)}>{playing ? "⏸ Dừng" : "▶ Chạy"}</Button>
        <input className="w-72" type="range" min={0} max={1000} value={span > 0 ? Math.round(((t - rep.window_min[0]) / span) * 1000) : 0}
          onChange={(e) => setT(rep.window_min[0] + (Number(e.target.value) / 1000) * span)} />
        <label className="flex items-center gap-1">tốc độ
          <select className={inputCls} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}× ({(s / 60).toFixed(0)} phút/giây)</option>)}
          </select>
        </label>
        {(Object.keys(show) as (keyof typeof show)[]).map((k) => (
          <label key={k} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {KIND_LABEL[k]}
          </label>
        ))}
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
        <span>Tàu: <b>{count("vessel", ["berth"])}</b> làm hàng · <b>{waiting.length}</b> chờ</span>
        <span>STS: <b>{count("sts", ["D", "L"])}</b> nâng/hạ · {count("sts", ["move"])} di chuyển · {count("sts", ["idle"])} đứng</span>
        <span>Xe ngang: <b>{count("veh", ["loaded"])}</b> có hàng · <b>{count("veh", ["empty"])}</b> rỗng · {count("veh", ["idle"])} đứng</span>
        <span>Cẩu bãi: <b>{count("yc", ["work"])}</b> làm việc · {count("yc", ["move"])} chuyển block · {count("yc", ["idle"])} rảnh</span>
        <span>Xe tải trong cảng: <b>{count("truck")}</b></span>
      </div>

      {sel && (
        <div className="rounded border border-slate-200 bg-white p-2 text-xs">
          <b>{KIND_LABEL[sel.kind]} {sel.uid}</b> — {sel.kind === "truck" && sel.state === "work" ? "tại block (chờ cẩu + nâng/hạ)" : STATE_LABEL[sel.state] || sel.state}
          {sel.seg && <> · từ {clock(sel.seg.t0, rep.warmup_min)} đến {clock(sel.seg.t1, rep.warmup_min)}{sel.seg.open ? " (còn tiếp)" : ""}</>}
          {sel.seg?.v !== undefined && <> · tàu VS-{String(sel.seg.v + 1).padStart(4, "0")}</>}
          {" "}· vị trí ({sel.x.toFixed(0)}, {sel.y.toFixed(0)}) m
          <button className="ml-2 text-slate-500 underline" onClick={() => setPicked(null)}>bỏ chọn</button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Bấm vào thiết bị để xem trạng thái. Xe "đứng" là đang chờ dưới cẩu, chờ cẩu bãi hoặc thao tác. Xe ngang và xe tải chỉ chạy trên lưới làn nội bãi (song song và vuông góc mép bến, tự sinh theo hàng/cột block); cẩu bãi chạy dọc block giữa các vị trí làm hàng.
        {L.schematic && " Mặt bằng sơ đồ: phương án chưa vẽ đủ block/bến trên layout."}
      </p>
    </div>
  );
}
