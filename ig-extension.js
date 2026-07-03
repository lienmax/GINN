/**
 * 🧩 Expense Splitter - Instagram Story Extension Module
 * 這個外掛檔案專門負責處理「將帳務催款要求分享至 IG 限時動態」的社交功能。
 * 採用 Web Share API 機制，能完美喚起手機原生分享面板跳轉至 IG。
 */

/**
 * 喚起手機原生分享機制，將催款訊息一鍵投入 IG 限時動態
 * @param {number} amount - 欠款金額
 * @param {string} description - 項目描述
 */
async function shareToIGStory(amount, description) {
    const cleanDescription = description || 'Uncategorized';
    const shareData = {
        title: '💵 Expense Splitter Alert',
        text: `🚨 Friendly Reminder! Someone owes me $${amount} for [${cleanDescription}]. Time to pay me back via Expense Splitter! 😉👇`,
        url: window.location.origin + window.location.pathname // 自動帶上你目前的 App 首頁網址
    };

    try {
        // 偵測當前手機瀏覽器是否支援 W3C 標準的原生 Web Share 功能
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // 桌電防呆機制：改為自動複製文字與網址到剪貼簿，並開啟 IG 相機
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            // [修正] 強制使用全英文 UI 提示
            alert("Text and link copied to clipboard! Opening Instagram camera for your story.");
            window.location.href = "instagram://camera";
        }
    } catch (err) {
        console.log('Sharing process interrupted:', err);
    }
}
