// V0.4: Three.js renderer for the 3D scene model (lib/scene3d). Orbit with the mouse: left = rotate,
// right = pan, wheel = zoom.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TEU, type Crane, type Scene3D, type Vessel } from "../lib/scene3d";

type Pt = [number, number];

function shapeOf(pts: Pt[]) {
  // shape in (x, −z): after rotateX(−90°) the shape lies on the ground and the extrusion points up
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], -p[1]) : s.moveTo(p[0], -p[1])));
  s.closePath();
  return s;
}

function extrude(pts: Pt[], base: number, height: number, color: string, opacity: number) {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: Math.max(0.01, height), bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  const m = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide });
  return new THREE.Mesh(g, m);
}

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

function ribbon(pts: Pt[], width: number, base: number, color: string) {
  const grp = new THREE.Group();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const m = box(len + width * 0.5, 0.1, width, color, (x0 + x1) / 2, base, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    grp.add(m);
  }
  return grp;
}

function crane(c: Crane) {
  // local axes: Z = span direction (c.dir), X = along the rail
  const g = new THREE.Group();
  const leg = c.kind === "sts" ? 2.2 : 1.2, half = c.kind === "sts" ? 8 : 3.5;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) g.add(box(leg, c.height, leg, c.color, sx * half, c.height / 2, sz * c.span / 2));
  for (const sz of [-1, 1]) g.add(box(half * 2 + leg, leg, leg, c.color, 0, c.height, sz * c.span / 2));   // portal beams
  for (const sx of [-1, 1]) g.add(box(leg, leg, c.span + leg, c.color, sx * half, c.height, 0));          // girders
  if (c.kind === "sts" && c.boom) {
    const back = 25, y = c.height * 0.8;
    const L = back + c.span / 2 + c.boom;
    g.add(box(3, 3, L, c.color, 0, y, (c.span / 2 + c.boom - back) / 2));                                   // boom
    g.add(box(10, 6, 12, "#F5F5F4", 0, c.height + 4, -c.span / 2 - 4));                                      // machinery house
  } else {
    g.add(box(half * 2, 2.5, 3, "#A16207", 0, c.height - 1.5, 0));                                            // trolley
  }
  g.position.set(c.x, c.base, c.z);
  g.rotation.y = Math.atan2(c.dir[0], c.dir[1]);
  return g;
}

function vessel(v: Vessel) {
  const g = new THREE.Group();
  g.add(box(v.length, 16, v.beam, "#1E3A8A", 0, v.base + 8 - 10, 0));                       // hull, 10 m draft
  g.add(box(v.length * 0.08, 22, v.beam * 0.8, "#F5F5F4", -v.length * 0.38, v.base + 6 + 11, 0)); // bridge (stern)
  const colors = ["#B91C1C", "#1D4ED8", "#15803D", "#A16207", "#7C3AED"];
  const bays = Math.floor((v.length * 0.75) / (TEU.length * 2 + 1));
  for (let b = 0; b < bays; b++) {
    const h = 3 + ((b * 7) % 4);
    const m = box(TEU.length * 2, h * TEU.height, v.beam * 0.85, colors[b % colors.length],
      -v.length * 0.3 + b * (TEU.length * 2 + 1), v.base + 6 + (h * TEU.height) / 2, 0);
    g.add(m);
  }
  g.position.set(v.x, 0, v.z);
  g.rotation.y = -v.ang;
  return g;
}

export default function ThreeView({ scene, height = 600, vex = 1, onReady }: {
  scene: Scene3D; height?: number; vex?: number; onReady?: (shot: () => string) => void;
}) {
  const box3 = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box3.current;
    if (!el) return;
    const w = el.clientWidth || 900;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, height);
    renderer.setClearColor("#E0F2FE");
    el.appendChild(renderer.domElement);

    const s = new THREE.Scene();
    const root = new THREE.Group();
    root.scale.y = vex;
    s.add(root);
    s.add(new THREE.HemisphereLight("#ffffff", "#9CA3AF", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.4);
    const { minX, maxX, minZ, maxZ, maxY } = scene.extent;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ext = Math.max(maxX - minX, maxZ - minZ, 50);
    sun.position.set(cx + ext, ext * 1.5, cz + ext * 0.6);
    s.add(sun);

    const ground = extrude([[minX - ext * 0.2, minZ - ext * 0.2], [maxX + ext * 0.2, minZ - ext * 0.2],
      [maxX + ext * 0.2, maxZ + ext * 0.2], [minX - ext * 0.2, maxZ + ext * 0.2]], -0.1, 0.05, "#D6D3D1", 1);
    root.add(ground);
    if (scene.water) root.add(extrude(scene.water.pts, scene.water.level - 0.05, 0.1, "#3B82F6", 0.75));
    for (const p of scene.prims) {
      root.add(p.kind === "extrude" ? extrude(p.pts, p.base, p.height, p.color, p.opacity) : ribbon(p.pts, p.width, p.base, p.color));
    }
    if (scene.containers.length) {
      const geo = new THREE.BoxGeometry(TEU.length, TEU.height * 0.97, TEU.width);
      const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
      const inst = new THREE.InstancedMesh(geo, mat, scene.containers.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      scene.containers.forEach((c, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -c.ang);
        pos.set(c.x, c.y, c.z);
        m4.compose(pos, q, one);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.set(c.color));
      });
      inst.instanceMatrix.needsUpdate = true;
      root.add(inst);
    }
    scene.cranes.forEach((c) => root.add(crane(c)));
    scene.vessels.forEach((v) => root.add(vessel(v)));

    const cam = new THREE.PerspectiveCamera(45, w / height, 1, ext * 20);
    cam.position.set(cx + ext * 0.55, Math.max(maxY * vex * 3, ext * 0.55), cz + ext * 0.85);
    const ctl = new OrbitControls(cam, renderer.domElement);
    ctl.target.set(cx, 0, cz);
    ctl.maxPolarAngle = Math.PI / 2 - 0.02;
    ctl.update();

    let raf = 0;
    const loop = () => { ctl.update(); renderer.render(s, cam); raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => {
      const ww = el.clientWidth || w;
      renderer.setSize(ww, height);
      cam.aspect = ww / height;
      cam.updateProjectionMatrix();
    });
    ro.observe(el);
    onReady?.(() => { renderer.render(s, cam); return renderer.domElement.toDataURL("image/png"); });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctl.dispose();
      s.traverse((obj) => {
        const o = obj as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((mm) => mm.dispose());
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [scene, height, vex, onReady]);
  return <div ref={box3} className="w-full overflow-hidden rounded border border-slate-200" style={{ height }} />;
}
