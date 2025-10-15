import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import Landing from "./pages/Landing";
import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Dashboard from "./pages/Dashboard";
import WasteMaterialWizard from "./pages/waste-materials/WasteMaterialWizard";
import Match from "./pages/Match";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import ManageFactories from "./pages/ManageFactories";
import { AuthGuard } from "./components/AuthGuard";
import Messages from "./pages/Messages";

const Cycles = lazy(() => import("./pages/Cycles"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth/login" element={<Login />} />
          <Route path="/auth/register" element={<Register />} />
          <Route path="/auth/forgot" element={<ForgotPassword />} />
          
          <Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
          <Route path="/waste-materials/new" element={<AuthGuard><WasteMaterialWizard /></AuthGuard>} />
          <Route path="/manage-waste-materials" element={<AuthGuard><ManageFactories /></AuthGuard>} />
          <Route path="/match" element={<AuthGuard><Match /></AuthGuard>} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/cycles" element={
            <AuthGuard>
              <Suspense fallback={<div>Loading...</div>}>
                <Cycles />
              </Suspense>
            </AuthGuard>
          } />
          <Route path="/settings" element={<AuthGuard><Settings /></AuthGuard>} />
          
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
