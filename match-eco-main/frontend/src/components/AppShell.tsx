import { ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Factory,
  GitMerge,
  Network,
  Settings,
  LogOut,
  Menu,
  Moon,
  Sun,
  MessageCircle
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const setToken = useAppStore((state) => state.setToken);
  const [darkMode, setDarkMode] = useState(false);
  const [open, setOpen] = useState(false);

  const handleLogout = () => {
    setToken(null);
    navigate("/auth/login");
  };

  const toggleTheme = () => {
    setDarkMode((v) => !v);
    document.documentElement.classList.toggle("dark");
  };

  const navItems = [
    { path: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/waste-materials/new", icon: Factory, label: "New Waste Material" },
    { path: "/manage-waste-materials", icon: Factory, label: "Manage Waste Materials" },
    { path: "/match", icon: GitMerge, label: "Matches" },
    { path: "/cycles", icon: Network, label: "Cycles" },
    { path: "/messages", icon: MessageCircle, label: "Messages" }, // <- messages page link
    { path: "/settings", icon: Settings, label: "Settings" },
  ];

  const NavContent = () => (
    <>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
              isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Top Nav */}
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-4">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64">
                <nav className="flex flex-col gap-2 mt-8">
                  <NavContent />
                </nav>
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="flex items-center gap-2">
              <Factory className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">Industrial Portal</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Side Nav - Desktop */}
        <aside className="hidden lg:block w-64 border-r bg-card min-h-[calc(100vh-4rem)]">
          <nav className="flex flex-col gap-2 p-4">
            <NavContent />
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
