import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Layout } from '@/components/layout/Layout';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Prospects from '@/pages/Prospects';
import ProspectDetail from '@/pages/ProspectDetail';
import Companies from '@/pages/Companies';
import Campaigns from '@/pages/Campaigns';
import CampaignDetail from '@/pages/CampaignDetail';
import Outbox from '@/pages/Outbox';
import Imports from '@/pages/Imports';
import Settings from '@/pages/Settings';

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
        <Route path="/" element={<Dashboard />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/prospects/:id" element={<ProspectDetail />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetail />} />
        <Route path="/outbox" element={<Outbox />} />
        <Route path="/imports" element={<Imports />} />
        <Route path="/settings" element={<Settings />} />

        {/* Redirect old sequences routes to campaigns */}
        <Route path="/sequences" element={<Navigate to="/campaigns" replace />} />
        <Route path="/sequences/:id" element={<Navigate to="/campaigns" replace />} />
      </Route>

      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
