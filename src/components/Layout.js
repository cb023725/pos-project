import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

// ─── SVG Icon 元件 ───────────────────────────────────────────────────────────
const Icon = ({ name, className = 'w-5 h-5' }) => {
    const icons = {
        home: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M3 9.75L12 3l9 6.75V21a1 1 0 01-1 1H5a1 1 0 01-1-1V9.75z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M9 22V12h6v10" />
            </svg>
        ),
        table: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="6" width="18" height="3" rx="1" strokeWidth="1.8" strokeLinecap="round" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M6 9v9M18 9v9M4 18h16" />
            </svg>
        ),
        invoice: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
        ),
        menu: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M9 12h6M9 16h4" />
            </svg>
        ),
        inventory: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="2" y="7" width="20" height="14" rx="2" strokeWidth="1.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M12 12v4m-2-2h4" />
            </svg>
        ),
        reports: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
        ),
        cashDrawer: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="2" y="10" width="20" height="11" rx="2" strokeWidth="1.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M2 10l2-7h16l2 7" />
                <circle cx="12" cy="15.5" r="1.5" strokeWidth="1.8" />
            </svg>
        ),
        customers: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="9" cy="7" r="4" strokeWidth="1.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M2 21v-1a7 7 0 0114 0v1" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M19 8v6m3-3h-6" />
            </svg>
        ),
        remarks: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
        ),
        settings: (
            <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
            </svg>
        ),
        hamburger: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
        ),
    };
    return icons[name] || null;
};

// ─── 導覽項目定義（依照指定順序，移除首頁） ──────────────────────────────────
const navItems = [
    { name: '報表',   path: '/reports',     icon: 'reports'    },
    { name: '錢櫃',   path: '/cash-drawer', icon: 'cashDrawer' },
    { name: '發票',   path: '/invoices',    icon: 'invoice'    },
    { name: '庫存',   path: '/inventory',   icon: 'inventory'  },
    { name: '菜單',   path: '/menu',        icon: 'menu'       },
    { name: '註記',   path: '/remarks',     icon: 'remarks'    },
    { name: '顧客',   path: '/customers',   icon: 'customers'  },
    { name: '設定',   path: '/settings',    icon: 'settings'   },
];

const NavButton = ({ item, isExpanded, currentPath }) => {
    const isActive = currentPath === item.path;
    return (
        <Link
            to={item.path}
            className={`flex items-center p-3 my-0.5 rounded-xl transition-all ${
                isActive
                    ? 'bg-teal-500 text-gray-900 font-semibold shadow-sm'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            } ${isExpanded ? 'w-full' : 'justify-center w-full'}`}
        >
            <Icon name={item.icon} />
            {isExpanded && <span className="ml-3 whitespace-nowrap text-sm">{item.name}</span>}
        </Link>
    );
};

const Sidebar = ({ isSidebarOpen, toggleSidebar }) => {
    const location = useLocation();

    const tableItem = { name: '桌位管理', path: '/tables', icon: 'table' };
    const isTableActive = location.pathname === tableItem.path;

    const sidebarWidthClass = isSidebarOpen ? 'w-56' : 'w-14';

    return (
        <div className={`${sidebarWidthClass} bg-gray-800 text-white min-h-screen transition-all duration-300 flex flex-col p-2 shadow-2xl z-20`}>
            {/* Logo + 收合按鈕 */}
            <div className={`p-2 flex items-center mb-3 ${isSidebarOpen ? 'justify-between' : 'justify-center'}`}>
                {isSidebarOpen && (
                    <div className="flex items-center overflow-hidden">
                        <img
                            src="https://mcusercontent.com/c27db4d77ffc4c29cdbe402a9/images/deca0596-fc3a-e3b5-ad74-a7274457434c.png"
                            alt="Logo"
                            className="w-7 h-7 mr-2 object-contain rounded-md flex-shrink-0"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <h1 className="text-sm font-bold whitespace-nowrap text-white truncate">咕咕義小餐館</h1>
                    </div>
                )}
                <button
                    onClick={toggleSidebar}
                    className="p-1.5 rounded-lg hover:bg-gray-700 focus:outline-none flex-shrink-0 text-gray-400 hover:text-white transition-colors"
                    title={isSidebarOpen ? '收合選單' : '展開選單'}
                >
                    <Icon name="hamburger" />
                </button>
            </div>

            {/* 導覽列表 */}
            <nav className="flex-grow flex flex-col items-center">
                {/* 桌位管理 (主要入口) */}
                <Link
                    to={tableItem.path}
                    className={`flex items-center p-3 my-0.5 rounded-xl font-bold transition-all w-full ${
                        isTableActive ? 'bg-teal-500 text-gray-900 shadow-sm' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    } ${isSidebarOpen ? 'justify-start' : 'justify-center'}`}
                >
                    <Icon name="table" />
                    {isSidebarOpen && <span className="ml-3 whitespace-nowrap text-sm">{tableItem.name}</span>}
                </Link>

                {/* 分隔線 */}
                <div className="border-t border-gray-700 my-2 w-full opacity-40" />

                {/* 其他項目 */}
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
    const hideSidebar = ['/order', '/print'].includes(location.pathname);
    const isTablePage = location.pathname === '/tables' || location.pathname === '/takeout';
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const toggleSidebar = () => setIsSidebarOpen(prev => !prev);

    return (
        <div className="flex bg-gray-50 h-[100dvh] w-full overflow-hidden">
            {!hideSidebar && (
                <Sidebar isSidebarOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
            )}
            <div className="flex-grow h-full relative">
                <main className={`h-full ${hideSidebar || isTablePage ? 'p-0' : 'p-6 overflow-y-auto'}`}>
                    {children}
                </main>
            </div>
        </div>
    );
};

export default Layout;
