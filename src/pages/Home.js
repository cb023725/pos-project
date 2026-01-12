// src/pages/Home.js
import React from 'react';

// 首頁組件：通常用於儀表板或歡迎畫面
function HomePage() {
  return (
    <div className="p-4">
      <h2 className="text-3xl font-bold mb-6 text-gray-800">
        POS 系統儀表板
      </h2>
      <p className="text-lg text-gray-600">
        歡迎使用 iPad-POS 系統。請使用左側導航欄進行操作。
      </p>
      
      {/* 可以在這裡添加一些簡單的儀表板數據 */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold text-blue-600">今日營收</h3>
          <p className="text-4xl mt-2">$ 0.00</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold text-green-600">待處理訂單</h3>
          <p className="text-4xl mt-2">0</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h3 className="text-xl font-semibold text-yellow-600">低庫存商品</h3>
          <p className="text-4xl mt-2">0</p>
        </div>
      </div>
    </div>
  );
}

export default HomePage;