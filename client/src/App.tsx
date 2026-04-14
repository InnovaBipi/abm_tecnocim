import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Layout } from '@/components/layout/Layout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';

// Lazy-loaded pages — each becomes a separate chunk
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Prospects = lazy(() => import('@/pages/Prospects'));
const ProspectDetail = lazy(() => import('@/pages/ProspectDetail'));
const Companies = lazy(() => import('@/pages/Companies'));
const CompanyDetail = lazy(() => import('@/pages/CompanyDetail'));
const Campaigns = lazy(() => import('@/pages/Campaigns'));
const CampaignDetail = lazy(() => import('@/pages/CampaignDetail'));
const Outbox = lazy(() => import('@/pages/Outbox'));
const Imports = lazy(() => import('@/pages/Imports'));
const Settings = lazy(() => import('@/pages/Settings'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  );
}

export default function App() {
  const { loadUser, isAuthenticated } = useAuthStore();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected routes with layout */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
        <Route path="/prospects" element={<Suspense fallback={<PageLoader />}><Prospects /></Suspense>} />
        <Route path="/prospects/:id" element={<Suspense fallback={<PageLoader />}><ProspectDetail /></Suspense>} />
        <Route path="/companies" element={<Suspense fallback={<PageLoader />}><Companies /></Suspense>} />
        <Route path="/companies/:id" element={<Suspense fallback={<PageLoader />}><CompanyDetail /></Suspense>} />
        <Route path="/campaigns" element={<Suspense fallback={<PageLoader />}><Campaigns /></Suspense>} />
        <Route path="/campaigns/:id" element={<Suspense fallback={<PageLoader />}><CampaignDetail /></Suspense>} />
        <Route path="/outbox" element={<Suspense fallback={<PageLoader />}><Outbox /></Suspense>} />
        <Route path="/imports" element={<Suspense fallback={<PageLoader />}><Imports /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageLoader />}><Settings /></Suspense>} />

        {/* Redirect old sequences routes to campaigns */}
        <Route path="/sequences" element={<Navigate to="/campaigns" replace />} />
        <Route path="/sequences/:id" element={<Navigate to="/campaigns" replace />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
