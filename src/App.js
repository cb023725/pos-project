// src/App.js (對應發票功能與錢櫃功能修正版本)

import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { populateInitialData, migrateMenuPrintNames, migrateRemarkGroups } from './db';

// ----------------------------------------------------------------------
// 引入頁面組件
// ----------------------------------------------------------------------
import OrderPage from './pages/Order';
import MenuManagementPage from './pages/MenuManagement';
import ReportPage from './pages/Reports';
import InventoryPage from './pages/Inventory';
import TableManagementPage from './pages/TableManagement'; 
import DrawerTest from './pages/DrawerTest';
// 📑 發票管理頁面
import InvoiceManagementPage from './pages/InvoiceManagement'; 
// 💰 新增：錢櫃關帳對帳頁面
import CashDrawerPage from './pages/CashDrawer';
import TakeoutPage from './pages/Takeout';
import CustomerManagementPage from './pages/CustomerManagement';
import RemarkManagementPage from './pages/RemarkManagement';

import './index.css';

// ----------------------------------------------------------------------
// 未完成頁面占位
// ----------------------------------------------------------------------
const EmptyPage = ({ name }) => <h1 className="text-3xl font-bold pt-4">{name} - 🚧 施工中</h1>;
const SettingsPage = () => <EmptyPage name="設定" />;

/**
 * 內部路由包裝組件
 * 目的：為了能夠使用 useLocation() 判斷當前路由
 */
function AppContent() {
  const location = useLocation();
  
  // 💡 判斷邏輯：如果目前在 /tables 或 /takeout 頁面，則標記為需要隱藏時間列
  const hideTimeBar = location.pathname === '/tables' || location.pathname === '/takeout';

  return (
    <Layout hideTimeBar={hideTimeBar}>
      <Routes>
        <Route path="/" element={<Navigate to="/tables" replace />} />
        <Route path="/order" element={<OrderPage />} />
        <Route path="/tables" element={<TableManagementPage />} />
        <Route path="/takeout" element={<TakeoutPage />} />
        <Route path="/invoices" element={<InvoiceManagementPage />} />
        <Route path="/reports" element={<ReportPage />} />
        <Route path="/cash-drawer" element={<CashDrawerPage />} />
        <Route path="/menu" element={<MenuManagementPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/customers" element={<CustomerManagementPage />} />
        <Route path="/remarks" element={<RemarkManagementPage />} />
        <Route path="/drawertest" element={<DrawerTest />} />
      </Routes>
    </Layout>
  );
}

/**
 * 主程式組件
 */
function App() {
  const [isDevMode, setIsDevMode] = useState(false);

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => {
      if (d.dev) setIsDevMode(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // 初始化 IndexedDB 資料 (包含 V4 的 Invoices store 升級)
    populateInitialData().catch(err => {
      console.error("資料庫初始化失敗:", err);
    });
    migrateMenuPrintNames().catch(err => {
      console.error("printName migration失敗:", err);
    });
    migrateRemarkGroups().catch(err => {
      console.error("remark groups migration失敗:", err);
    });
  }, []);

  return (
    <Router>
      {isDevMode && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#f97316', color: 'white', textAlign: 'center',
          padding: '4px 0', fontSize: '13px', fontWeight: 'bold',
          letterSpacing: '0.05em'
        }}>
          ⚠️ 測試模式 — 資料不會影響正式營業
        </div>
      )}
      <AppContent />
    </Router>
  );
}

export default App;