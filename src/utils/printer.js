// src/utils/printer.js
// ⚠️ 替換成您印表機的實際 IP
const PRINTER_IP = '192.168.0.114'; 
const PRINTER_PORT = '80'; // WebPRNT 預設端口

function generateReceiptXML(orderData) {
    const itemsXML = orderData.items.map(item => 
        // 格式: 品名 (數量 x 單價) = 總額
        `<text>${item.name.padEnd(20)} (${item.quantity} x $${item.price}) = $${item.price * item.quantity}.00</text>`
    ).join('');

    const xmlData = `
        <starprnt>
            <alignment type="center">
                <text size="2x">餐廳POS收據</text>
                <text>桌號: ${orderData.tableNumber}</text>
                <text>____________________________</text>
            </alignment>
            ${itemsXML}
            <text>----------------------------</text>
            <text size="2x" alignment="right">總計: NT$ ${orderData.totalAmount}.00</text>
            <text>付款方式: 現金</text>
            <alignment type="center">
                <text>---</text>
            </alignment>
            <drawer/> <cut/> </starprnt>
    `;
    return xmlData;
}

export async function printAndOpenDrawer(orderData) {
    try {
        const xmlContent = generateReceiptXML(orderData);
        
        const response = await fetch(`http://${PRINTER_IP}:${PRINTER_PORT}/StarWebPRNT/SendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `request=print&param=${encodeURIComponent(xmlContent)}`
        });
        
        if (!response.ok) {
            throw new Error(`列印失敗，HTTP 狀態碼: ${response.status}。`);
        }
        return true;
    } catch (error) {
        console.error('連線印表機錯誤:', error);
        throw new Error(`無法連線或列印: ${error.message}`);
    }
}