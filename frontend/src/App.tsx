import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import DispatcherLogin from "./components/ui/DispatcherLogin";
import AppLayout from "./layouts/AppLayout";
import AssignmentsPage from "./pages/AssignmentsPage";
import AuditHistoryPage from "./pages/AuditHistoryPage";
import DashboardPage from "./pages/DashboardPage";
import JobsPage from "./pages/JobsPage";
import ManualQueuePage from "./pages/ManualQueuePage";
import RidersPage from "./pages/RidersPage";

export default function App() {
  const [token, setToken] = useState(() =>
    sessionStorage.getItem("relay-dispatcher-token"),
  );

  useEffect(() => {
    const handleUnauthorized = () => {
      sessionStorage.removeItem("relay-dispatcher-token");
      setToken(null);
    };
    window.addEventListener("relay:dispatcher-unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener(
        "relay:dispatcher-unauthorized",
        handleUnauthorized,
      );
  }, []);

  function signOut() {
    sessionStorage.removeItem("relay-dispatcher-token");
    setToken(null);
  }

  if (!token) {
    return <DispatcherLogin onAuthorized={setToken} />;
  }

  return (
    <Routes>
      <Route element={<AppLayout onSignOut={signOut} />}>
        <Route index element={<DashboardPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="riders" element={<RidersPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="manual-queue" element={<ManualQueuePage />} />
        <Route path="audit-history" element={<AuditHistoryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
