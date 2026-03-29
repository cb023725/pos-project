// src/App.js (對應發票功能與錢櫃功能修正版本)

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { populateInitialData, migrateMenuPrintNames, migrateRemarkGroups } from './db';

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
const PaymentPage = () => <EmptyPage name="付款結帳" />;
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
        <Route path="/" element={<HomePage />} />
        <Route path="/order" element={<OrderPage />} />
        <Route path="/tables" element={<TableManagementPage />} />
        <Route path="/takeout" element={<TakeoutPage />} />
        <Route path="/payment" element={<PaymentPage />} />
        
        {/* 📑 發票與報表相關路由 */}
        <Route path="/invoices" element={<InvoiceManagementPage />} /> 
        <Route path="/reports" element={<ReportPage />} /> 
        
        {/* 💰 錢櫃相關路由 */}
        <Route path="/cash-drawer" element={<CashDrawerPage />} />

        <Route path="/menu" element={<MenuManagementPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/print" element={<PrintPage />} />
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
      <AppContent />
    </Router>
  );
}

export default App;