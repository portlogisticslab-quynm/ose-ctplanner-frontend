import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, apiWithHeaders, download, fileObjectUrl } from "../api/client";
import type { Background, CheckResult, Layer as LayerT, Layout, LayoutObject } from "../api/types";
import EditorCanvas, { type Tool, type View } from "../editor/EditorCanvas";
import Inspector from "../editor/Inspector";
import BlockGenerator from "../editor/BlockGenerator";
import DxfImportDialog from "../components/DxfImportDialog";
import GeorefDialog from "../components/GeorefDialog";
import type { GeorefOrigin } from "../lib/georef";
import BackgroundPanel from "../editor/BackgroundPanel";
import { useHistory } from "../store/history";
import { Badge, Button, Card, ErrorBox, inputCls, Loading } from "../components/ui";
import { OBJECT_TYPES } from "../lib/format";
import { bounds, dist, polygonGeom, type Pt } from "../lib/geometry";
import { useScenario } from "./ScenarioShell";

const DEFAULT_LAYERS = ["site", "quay", "yard", "landside", "roads", "default"];
const PREFIX: Record<string, string> = {
  boundary: "SITE", berth: "BER", apron: "APR", gate: "GATE", building: "BLD", cfs: "CFS", depot: "DEP", workshop: "WS",
  rail_yard: "RY", restricted_zone: "RZ", buffer: "BUF", zone: "Z", quay_wall: "QW", rail_track: "RT", road_centerline: "RD",
  sts_rail: "STSR", transfer_point: "TP", vessel_position: "VP", equipment_position: "EQ",
};
const LAYER_OF: Record<string, string> = { berth: "quay", apron: "quay", quay_wall: "quay", sts_rail: "quay", vessel_position: "quay",
  gate: "landside", cfs: "landside", depot: "landside", workshop: "landside", rail_yard: "landside", rail_track: "landside",
  road_centerline: "roads", boundary: "site", restricted_zone: "site", buffer: "site" };

