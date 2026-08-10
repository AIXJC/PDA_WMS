import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';

// Pages
import { Login } from './Pages/Login';
import { Dashboard } from './Pages/Dashboard';
import { Scanner } from './Pages/Scanner';
import { Inventory } from './Pages/Inventory';
import { Orders } from './Pages/Orders';
import { Scrap } from './Pages/Scrap';
import { Settings } from './Pages/Settings';
import { Notifications } from './Pages/Notifications';
import { Reports } from './Pages/Reports';
import { Requests } from './Pages/Requests';
import { Transfers } from './Pages/Transfers';
import { Salidas } from './Pages/Salidas';
import { Adjustments } from './Pages/Adjustments';
import { HistoryPage } from './Pages/History';
import { CyclicCount } from './Pages/CyclicCount';
import { CyclicCountScan } from './Pages/CyclicCountScan';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, user } = useAuthStore();
  const hasSession = Boolean(isAuthenticated || user);
  if (!hasSession) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const DarkModeHandler = ({ children }: { children: React.ReactNode }) => {
  const { darkMode } = useAuthStore();
  
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);
  
  return <>{children}</>;
};

function App() {
  console.log('App component rendered');
  return (
    <Router>
      <DarkModeHandler>
        <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/scanner" element={
          <ProtectedRoute>
            <Scanner />
          </ProtectedRoute>
        } />
        
        <Route path="/inventory" element={
          <ProtectedRoute>
            <Inventory />
          </ProtectedRoute>
        } />
        
        <Route path="/inventory/cyclic" element={
          <ProtectedRoute>
            <CyclicCount />
          </ProtectedRoute>
        } />

        <Route path="/inventory/cyclic/:id/count" element={
          <ProtectedRoute>
            <CyclicCountScan />
          </ProtectedRoute>
        } />

        <Route path="/orders/:type/detail/:detailId?" element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        } />

        {/* Specific outbound route for Salidas (consumables) */}
        <Route path="/orders/outbound" element={
          <ProtectedRoute>
            <Salidas />
          </ProtectedRoute>
        } />

        <Route path="/orders/:type" element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        } />
        
        <Route path="/scrap" element={
          <ProtectedRoute>
            <Scrap />
          </ProtectedRoute>
        } />
        
        <Route path="/requests" element={
          <ProtectedRoute>
            <Requests />
          </ProtectedRoute>
        } />
        
        <Route path="/transfers" element={
          <ProtectedRoute>
            <Transfers />
          </ProtectedRoute>
        } />

        <Route path="/salidas" element={
          <ProtectedRoute>
            <Salidas />
          </ProtectedRoute>
        } />
        
        <Route path="/adjustments" element={
          <ProtectedRoute>
            <Adjustments />
          </ProtectedRoute>
        } />
        
        <Route path="/history" element={
          <ProtectedRoute>
            <HistoryPage />
          </ProtectedRoute>
        } />
        
        <Route path="/reports" element={
          <ProtectedRoute>
            <Reports />
          </ProtectedRoute>
        } />
        
        <Route path="/notifications" element={
          <ProtectedRoute>
            <Notifications />
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </DarkModeHandler>
    </Router>
  );
}

export default App;
