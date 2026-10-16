import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useServerStatus } from "../store/serverStatus";
import { can, useAuth } from "../store/auth";
import { useAccess } from "../store/access";
import { ROLE_LABEL } from "../lib/format";
import pkg from "../../package.json";   // footer version follows package.json

export default function Shell() {
  const { user, logout } = useAuth();
  const { servedBy, readOnly } = useServerStatus();
  const nav = useNavigate();
  const access = useAccess();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded px-2 py-1 text-sm ${isActive ? "bg-white/20 text-white" : "text-white/80 hover:text-white"}`;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="print:hidden bg-navy text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2">
          <span className="font-semibold">OSE Terminal Planner</span>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/projects" className={link}>Dự án</NavLink>
            <NavLink to="/compare" className={link}>So sánh</NavLink>
            {user && <NavLink to="/file-run" className={link}>Tính từ file</NavLink>}
            <NavLink to="/master-data" className={link}>Danh mục</NavLink>
            {user && <NavLink to="/audit" className={link}>Nhật ký</NavLink>}
            {can(user, "admin") && <NavLink to="/admin" className={link}>Quản trị</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span>{user.full_name || user.email} · {ROLE_LABEL[user.role]}</span>
                <button className="underline" onClick={() => { logout(); nav("/login"); }}>Đăng xuất</button>
              </>
            ) : (
              <button className="underline" onClick={() => nav("/login")}>Đăng nhập</button>
            )}
          </div>
        </div>
      </header>
      {(servedBy === "render" || readOnly) && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">
          Đang chạy máy chủ dự phòng – chỉ đọc. Không lưu được thay đổi; vẫn “Tính tạm” được (kết quả không lưu).
        </div>
      )}
      {access.plan === "demo" && (
        <div className="bg-violet-100 px-4 py-1.5 text-center text-sm text-violet-900">
          Bản DEMO – xem dự án mẫu và kết quả. Chạy tính, tính từ file cần gói ctplanner:{" "}
          <a className="font-semibold underline" href={access.account_url} target="_blank" rel="noreferrer">mua / đăng nhập tại Port & Logistics Hub</a>
        </div>
      )}
      {servedBy === "offline" && (
        <div className="bg-red-100 px-4 py-1.5 text-center text-sm text-red-900">Không kết nối được máy chủ.</div>
      )}
      {!user && (
        <div className="bg-sky-50 px-4 py-1.5 text-center text-sm text-sky-900">
          Bạn đang xem dự án mẫu (SAMPLE). Đăng nhập để tạo và chỉnh sửa dự án.
        </div>
      )}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">
        <Outlet />
      </main>
      <footer className="print:hidden py-3 text-center text-xs text-slate-400">OSE Container Terminal Layout Planner v{pkg.version} © 2025 portlogistics.vn - portlogistics.ose.vn . All rights reserved</footer>
    </div>
  );
}
