import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// ----------------------
// React App 初始化
// ----------------------
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ----------------------
// 列印工具函式（TCP 9100 / Node server）
// ----------------------
export async function printToMCPrint3(text) {
  try {
    // 使用 Node server 方式列印
    const response = await fetch('http://192.168.0.114:3001/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log('列印回傳:', result);
    return result;
  } catch (error) {
    console.error('列印失敗:', error);
    throw error;
  }
}
