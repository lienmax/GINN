/**
 * 🧩 Expense Splitter - Partial Payment Extension Module (Option B)
 * 這個檔案專門處理「部分還款、子母帳單細胞分裂」的進階演算法。
 * 如果未來不想要這個功能，直接在 index.html 刪除對此檔案的 <script> 引用即可。
 */

// 快取當前正在操作的部分還款帳單物件
let currentActivePartialRequest = null;

/**
 * 打開部分還款的彈窗
 */
function openPartialModal(requestObject) {
    currentActivePartialRequest = requestObject;
    document.getElementById('modal-total-display').innerText = requestObject.amount;
    document.getElementById('modal-partial-amount').value = '';
    document.getElementById('partial-modal').classList.remove('hidden');
}

/**
 * 關閉部分還款的彈窗
 */
function closePartialModal() {
    document.getElementById('partial-modal').classList.add('hidden');
    currentActivePartialRequest = null;
}

/**
 * 債務人提交部分還款申請
 */
async function submitPartialPayment() {
    const partialVal = parseFloat(document.getElementById('modal-partial-amount').value);
    
    // 防呆驗證：部分還款金額必須大於 0 且小於原本的總金額
    if (!partialVal || partialVal <= 0 || partialVal >= currentActivePartialRequest.amount) {
        alert("Please enter a valid partial amount less than the total bill amount.");
        return;
    }
    
    try {
        // 將狀態改為 partial_submitted，並將還款金額寫入資料庫欄位
        const { error } = await supabaseClient.from('requests').update({ 
            status: 'partial_submitted',
            partial_amount: partialVal 
        }).eq('id', currentActivePartialRequest.id);
        
        if (error) throw error;
        
        // 通知債權人
        await supabaseClient.from('notifications').insert([{
            to_user: currentActivePartialRequest.from_user,
            message: `💰 @${myUsername} submitted a partial payment of $${partialVal} on the bill of $${currentActivePartialRequest.amount}. Please review.`
        }]);
        
        alert("Partial payment submitted! Awaiting friend's verification split.");
        closePartialModal();
        await loadRequests(); // 刷新主畫面
    } catch (err) {
        alert("Failed to submit partial payment: " + err.message);
    }
}

/**
 * 債權人同意部分還款：啟動「細胞分裂」子母帳單演算法
 */
async function acceptPartialSplitting(id, totalAmount, paidAmount, debtorUser, originalDescription) {
    const remainingBalance = totalAmount - paidAmount; // 計算剩餘尾款 (例如 3000 - 1000 = 2000)
    
    try {
        // 【動作一】：將原本的大帳單金額縮小為這次付的錢，並直接強行結案歸檔為 paid
        const { error: closeError } = await supabaseClient.from('requests').update({
            amount: paidAmount,
            status: 'paid',
            partial_amount: null
        }).eq('id', id);
        if (closeError) throw closeError;
        
        // 【動作二】：在資料庫自動分裂生成一筆全新的「尾款帳單」，狀態為已核准待付 (approved)
        const newDescription = `[Remaining Balance] ${originalDescription || 'Uncategorized'}`;
        const { error: spawnError } = await supabaseClient.from('requests').insert([{
            from_user: myUsername,
            to_user: debtorUser,
            amount: remainingBalance,
            description: newDescription,
            status: 'approved' // 因為原本的大帳單就是 approved，所以分裂出來的尾款不需要重新經過審核
        }]);
        if (spawnError) throw spawnError;
        
        // 【動作三】：發送通知給欠債人，告訴他尾款帳單已生成
        await supabaseClient.from('notifications').insert([{
            to_user: debtorUser,
            message: `✅ @${myUsername} accepted your $${paidAmount} partial payment! A new remaining balance bill of $${remainingBalance} has been generated.`
        }]);
        
        alert(`Split successful! $${paidAmount} closed, and new remaining balance bill of $${remainingBalance} generated!`);
        await loadRequests(); // 刷新主畫面看板
    } catch (err) {
        alert("Split-cell operation failed: " + err.message);
    }
}