export default function LayoutPage() {
  const { scenario, project, editable, refetch } = useScenario();
  const qc = useQueryClient();
  const h = useHistory();
  const [revision, setRevision] = useState<number | null>(null);
  const [layers, setLayers] = useState<LayerT[]>([]);
  const [background, setBackground] = useState<Background | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [saveErr, setSaveErr] = useState<unknown>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [drawType, setDrawType] = useState({ polygon: "zone", line: "quay_wall", point: "transfer_point" });
  const [grid, setGrid] = useState(5);
  const [snapOn, setSnapOn] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 40, y: 40 });
  const [showGen, setShowGen] = useState(false);
  const [showDxf, setShowDxf] = useState(false);
  const [showGeoref, setShowGeoref] = useState(false);
  const [geoSuggest, setGeoSuggest] = useState<GeorefOrigin | null>(null);
  const [fitReq, setFitReq] = useState(0);
  const [exportErr, setExportErr] = useState<unknown>(null);
  const [calibPts, setCalibPts] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });

  const load = useCallback(async () => {
    try {
      const { data } = await apiWithHeaders<Layout>("GET", `/api/v1/scenarios/${scenario.id}/layout`);
      h.reset(data.objects, data.road_graph);
      setRevision(data.revision);
      const names = new Set([...DEFAULT_LAYERS, ...data.objects.map((o) => o.layer)]);
      const known = new Map((data.layers || []).map((l) => [l.name, l]));
      setLayers(Array.from(names).map((n) => known.get(n) || { name: n, visible: true, locked: false }));
      setBackground(data.background);
      setLoadErr(null);
      setSelected(null);
      return data;
    } catch (e) {
      setLoadErr(e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id]);

  useEffect(() => {
    void load().then((data) => {
      const b = data && bounds(data.objects);
      if (b && boxRef.current) {
        const w = boxRef.current.clientWidth, hh = 640;
        const zoom = Math.min((w - 60) / Math.max(1, b.maxX - b.minX), (hh - 60) / Math.max(1, b.maxY - b.minY));
        setView({ zoom, x: 30 - b.minX * zoom, y: 30 - b.minY * zoom });
      }
    });
  }, [load]);

  useEffect(() => {
    let url: string | null = null;
    if (background?.file_id) {
      fileObjectUrl(background.file_id).then((u) => { url = u; setBgUrl(u); }).catch(() => setBgUrl(null));
    } else setBgUrl(null);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [background?.file_id]);

  // The canvas box only exists after the layout has loaded, so (re)attach the observer when it appears.
  const ready = revision !== null;
  const [measured, setMeasured] = useState(false);
  const autoFitted = useRef(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(320, el.clientWidth), h: Math.max(480, window.innerHeight - 260) });
    measure();
    setMeasured(true);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [ready]);

  const codes = useMemo(() => new Set(h.objects.map((o) => o.code)), [h.objects]);
  const highlight = useMemo(() => {
    const s = new Set<string>();
    for (const i of check?.issues || []) {
      const d = i.detail || {};
      if (typeof d.code === "string") s.add(d.code);
      if (Array.isArray(d.codes)) (d.codes as string[]).forEach((c) => s.add(c));
    }
    return s;
  }, [check]);

  function newCode(prefix: string): string {
    let i = 1;
    while (codes.has(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  }

  function onDrawFinish(kind: "polygon" | "line" | "point", pts: Pt[]) {
    const type = drawType[kind];
    const code = newCode(PREFIX[type] || "OBJ");
    const geom = kind === "polygon" ? polygonGeom(pts)
      : kind === "line" ? { type: "LineString" as const, coordinates: pts.map((p) => [p[0], p[1]]) }
        : { type: "Point" as const, coordinates: [pts[0][0], pts[0][1]] };
    const obj: LayoutObject = { code, object_type: type, layer: LAYER_OF[type] || "default", geom, props: {}, rotation_deg: 0 };
    h.commit([...h.objects, obj]);
    setSelected(code);
  }

  function onRoadSegment(a: Pt, b: Pt) {
    if (dist(a, b) < 0.5) return;
    const road = { nodes: [...h.road.nodes], edges: [...h.road.edges] };
    const tol = Math.max(2, grid / 2);
    const nodeAt = (p: Pt) => {
      const found = road.nodes.find((n) => dist([n.x, n.y], p) <= tol);
      if (found) return found.code;
      let i = road.nodes.length + 1;
      while (road.nodes.some((n) => n.code === `N${i}`)) i++;
      road.nodes.push({ code: `N${i}`, x: p[0], y: p[1] });
      return `N${i}`;
    };
    const from = nodeAt(a), to = nodeAt(b);
    if (from === to) return;
    let k = road.edges.length + 1;
    while (road.edges.some((e) => e.code === `E${k}`)) k++;
    road.edges.push({ code: `E${k}`, from, to, direction: "two" });
    h.commit(h.objects, road);
  }

  function deleteSelected() {
    if (!editable) return;
    if (selected) { h.commit(h.objects.filter((o) => o.code !== selected)); setSelected(null); }
    else if (selectedEdge) {
      const edges = h.road.edges.filter((e) => e.code !== selectedEdge);
      const used = new Set(edges.flatMap((e) => [e.from, e.to]));
      h.commit(h.objects, { nodes: h.road.nodes.filter((n) => used.has(n.code)), edges });
      setSelectedEdge(null);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); useHistory.getState().undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); useHistory.getState().redo(); }
      if (e.key === "Delete") deleteSelected();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function payload() {
    return { layers, objects: h.objects, road_graph: h.road.edges.length ? h.road : null, background };
  }

  async function runCheck() {
    setBusy(true);
    try {
      setCheck(await api<CheckResult>("POST", `/api/v1/scenarios/${scenario.id}/layout/check`, payload()));
    } catch (e) { setSaveErr(e); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    setSaveErr(null);
    try {
      const r = await api<{ revision: number; check: CheckResult["summary"]; issues: CheckResult["issues"] }>(
        "PUT", `/api/v1/scenarios/${scenario.id}/layout`, payload(), { "If-Match": String(revision) });
      setRevision(r.revision);
      setCheck({ summary: r.check, issues: r.issues });
      useHistory.getState().markSaved();
      void qc.invalidateQueries({ queryKey: ["scenario", scenario.id] });
      refetch();
    } catch (e) {
      setSaveErr(e);
      if (e instanceof ApiError && e.code === "LAYOUT_REVISION_CONFLICT" && window.confirm("Layout đã được người khác lưu. Tải lại bản mới (mất thay đổi chưa lưu)?")) void load();
    } finally { setBusy(false); }
  }

  function applyDxf(objs: LayoutObject[], mode: "append" | "replace", suggestion: GeorefOrigin | null) {
    const next = mode === "replace" ? objs : [...h.objects, ...objs];
    h.commit(next);
    const names = new Set(layers.map((l) => l.name));
    const add = Array.from(new Set(objs.map((o) => o.layer))).filter((n) => !names.has(n));
    if (add.length) setLayers([...layers, ...add.map((n) => ({ name: n, visible: true, locked: false }))]);
    setSelected(null);
    setShowDxf(false);
    setFitReq((k) => k + 1);
    if (suggestion) { setGeoSuggest(suggestion); setShowGeoref(true); }
  }

  async function exportFile(kind: string) {
    setExportErr(null);
    const base = `${project.code}_${scenario.name}`.replace(/[^A-Za-z0-9_-]+/g, "_");
    const map: Record<string, [string, string]> = {
      "dxf-local": [`/api/v1/scenarios/${scenario.id}/cad/export.dxf?crs=local`, `${base}_local.dxf`],
      "dxf-project": [`/api/v1/scenarios/${scenario.id}/cad/export.dxf?crs=project`, `${base}_toado.dxf`],
      "geojson": [`/api/v1/scenarios/${scenario.id}/gis/export.geojson?crs=4326`, `${base}_wgs84.geojson`],
    };
    try {
      if (h.dirty) throw new ApiError(409, "UNSAVED", "Layout có thay đổi chưa lưu: hãy Lưu trước khi xuất", []);
      await download(...map[kind]);
    } catch (e) { setExportErr(e); }
  }

  function fit() {
    const b = bounds(h.objects);
    if (!b) return;
    const zoom = Math.min((size.w - 60) / Math.max(1, b.maxX - b.minX), (size.h - 60) / Math.max(1, b.maxY - b.minY));
    setView({ zoom, x: 30 - b.minX * zoom, y: 30 - b.minY * zoom });
  }

  // first view after load: fit the whole layout into the real canvas size
  useEffect(() => {
    if (!measured || autoFitted.current || !h.objects.length) return;
    autoFitted.current = true;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, size.w, size.h, h.objects.length]);

  useEffect(() => {
    if (fitReq) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitReq]);

  if (loadErr) return <ErrorBox error={loadErr} />;
  if (revision === null) return <Loading />;
  const sel = h.objects.find((o) => o.code === selected) || null;
  const centre: [number, number] = [(size.w / 2 - view.x) / view.zoom, (size.h / 2 - view.y) / view.zoom];
  const toolBtn = (t: Tool, label: string, needEdit = true) => (
    <Button key={t} variant={tool === t ? "primary" : "secondary"} disabled={needEdit && !editable} onClick={() => setTool(t)}>{label}</Button>
  );

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-2">
          {toolBtn("select", "Chọn", false)}
          {toolBtn("pan", "Kéo", false)}
          {toolBtn("polygon", "Vẽ vùng")}
          {toolBtn("line", "Vẽ đường")}
          {toolBtn("point", "Điểm")}
          {toolBtn("road", "Mạng đường")}
          {toolBtn("measure", "Đo", false)}
          {(tool === "polygon" || tool === "line" || tool === "point") && (
            <select className={inputCls} value={drawType[tool]} onChange={(e) => setDrawType({ ...drawType, [tool]: e.target.value })}>
              {OBJECT_TYPES.filter((t) => t.kind === tool && t.value !== "yard_block").map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <label className="flex items-center gap-1 text-sm">Lưới
            <input className={`${inputCls} w-16`} type="number" min={0} value={grid} onChange={(e) => setGrid(Number(e.target.value))} /> m
          </label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Bắt lưới</label>
          <Button variant="ghost" onClick={fit}>Vừa khung</Button>
          <Button variant="ghost" disabled={!h.past.length || !editable} onClick={h.undo} title="Ctrl+Z">↶ Hoàn tác</Button>
          <Button variant="ghost" disabled={!h.future.length || !editable} onClick={h.redo} title="Ctrl+Y">↷ Làm lại</Button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <Button variant="secondary" disabled={!editable} onClick={() => setShowGen(true)}>Sinh block bãi</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void runCheck()}>Kiểm tra hình học</Button>
          <span className="mx-1 h-6 w-px bg-slate-200" />
          <Button variant="secondary" disabled={!editable} onClick={() => setShowDxf(true)}>Nhập AutoCAD (DWG/DXF)</Button>
          <select className={inputCls} value="" onChange={(e) => { if (e.target.value) void exportFile(e.target.value); }}>
            <option value="">Xuất…</option>
            <option value="dxf-local">DXF cho AutoCAD – toạ độ cục bộ (m)</option>
            <option value="dxf-project">DXF cho AutoCAD – toạ độ dự án (vd. VN-2000)</option>
            <option value="geojson">GeoJSON (WGS 84, cho QGIS/Google Earth)</option>
          </select>
          <Button variant="ghost" onClick={() => { setGeoSuggest(null); setShowGeoref(true); }}>Hệ toạ độ{project.crs_epsg || (project.origin as GeorefOrigin)?.tm ? ` (${project.crs_epsg ? "EPSG:" + project.crs_epsg : "TM"})` : ""}</Button>
          <Button disabled={!editable || busy || !h.dirty} onClick={() => void save()}>Lưu (rev {revision})</Button>
          {h.dirty && <Badge tone="amber">chưa lưu</Badge>}
        </div>
        <p className="text-xs text-slate-500">
          Vẽ vùng/đường: click từng điểm, nhấp đúp hoặc Enter để kết thúc, Esc để huỷ. Kéo đối tượng đang chọn để di chuyển; kéo ô vuông ở đỉnh để sửa hình. Lăn chuột để phóng to.
          Trục y hướng xuống (toạ độ cục bộ, mét).
        </p>
        <ErrorBox error={saveErr} />
        <ErrorBox error={exportErr} />
        {showDxf && <DxfImportDialog scenarioId={scenario.id} onClose={() => setShowDxf(false)} onApply={applyDxf} />}
        {showGeoref && <GeorefDialog project={project} editable={editable} suggestion={geoSuggest} onClose={() => setShowGeoref(false)} />}
        <div ref={boxRef} className="overflow-hidden rounded border border-slate-300 bg-white">
          <EditorCanvas width={size.w} height={size.h} objects={h.objects} road={h.road} layers={layers} tool={tool}
            grid={grid} snapOn={snapOn} selected={selected} selectedEdge={selectedEdge} highlight={highlight} view={view} setView={setView}
            background={background} backgroundUrl={bgUrl} editable={editable}
            georef={(project.crs_epsg || (project.origin as GeorefOrigin)?.tm) && (project.origin as GeorefOrigin)?.e !== undefined ? project.origin as GeorefOrigin : null}
            onSelect={setSelected} onSelectEdge={setSelectedEdge} onChange={(objs) => h.commit(objs)}
            onDrawFinish={onDrawFinish} onRoadSegment={onRoadSegment} calibPts={calibPts}
            onCalibratePoint={(w) => setCalibPts((c) => (c.length >= 2 ? [w] : [...c, w]))} />
        </div>
      </div>

      <div className="space-y-3">
        {showGen && (
          <Card title="Sinh block bãi">
            <BlockGenerator existing={codes} start={centre} onClose={() => setShowGen(false)}
              onCreate={(objs) => h.commit([...h.objects, ...objs])} />
          </Card>
        )}
        <Card title={sel ? `Đối tượng ${sel.code}` : selectedEdge ? `Cạnh đường ${selectedEdge}` : "Đối tượng"}>
          {sel ? (
            <Inspector obj={sel} codes={codes} layers={layers.map((l) => l.name)} editable={editable}
              onApply={(o, old) => { h.commit(h.objects.map((x) => (x.code === old ? o : x))); setSelected(o.code); }}
              onDelete={() => deleteSelected()} />
          ) : selectedEdge ? (
            <Button variant="danger" disabled={!editable} onClick={deleteSelected}>Xoá cạnh</Button>
          ) : (
            <p className="text-sm text-slate-500">Chọn một đối tượng trên bản vẽ. {h.objects.length} đối tượng, {h.road.edges.length} cạnh đường.</p>
          )}
        </Card>
        <Card title="Lớp">
          <div className="space-y-1 text-sm">
            {layers.map((l, i) => (
              <div key={l.name} className="flex items-center justify-between">
                <span>{l.name} <span className="text-xs text-slate-400">({h.objects.filter((o) => o.layer === l.name).length})</span></span>
                <span className="flex gap-3">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={l.visible} onChange={(e) => setLayers(layers.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)))} /> hiện</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={l.locked} onChange={(e) => setLayers(layers.map((x, j) => (j === i ? { ...x, locked: e.target.checked } : x)))} /> khoá</label>
                </span>
              </div>
            ))}
          </div>
        </Card>
        {check && (
          <Card title="Kết quả kiểm tra hình học">
            <p className="mb-2 text-sm">
              <Badge tone={check.summary.errors ? "red" : "green"}>{check.summary.errors} lỗi</Badge>{" "}
              <Badge tone={check.summary.warnings ? "amber" : "slate"}>{check.summary.warnings} cảnh báo</Badge>{" "}
              {check.summary.connected ? "Mạng đường liên thông" : "Mạng đường không liên thông"}
            </p>
            <ul className="max-h-64 space-y-1 overflow-auto text-xs">
              {check.issues.map((i, k) => (
                <li key={k} className={i.severity === "error" ? "text-red-700" : "text-amber-700"}>
                  <button className="text-left underline-offset-2 hover:underline" onClick={() => {
                    const c = (i.detail?.code as string) || ((i.detail?.codes as string[]) || [])[0];
                    if (c) setSelected(c);
                  }}>{i.message}</button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Ảnh nền & hiệu chỉnh tỷ lệ">
          <BackgroundPanel projectId={project.id} background={background} editable={editable} calibPts={calibPts}
            onBackground={(b) => { setBackground(b); useHistory.setState({ dirty: true }); }}
            onStartCalibrate={() => { setCalibPts([]); setTool("calibrate"); }}
            onCancelCalibrate={() => { setCalibPts([]); setTool("select"); }} />
        </Card>
      </div>
    </div>
  );
}
