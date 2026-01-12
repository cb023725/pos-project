import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

// 💡 次要導覽項目（排除桌位管理）
const navItems = [
    { name: '首頁', path: '/', icon: '🏠' },
    { name: '付款', path: '/payment', icon: '💳' },
    { name: '菜單管理', path: '/menu', icon: '🗒️' },
    { name: '庫存', path: '/inventory', icon: '📦' },
    { name: '報表', path: '/reports', icon: '📊' },
    { name: '設定', path: '/settings', icon: '⚙️' },
];

const NavButton = ({ item, isExpanded, currentPath, onClick }) => {
    const isActive = currentPath === item.path;

    return (
        <Link 
            key={item.name} 
            to={item.path} 
            onClick={onClick}
            className={`flex items-center p-3 my-1 rounded-lg transition ${
                isActive ? 'bg-teal-500 font-semibold text-gray-900' : 'hover:bg-gray-700'
            } ${isExpanded ? 'w-full' : 'justify-center w-full'}`}
        >
            <span className="text-xl">{item.icon}</span>
            {isExpanded && <span className="ml-3 whitespace-nowrap">{item.name}</span>}
        </Link>
    );
};

const Sidebar = ({ isSidebarOpen, toggleSidebar }) => {
    const location = useLocation();
    
    // 💡 獨立出的「桌位管理」主項目
    const tableItem = { name: '桌位管理', path: '/tables', icon: '🪑' };
    const isTableActive = location.pathname === tableItem.path;

    const sidebarWidthClass = isSidebarOpen ? 'w-64' : 'w-16'; 

    return (
        <div 
            className={`${sidebarWidthClass} bg-gray-800 text-white min-h-screen transition-all duration-300 flex flex-col p-2 shadow-2xl z-20`}
        >
            {/* Logo 區域：收合時不顯示 */}
            <div className={`p-2 flex items-center mb-4 ${isSidebarOpen ? 'justify-between' : 'justify-center'}`}>
                {isSidebarOpen && (
                    <div className="flex items-center">
                        <img 
                            src="https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/deca0596-fc3a-e3b5-ad74-a7274457434c.png" 
                            alt="Logo" 
                            className="w-8 h-8 mr-2 object-contain rounded-md" 
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <h1 className="text-l font-bold whitespace-nowrap text-white">咕咕義小餐館</h1>
                    </div>
                )}
                
                <button 
                    onClick={toggleSidebar} 
                    className="p-1 rounded hover:bg-gray-700 focus:outline-none"
                    title={isSidebarOpen ? "收合選單" : "展開選單"}
                >
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
                    </svg>
                </button>
            </div>

            {/* 導覽列表 */}
            <nav className="flex-grow flex flex-col items-center">
                
                {/* 1. 頂部獨立的「桌位管理」 */}
                <Link 
                    to={tableItem.path} 
                    className={`flex items-center p-3 my-1 rounded-lg font-bold transition w-full ${
                        // 💡 已將這裡修改為 bg-teal-500，與下方 NavButton 一致
                        isTableActive ? 'bg-teal-500 text-gray-900 shadow-lg' : 'hover:bg-gray-700'
                    } ${isSidebarOpen ? 'justify-start' : 'justify-center'}`}
                >
                    <span className="text-xl">{tableItem.icon}</span>
                    {isSidebarOpen && <span className="ml-3 whitespace-nowrap">{tableItem.name}</span>}
                </Link>

                {/* 分隔線 */}
                <div className="border-t border-gray-700 my-2 w-full opacity-50"></div>

                {/* 2. 其他 navItems 循環渲染 */}
                {navItems.map(item => (
                    <NavButton 
                        key={item.name} 
                        item={item} 
                        isExpanded={isSidebarOpen} 
                        currentPath={location.pathname} 
                    />
                ))}
            </nav>
        </div>
    );
};

const Layout = ({ children }) => {
    const location = useLocation();

    // 點餐與列印頁面隱藏 Sidebar
    const hideSidebar = ['/order', '/print'].includes(location.pathname);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const toggleSidebar = () => setIsSidebarOpen(prev => !prev);

    return (
        <div className="flex bg-gray-50 overflow-x-hidden">
            {!hideSidebar && (
                <Sidebar 
                    isSidebarOpen={isSidebarOpen} 
                    toggleSidebar={toggleSidebar} 
                />
            )}

            <div className="flex-grow min-h-screen"> 
                <main className={hideSidebar ? 'h-full' : 'p-6'}>
                    {children}
                </main>
            </div>
        </div>
    );
};

export default Layout;