import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { populateInitialData } from './db';

// ----------------------------------------------------------------------
// 引入頁面組件
// ----------------------------------------------------------------------
import HomePage from './pages/Home';
import OrderPage from './pages/Order';
import MenuManagementPage from './pages/MenuManagement';
import ReportPage from './pages/Reports'; 
import InventoryPage from './pages/Inventory';
import PrintPage from './pages/Print';
import TableManagementPage from './pages/TableManagement'; 
import DrawerTest from './pages/DrawerTest';

import './index.css';

// ----------------------------------------------------------------------
// 未完成頁面占位
// ----------------------------------------------------------------------
const EmptyPage = ({ name }) => <h1 className="text-3xl font-bold pt-4">{name} - 🚧 施工中</h1>;
const PaymentPage = () => <EmptyPage name="付款結帳" />;
const SettingsPage = () => <EmptyPage name="設定" />;

/**
 * 內部路由包裝組件
 * 目的：為了能夠使用 useLocation() 判斷當前路由
 */
function AppContent() {
  const location = useLocation();
  
  // 💡 判斷邏輯：如果目前在 /tables 頁面，則標記為需要隱藏時間列
  // 你可以根據需求增加其他需要隱藏的頁面路徑
  const hideTimeBar = location.pathname === '/tables';

  return (
    <Layout hideTimeBar={hideTimeBar}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/order" element={<OrderPage />} />
        <Route path="/tables" element={<TableManagementPage />} /> 
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/menu" element={<MenuManagementPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/print" element={<PrintPage />} />
        <Route path="/reports" element={<ReportPage />} /> 
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/drawertest" element={<DrawerTest />} />
      </Routes>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    populateInitialData();
  }, []);

  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;