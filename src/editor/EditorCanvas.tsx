// 2D layout canvas (react-konva). World units = metres; screen = world × zoom + offset (y grows downwards).
import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { localToProjected, niceBar, roundScale, scaleDenominator, type GeorefOrigin } from "../lib/georef";
import { Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { Background, Layer as LayerT, LayoutObject, RoadGraph } from "../api/types";
import { CLASS_COLOR, TYPE_INFO } from "../lib/format";
import { area, centroid, dist, lengthOf, ringOf, snap, translateGeom, type Pt } from "../lib/geometry";

export type Tool = "select" | "pan" | "polygon" | "line" | "point" | "measure" | "road" | "calibrate";

export interface View { zoom: number; x: number; y: number }

interface Props {
  width: number;
  height: number;
  objects: LayoutObject[];
  road: RoadGraph;
  layers: LayerT[];
  tool: Tool;
  grid: number;
  snapOn: boolean;
  selected: string | null;
  selectedEdge: string | null;
  highlight: Set<string>;
  view: View;
  setView: (v: View) => void;
  background: Background | null;
  backgroundUrl: string | null;
  editable: boolean;
  onSelect: (code: string | null) => void;
  onSelectEdge: (code: string | null) => void;
  onChange: (objects: LayoutObject[]) => void;
  onDrawFinish: (kind: "polygon" | "line" | "point", pts: Pt[]) => void;
  onRoadSegment: (a: Pt, b: Pt) => void;
  onCalibratePoint: (world: Pt) => void;
  calibPts: Pt[];
  georef?: GeorefOrigin | null;   // V0.4: show projected coordinates of the cursor
}

function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

export default function EditorCanvas(p: Props) {
  const stageRef = useRef<Konva.Stage>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [measure, setMeasure] = useState<Pt[]>([]);
  const img = useImage(p.backgroundUrl);
  const hidden = useMemo(() => new Set(p.layers.filter((l) => !l.visible).map((l) => l.name)), [p.layers]);
  const lockedLayers = useMemo(() => new Set(p.layers.filter((l) => l.locked).map((l) => l.name)), [p.layers]);
  const px = 1 / p.view.zoom; // one screen pixel in metres

  useEffect(() => { setDraft([]); setMeasure([]); }, [p.tool]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Escape") setDraft([]);
      if (e.key === "Enter") finishDraft();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function worldPointer(): Pt | null {
    const st = stageRef.current;
    const pos = st?.getPointerPosition();
    if (!st || !pos) return null;
    const x = (pos.x - p.view.x) / p.view.zoom;
    const y = (pos.y - p.view.y) / p.view.zoom;
    return [snap(x, p.grid, p.snapOn), snap(y, p.grid, p.snapOn)];
  }

  function finishDraft() {
    if (p.tool === "polygon" && draft.length >= 3) p.onDrawFinish("polygon", draft);
    if (p.tool === "line" && draft.length >= 2) p.onDrawFinish("line", draft);
    setDraft([]);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const st = stageRef.current;
    const pos = st?.getPointerPosition();
    if (!pos) return;
    const factor = e.evt.deltaY > 0 ? 1 / 1.15 : 1.15;
    const zoom = Math.min(200, Math.max(0.02, p.view.zoom * factor));
    const wx = (pos.x - p.view.x) / p.view.zoom;
    const wy = (pos.y - p.view.y) / p.view.zoom;
    p.setView({ zoom, x: pos.x - wx * zoom, y: pos.y - wy * zoom });
  }

  function onStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    const w = worldPointer();
    if (!w) return;
    if (p.tool === "polygon" || p.tool === "line") setDraft([...draft, w]);
    else if (p.tool === "point") p.onDrawFinish("point", [w]);
    else if (p.tool === "measure") setMeasure(measure.length >= 2 ? [w] : [...measure, w]);
    else if (p.tool === "road") {
      if (draft.length === 0) setDraft([w]);
      else { p.onRoadSegment(draft[0], w); setDraft([w]); }
    } else if (p.tool === "calibrate") p.onCalibratePoint(w);
    else if (p.tool === "select" && e.target === e.target.getStage()) { p.onSelect(null); p.onSelectEdge(null); }
  }

  function moveObject(code: string, dx: number, dy: number) {
    p.onChange(p.objects.map((o) => (o.code === code ? { ...o, geom: translateGeom(o.geom, dx, dy) } : o)));
  }

  function moveVertex(code: string, idx: number, to: Pt) {
    p.onChange(p.objects.map((o) => {
      if (o.code !== code) return o;
      const pts = ringOf(o.geom);
      pts[idx] = to;
      if (o.geom.type === "Polygon") {
        const ring = pts.map((q) => [q[0], q[1]]);
        return { ...o, geom: { type: "Polygon", coordinates: [[...ring, ring[0]]] } };
      }
      if (o.geom.type === "LineString") return { ...o, geom: { type: "LineString", coordinates: pts.map((q) => [q[0], q[1]]) } };
      return o;
    }));
  }

  const drawing = ["polygon", "line", "point", "measure", "road", "calibrate"].includes(p.tool);
  const sel = p.objects.find((o) => o.code === p.selected) || null;

  // grid lines across the visible area (skip when too dense)
  const gridLines: number[][] = [];
  if (p.grid > 0 && p.grid * p.view.zoom >= 6) {
    const x0 = -p.view.x / p.view.zoom, y0 = -p.view.y / p.view.zoom;
    const x1 = x0 + p.width / p.view.zoom, y1 = y0 + p.height / p.view.zoom;
    for (let x = Math.floor(x0 / p.grid) * p.grid; x <= x1; x += p.grid) gridLines.push([x, y0, x, y1]);
    for (let y = Math.floor(y0 / p.grid) * p.grid; y <= y1; y += p.grid) gridLines.push([x0, y, x1, y]);
  }

  const bgMpp = p.background?.m_per_px || 1;
  const bgOriginPx = p.background?.origin_px || [0, 0];
  const bgOriginM = p.background?.origin_m || [0, 0];

  return (
    <Stage ref={stageRef} width={p.width} height={p.height} x={p.view.x} y={p.view.y}
      scaleX={p.view.zoom} scaleY={p.view.zoom} draggable={p.tool === "pan"}
      onDragEnd={(e) => { if (e.target === stageRef.current) p.setView({ ...p.view, x: e.target.x(), y: e.target.y() }); }}
      onWheel={onWheel} onClick={onStageClick} onDblClick={finishDraft}
      onMouseMove={() => setCursor(worldPointer())}
      style={{ background: "#F8FAFC", cursor: drawing ? "crosshair" : p.tool === "pan" ? "grab" : "default" }}>
      <Layer listening={false}>
        {img && (
          <KImage image={img} opacity={p.background?.opacity ?? 0.6}
            x={bgOriginM[0] - bgOriginPx[0] * bgMpp} y={bgOriginM[1] - bgOriginPx[1] * bgMpp}
            width={img.width * bgMpp} height={img.height * bgMpp} />
        )}
        {gridLines.map((l, i) => <Line key={i} points={l} stroke="#E2E8F0" strokeWidth={px} />)}
      </Layer>
      <Layer>
        {p.objects.filter((o) => !hidden.has(o.layer)).map((o) => {
          const info = TYPE_INFO[o.object_type] || { color: "#555", kind: "polygon" };
          const pts = ringOf(o.geom);
          const flat = pts.flat();
          const isSel = o.code === p.selected;
          const hi = p.highlight.has(o.code);
          const lockedObj = lockedLayers.has(o.layer) || !p.editable;
          const color = o.object_type === "yard_block" ? CLASS_COLOR[String(o.props.cargo_class || "mixed")] || info.color : info.color;
          const stroke = hi ? "#DC2626" : isSel ? "#F59E0B" : color;
          const common = {
            draggable: isSel && !lockedObj && p.tool === "select",
            onClick: (e: Konva.KonvaEventObject<MouseEvent>) => { if (p.tool === "select") { e.cancelBubble = true; p.onSelect(o.code); p.onSelectEdge(null); } },
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
              const dx = snap(e.target.x(), p.grid, p.snapOn), dy = snap(e.target.y(), p.grid, p.snapOn);
              e.target.position({ x: 0, y: 0 });
              if (dx || dy) moveObject(o.code, dx, dy);
            },
          };
          if (o.geom.type === "Point") {
            return (
              <Group key={o.code} {...common}>
                <Circle x={pts[0][0]} y={pts[0][1]} radius={5 * px} fill={stroke} />
              </Group>
            );
          }
          const isPoly = o.geom.type === "Polygon";
          const c = centroid(pts);
          const fill = o.object_type === "boundary" ? undefined : isPoly ? color + (o.object_type === "yard_block" ? "88" : "33") : undefined;
          return (
            <Group key={o.code} {...common}>
              <Line points={flat} closed={isPoly} stroke={stroke} fill={fill}
                strokeWidth={(isSel || hi ? 3 : o.object_type === "boundary" ? 2 : 1) * px}
                dash={o.object_type === "boundary" || o.object_type === "buffer" ? [8 * px, 4 * px] : undefined}
                hitStrokeWidth={8 * px} />
              {(o.object_type === "yard_block" || isSel) && p.view.zoom > 0.6 && (
                <Text x={c[0]} y={c[1]} text={o.code} fontSize={11 * px} fill="#111827" offsetX={o.code.length * 3 * px} offsetY={6 * px} listening={false} />
              )}
            </Group>
          );
        })}
        {p.road.edges.map((e) => {
          const a = p.road.nodes.find((n) => n.code === e.from);
          const b = p.road.nodes.find((n) => n.code === e.to);
          if (!a || !b || hidden.has("roads")) return null;
          const isSel = p.selectedEdge === e.code;
          return <Line key={`edge-${e.code}`} points={[a.x, a.y, b.x, b.y]} stroke={isSel ? "#F59E0B" : "#B7950B"}
            strokeWidth={(isSel ? 4 : 2) * px} hitStrokeWidth={10 * px}
            onClick={(ev) => { if (p.tool === "select") { ev.cancelBubble = true; p.onSelectEdge(e.code); p.onSelect(null); } }} />;
        })}
        {!hidden.has("roads") && p.road.nodes.map((n) => <Circle key={`node-${n.code}`} x={n.x} y={n.y} radius={2.5 * px} fill="#7D6608" listening={false} />)}
        {sel && p.editable && !lockedLayers.has(sel.layer) && p.tool === "select" && sel.object_type !== "yard_block" && sel.geom.type !== "Point" &&
          ringOf(sel.geom).map((v, i) => (
            <Rect key={`v-${i}`} x={v[0] - 4 * px} y={v[1] - 4 * px} width={8 * px} height={8 * px} fill="#fff" stroke="#F59E0B" strokeWidth={1.5 * px} draggable
              onDragEnd={(e) => {
                const to: Pt = [snap(e.target.x() + 4 * px, p.grid, p.snapOn), snap(e.target.y() + 4 * px, p.grid, p.snapOn)];
                moveVertex(sel.code, i, to);
              }} />
          ))}
      </Layer>
      <Layer listening={false}>
        {draft.length > 0 && cursor && (
          <Line points={[...draft.flat(), ...cursor]} stroke="#2563EB" strokeWidth={2 * px} dash={[6 * px, 4 * px]}
            closed={p.tool === "polygon" && draft.length > 2} />
        )}
        {draft.map((d, i) => <Circle key={i} x={d[0]} y={d[1]} radius={3 * px} fill="#2563EB" />)}
        {draft.length > 1 && p.tool === "polygon" && (
          <Text x={draft[0][0]} y={draft[0][1] - 16 * px} fontSize={12 * px} fill="#1D4ED8"
            text={`${area(cursor ? [...draft, cursor] : draft).toFixed(0)} m²`} />
        )}
        {measure.length >= 1 && (
          <>
            <Line points={[...measure[0], ...(measure[1] || cursor || measure[0])]} stroke="#059669" strokeWidth={2 * px} />
            <Text x={measure[0][0]} y={measure[0][1] - 18 * px} fontSize={13 * px} fill="#047857"
              text={`${dist(measure[0], measure[1] || cursor || measure[0]).toFixed(2)} m`} />
          </>
        )}
        {p.calibPts.map((c, i) => <Circle key={`cal-${i}`} x={c[0]} y={c[1]} radius={5 * px} stroke="#DC2626" strokeWidth={2 * px} />)}
        {cursor && (
          <Text x={-p.view.x / p.view.zoom + 8 * px} y={(p.height - p.view.y) / p.view.zoom - 20 * px} fontSize={11 * px} fill="#475569"
            text={`x ${cursor[0].toFixed(2)} m   y ${cursor[1].toFixed(2)} m${p.georef ? (() => { const [e, n] = localToProjected(cursor[0], cursor[1], p.georef); return `   E ${e.toFixed(2)}   N ${n.toFixed(2)}`; })() : ""}   tỷ lệ ${roundScale(scaleDenominator(p.view.zoom))}`} />
        )}
        {(() => {
          // scale bar (bottom right) and north arrow (top right; local y points down, rotated by the georeference)
          const bar = niceBar(p.view.zoom);
          const x1 = (p.width - p.view.x) / p.view.zoom - 16 * px, y1 = (p.height - p.view.y) / p.view.zoom - 16 * px;
          const x0 = x1 - bar.px * px;
          const th = ((p.georef?.rotation_deg || 0) * Math.PI) / 180;
          const ax = (p.width - p.view.x) / p.view.zoom - 30 * px, ay = -p.view.y / p.view.zoom + 40 * px;
          const nx = Math.sin(th), ny = -Math.cos(th);   // local direction of map North
          return (
            <>
              <Rect listening={false} x={x0} y={y1 - 4 * px} width={(x1 - x0) / 2} height={4 * px} fill="#111827" />
              <Rect listening={false} x={(x0 + x1) / 2} y={y1 - 4 * px} width={(x1 - x0) / 2} height={4 * px} fill="#fff" stroke="#111827" strokeWidth={px} />
              <Text listening={false} x={x0} y={y1 - 18 * px} fontSize={11 * px} fill="#111827" text={`${bar.metres >= 1000 ? bar.metres / 1000 + " km" : bar.metres + " m"}`} />
              <Line listening={false} points={[ax - nx * 14 * px, ay - ny * 14 * px, ax + nx * 14 * px, ay + ny * 14 * px]} stroke="#111827" strokeWidth={2 * px} />
              <Circle listening={false} x={ax + nx * 14 * px} y={ay + ny * 14 * px} radius={3 * px} fill="#111827" />
              <Text listening={false} x={ax + nx * 24 * px - 4 * px} y={ay + ny * 24 * px - 6 * px} fontSize={12 * px} fontStyle="bold" fill="#111827" text="B" />
            </>
          );
        })()}
        {sel && (
          <Text x={-p.view.x / p.view.zoom + 8 * px} y={-p.view.y / p.view.zoom + 8 * px} fontSize={11 * px} fill="#475569"
            text={sel.geom.type === "Polygon" ? `${sel.code}: ${area(ringOf(sel.geom)).toFixed(1)} m²` : `${sel.code}: ${lengthOf(ringOf(sel.geom)).toFixed(1)} m`} />
        )}
      </Layer>
    </Stage>
  );
}
