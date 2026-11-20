import { Activity, ClipboardList, Clock3, LayoutDashboard, ListChecks, Truck, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/jobs", label: "Delivery Jobs", icon: ClipboardList },
  { to: "/riders", label: "Riders", icon: Users },
  { to: "/assignments", label: "Assignments", icon: ListChecks },
  { to: "/manual-queue", label: "Manual Queue", icon: Clock3 },
  { to: "/audit-history", label: "Audit History", icon: Activity },
];

export default function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-800 bg-[#18232d] text-slate-300 transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[68px] items-center gap-3 border-b border-white/10 px-6">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white"><Truck size={19} strokeWidth={2.2} /></span>
        <div><p className="text-sm font-bold tracking-wide text-white">RELAY</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Dispatch Desk</p></div>
      </div>
      <div className="px-4 pt-7">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</p>
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`} end={end} key={to} onClick={onNavigate} to={to}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="mt-auto border-t border-white/10 px-6 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />Dispatch system online</div>
        <p className="mt-2 text-[10px] text-slate-500">RELAY Operations · v1.0</p>
      </div>
    </aside>
  );
}
