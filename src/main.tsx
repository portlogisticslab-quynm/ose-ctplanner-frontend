import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import Shell from "./components/Shell";
import { useAuth } from "./store/auth";
import LoginPage from "./pages/LoginPage";
import { Loading } from "./components/ui";

// V1.0: pages load on demand (smaller first download; each page is its own chunk)
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const ScenarioShell = lazy(() => import("./pages/ScenarioShell"));
const LayoutPage = lazy(() => import("./pages/LayoutPage"));
const InputsPage = lazy(() => import("./pages/InputsPage"));
const ImportPage = lazy(() => import("./pages/ImportPage"));
const CapacityPage = lazy(() => import("./pages/CapacityPage"));
const SimulationPage = lazy(() => import("./pages/SimulationPage"));
const ThreeDPage = lazy(() => import("./pages/ThreeDPage"));
const PlotsPage = lazy(() => import("./pages/PlotsPage"));
const YardOpsPage = lazy(() => import("./pages/YardOpsPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const MasterDataPage = lazy(() => import("./pages/MasterDataPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const FileRunPage = lazy(() => import("./pages/FileRunPage"));

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } } });

function App() {
  const { loading, restore } = useAuth();
  useEffect(() => { void restore(); }, [restore]);
  if (loading) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/scenarios/:scenarioId" element={<ScenarioShell />}>
          <Route index element={<Navigate to="layout" replace />} />
          <Route path="layout" element={<LayoutPage />} />
          <Route path="inputs" element={<InputsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="capacity" element={<CapacityPage />} />
          <Route path="yard-ops" element={<YardOpsPage />} />
          <Route path="simulation" element={<SimulationPage />} />
          <Route path="3d" element={<ThreeDPage />} />
          <Route path="plots" element={<PlotsPage />} />
        </Route>
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/file-run" element={<FileRunPage />} />
        <Route path="/master-data" element={<MasterDataPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
