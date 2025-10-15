import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppStore } from "@/store/useAppStore";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const token = useAppStore((state) => state.token);
  
  if (!token) {
    return <Navigate to="/auth/login" replace />;
  }
  
  return <>{children}</>;
}
