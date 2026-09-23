import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/** Requires any authenticated, active user. */
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

/** Requires a specific permission (module:action). SUPER_ADMIN bypasses. */
export function RequirePermission({ module, action = "view", children }) {
  const { user, has, hasRole, loading } = useAuth();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (hasRole("SUPER_ADMIN") || has(module, action)) return children;
  return <AccessDenied />;
}

/** Requires one of the listed roles (SUPER_ADMIN always allowed). */
export function RequireRole({ roles, children }) {
  const { user, hasRole, loading } = useAuth();
  if (loading) return <FullscreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (hasRole(...roles)) return children;
  return <AccessDenied />;
}

function FullscreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center text-ink-faint text-sm">
      Loading…
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="p-9 max-w-xl mx-auto">
      <div className="bg-surface border border-line rounded-md shadow-card p-6 text-center">
        <h2 className="text-lg font-semibold text-negative mb-2">Access denied</h2>
        <p className="text-ink-soft text-sm">
          Your account or team doesn't have permission for this module. Contact an administrator.
        </p>
      </div>
    </div>
  );
}