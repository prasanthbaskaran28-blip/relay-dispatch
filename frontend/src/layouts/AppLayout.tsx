import { useState } from "react";
import { Menu, Bell, Search, X, Truck, LogOut } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/navigation/Sidebar";

const labels: Record<string, string> = {
  "/": "Dashboard",
  "/jobs": "Delivery Jobs",
  "/riders": "Riders",
  "/assignments": "Assignments",
  "/manual-queue": "Manual Queue",
  "/audit-history": "Audit History",
};

type AppLayoutProps = {
  onSignOut: () => void;
};

export default function AppLayout({ onSignOut }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const pageTitle = labels[location.pathname] ?? "Dashboard";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="min-h-screen lg:pl-[256px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-line bg-white px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <button aria-label={mobileOpen ? "Close menu" : "Open menu"} className="icon-button lg:hidden" onClick={() => setMobileOpen((open) => !open)}>
              {mobileOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
            <div className="hidden items-center gap-2 text-sm text-muted sm:flex">
              <span>Operations</span><span className="text-slate-300">/</span><span className="font-semibold text-ink">{pageTitle}</span>
            </div>
            <span className="text-sm font-semibold text-ink sm:hidden">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button aria-label="Search" className="icon-button"><Search size={18} /></button>
            <button aria-label="Notifications" className="icon-button relative"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500" /></button>
            <div className="hidden h-8 w-px bg-line sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-brand">OP</span>
              <div className="hidden leading-tight sm:block"><p className="text-sm font-semibold text-ink">Operations</p><p className="mt-0.5 text-xs text-muted">Dispatch team</p></div>
            </div>
            <button aria-label="Sign out" className="icon-button" onClick={onSignOut} title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-7 sm:py-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted sm:hidden"><Truck size={14} /> RELAY Dispatch Desk</div>
              <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">{pageTitle}</h1>
              <p className="mt-1 text-sm text-muted">{pageTitle === "Dashboard" ? "A real-time overview of your delivery operations." : `Manage and monitor ${pageTitle.toLowerCase()}.`}</p>
            </div>
            <span className="hidden rounded-md border border-line bg-white px-3 py-2 text-xs font-medium text-muted md:inline-flex">Live operations</span>
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
