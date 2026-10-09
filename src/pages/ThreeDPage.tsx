// V0.4: 3D view of the scenario built from the 2D layout + elevations (props.elevation_m, height_m).
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { EquipmentType, FleetItem, Layout } from "../api/types";
import { Button, Card, Empty, ErrorBox, Loading } from "../components/ui";
import { buildScene } from "../lib/scene3d";
import { useScenario } from "./ScenarioShell";

const ThreeView = lazy(() => import("../components/ThreeView"));   // three.js only loads on this tab
const YARD = new Set(["RTG", "RMG", "ASC", "RS", "ECH"]);

export default function ThreeDPage() {
  const { scenario } = useScenario();
  const layout = useQuery({ queryKey: ["layout-view", scenario.id, scenario.layout_revision], queryFn: () => api<Layout>("GET", `/api/v1/scenarios/${scenario.id}/layout`) });
  const fleet = useQuery({ queryKey: ["fleet", scenario.id], queryFn: () => api<FleetItem[]>("GET", `/api/v1/scenarios/${scenario.id}/fleet`) });
  const types = useQuery({ queryKey: ["equipment-types"], queryFn: () => api<EquipmentType[]>("GET", "/api/v1/master/equipment-types"), staleTime: 3_600_000 });
  const [fill, setFill] = useState(0.6);
  const [vex, setVex] = useState(1);
  const [show, setShow] = useState({ containers: true, cranes: true, vessels: true });
  const shot = useRef<(() => string) | null>(null);

  const counts = useMemo(() => {
    const cat = new Map((types.data || []).map((t) => [t.id, t.category]));
    let sts = 0, yc = 0;
    for (const f of fleet.data || []) {
      const c = cat.get(f.equipment_type_id);
      if (c === "STS") sts += f.quantity;
      else if (c && YARD.has(c)) yc += f.quantity;
    }
    return { sts, yc };
  }, [fleet.data, types.data]);

  const scene = useMemo(() => {
    if (!layout.data) return null;
    const s = buildScene(layout.data.objects, { fill, stsCount: show.cranes ? Math.min(counts.sts || 4, 30) : 0,
      rtgCount: show.cranes ? Math.min(counts.yc || 0, 200) : 0, vessels: show.vessels });
    return show.containers ? s : { ...s, containers: [] };
  }, [layout.data, fill, counts, show]);
  const onReady = useCallback((f: () => string) => { shot.current = f; }, []);

  function screenshot() {
    if (!shot.current) return;
    const a = document.createElement("a");
    a.href = shot.current();
    a.download = `ctplanner_3d_${scenario.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.png`;
    a.click();
  }

  if (layout.isLoading) return <Loading />;
  if (layout.error) return <ErrorBox error={layout.error} />;
  if (!scene || !layout.data?.objects.length) return <Empty text="Layout chưa có đối tượng. Vẽ hoặc nhập DXF ở tab Mặt bằng 2D." />;
  const blocks = layout.data.objects.filter((o) => o.object_type === "yard_block").length;
  return (
    <div className="space-y-3">
      <Card title="Mô hình 3D (dựng từ mặt bằng 2D + cao độ)" actions={<Button variant="secondary" onClick={screenshot}>Lưu ảnh PNG</Button>}>
        <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">Mức chất xếp
            <input type="range" min={0} max={1} step={0.05} value={fill} onChange={(e) => setFill(Number(e.target.value))} />
            <span className="w-10">{Math.round(fill * 100)}%</span>
          </label>
          <label className="flex items-center gap-2">Phóng đại cao độ
            <select className="rounded border border-slate-300 px-2 py-1" value={vex} onChange={(e) => setVex(Number(e.target.value))}>
              {[1, 2, 3, 5].map((v) => <option key={v} value={v}>×{v}</option>)}
            </select>
          </label>
          {(Object.keys(show) as (keyof typeof show)[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
              {{ containers: "Container", cranes: "Cẩu STS/RTG", vessels: "Tàu" }[k]}
            </label>
          ))}
        </div>
        <Suspense fallback={<Loading text="Đang tải bộ dựng 3D…" />}>
          <ThreeView scene={scene} vex={vex} height={620} onReady={onReady} />
        </Suspense>
        <p className="mt-2 text-xs text-slate-500">
          Chuột trái: xoay · chuột phải: dời · lăn: phóng to. {blocks} block, {scene.containers.length.toLocaleString("vi-VN")} container (TEU 6,06 × 2,44 × 2,59 m),
          {" "}{scene.cranes.filter((c) => c.kind === "sts").length} STS, {scene.cranes.filter((c) => c.kind === "rtg").length} cẩu bãi (theo đội thiết bị).
          Cao độ nền từng đối tượng và chiều cao công trình sửa ở bảng thuộc tính (tab Mặt bằng 2D). Container minh hoạ theo mức chất xếp, không phải tồn bãi thực.
        </p>
      </Card>
    </div>
  );
}
