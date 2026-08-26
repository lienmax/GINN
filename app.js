// ==========================================
// 1. 初始化與全域變數 (Initialization)
// ==========================================
const SUPABASE_URL = "https://zrpgelaakysmkemxzdfb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_A5kHkD-Bks-II1zFnv-7tQ_YBBqkKxp";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null; 
let myUsername = ""; 
let realtimeChannel = null;
let isRealtimeSubscribed = false;
let showingHistory = false;

let selectedFriends = []; 
let globalUniqueFriends = new Set();
let globalFriendBalances = {};
let currentPartialReq = null; 

// 🎨 雙軌頭像判斷邏輯：優先使用自訂上傳網址，其次使用 DiceBear 自動生成風格
function getAvatarDisplay(profileData, username) {
    if (profileData && profileData.avatar_url) {
        return profileData.avatar_url;
    }
    const style = (profileData && profileData.avatar_style) ? profileData.avatar_style : 'fun-emoji';
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${username}`;
}

// 未來建議將管理員驗證移至後端 RLS
const ADMIN_USERNAMES = ["admin", "00"];
function isAdmin() { return ADMIN_USERNAMES.includes(myUsername.toLowerCase()); }

function formatDate(dateString) { 
    return dateString ? new Date(dateString).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; 
}

// 畫面載入時檢查登入狀態
window.onload = function() { checkUser(); };


// ==========================================
// 2. UI 元件與提示系統 (UI & Toast)
// ==========================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let bgClass = type === 'success' ? 'bg-green-600' : (type === 'error' ? 'bg-red-500' : 'bg-blue-500');
    let icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');

    toast.className = `flex items-center gap-3 ${bgClass} text-white px-4 py-3 rounded-2xl shadow-xl transition-all duration-300 transform -translate-y-10 opacity-0`;
    toast.innerHTML = `<span class="text-sm">${icon}</span> <p class="text-sm font-medium tracking-wide">${message}</p>`;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-10', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-10', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getSkeletonHTML() {
    let html = '';
    for(let i=0; i<3; i++) {
        html += `
        <div class="request-item flex flex-col gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm animate-pulse">
            <div class="flex justify-between items-start">
                <div class="w-2/3">
                    <div class="h-4 bg-gray-200 rounded w-1/2 mb-2.5"></div>
                    <div class="h-3 bg-gray-100 rounded w-1/3 mb-1.5"></div>
                    <div class="h-2 bg-gray-100 rounded w-1/4"></div>
                </div>
                <div class="text-right w-1/3 flex flex-col items-end">
                    <div class="h-5 bg-gray-200 rounded w-1/2 mb-2"></div>
                    <div class="h-3 bg-gray-100 rounded w-2/3"></div>
                </div>
            </div>
        </div>`;
    }
    return html;
}

function showIOSModal(options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('ios-modal');
        const box = document.getElementById('ios-modal-box');
        document.getElementById('ios-modal-title').innerText = options.title || '';
        document.getElementById('ios-modal-message').innerText = options.message || '';
        
        const inputEl = document.getElementById('ios-modal-input');
        const cancelBtn = document.getElementById('ios-modal-cancel');
        const confirmBtn = document.getElementById('ios-modal-confirm');

        if (options.type === 'prompt') {
            inputEl.classList.remove('hidden'); 
            inputEl.value = options.defaultValue || '';
            setTimeout(() => inputEl.focus(), 100);
        } else { 
            inputEl.classList.add('hidden'); 
        }

        if (options.type === 'alert') {
            cancelBtn.classList.add('hidden'); 
            confirmBtn.classList.remove('border-l');
        } else { 
            cancelBtn.classList.remove('hidden'); 
            confirmBtn.classList.add('border-l'); 
        }

        modal.classList.remove('hidden');
        setTimeout(() => box.classList.remove('scale-95', 'opacity-0'), 10);

        const cleanup = () => {
            box.classList.add('scale-95', 'opacity-0');
            setTimeout(() => modal.classList.add('hidden'), 200);
            cancelBtn.onclick = null; confirmBtn.onclick = null;
        };

        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        confirmBtn.onclick = () => { cleanup(); resolve(options.type === 'prompt' ? inputEl.value : true); };
    });
}


// ==========================================
// 3. 用戶驗證與導航系統 (Auth & Navigation)
// ==========================================
function toggleAuthMode(isRegistering) {
    const title = document.getElementById('auth-title');
    const blocks = ['login-fields-block', 'login-actions'];
    const regBlocks = ['register-fields-block', 'register-actions'];
    document.querySelectorAll('input').forEach(i => i.value = '');
    
    if (isRegistering) {
        title.innerText = "Create New Account"; 
        blocks.forEach(b => document.getElementById(b).classList.add('hidden'));
        regBlocks.forEach(b => document.getElementById(b).classList.remove('hidden'));
    } else {
        title.innerText = "User Login"; 
        blocks.forEach(b => document.getElementById(b).classList.remove('hidden'));
        regBlocks.forEach(b => document.getElementById(b).classList.add('hidden'));
    }
}

async function showMainPage() {
    document.getElementById('app-main-title').classList.add('hidden'); 
    document.getElementById('auth-section').classList.add('hidden'); 
    document.getElementById('main-section').classList.remove('hidden'); 
    document.getElementById('user-display').innerText = myUsername;
    
    if (isAdmin()) document.getElementById('admin-badge').classList.remove('hidden');
    else document.getElementById('admin-badge').classList.add('hidden');
    
    // 🎨 載入自己的頭像（支援自訂圖片或預設風格）
    try {
        const { data } = await supabaseClient.from('profiles').select('avatar_style, avatar_url').eq('username', myUsername).maybeSingle();
        const avatarImg = document.getElementById('my-avatar-img');
        if(avatarImg) avatarImg.src = getAvatarDisplay(data, myUsername);
    } catch (e) { console.error("Avatar load error", e); }

    updateNotificationButtonUI();
    Promise.all([loadRequests(true), loadNotifications()]); 
    setupRealtime();
}

function showAuthPage() { 
    document.getElementById('app-main-title').classList.remove('hidden'); 
    document.getElementById('main-section').classList.add('hidden'); 
    document.getElementById('auth-section').classList.remove('hidden'); 
}

async function checkUser() {
    try {
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
        if (user && !userError) { 
            currentUser = user;
            const { data: profile } = await supabaseClient.from('profiles').select('username').eq('id', user.id).maybeSingle();
            myUsername = profile ? profile.username.toLowerCase() : (user.user_metadata?.username || user.email.split('@')[0]).toLowerCase();
            showMainPage(); 
        } else { 
            showAuthPage(); 
        }
    } catch (err) { 
        console.error("Auth check failed:", err);
        showAuthPage(); 
    }
}

async function register() {
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim().toLowerCase();
    const password = document.getElementById('auth-password').value;
    
    if (!email || !username || !password || username.includes('@')) { 
        showToast("Invalid format or missing fields.", "error"); 
        return; 
    }
    
    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { username } } });
        if (error) throw error;
        if (data?.user) { 
            await supabaseClient.from('profiles').insert([{ id: data.user.id, username }]); 
        }
        showToast("Registered successfully! You can now log in.", "success"); 
        toggleAuthMode(false);
    } catch (e) { 
        showToast(e.message, "error"); 
        console.error(e);
    }
}

async function login() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentUser = data.user; 
        await checkUser();
        showToast(`Welcome back, @${myUsername}!`, "success");
    } catch (e) { 
        showToast(e.message, "error"); 
        console.error(e);
    }
}

async function logout() { 
    if (realtimeChannel) { 
        supabaseClient.removeChannel(realtimeChannel); 
        realtimeChannel = null; 
        isRealtimeSubscribed = false; 
    }
    await supabaseClient.auth.signOut(); 
    currentUser = null; 
    myUsername = ""; 
    showAuthPage();
}


// ==========================================
// 4. 核心業務邏輯 (Core Splitting & Requests)
// ==========================================

// --- 好友選擇邏輯 ---
function renderFriendsChips() {
    const friendsContainer = document.getElementById('recent-friends-container');
    const friendsList = document.getElementById('recent-friends-list');
    
    if (globalUniqueFriends.size > 0) {
        friendsContainer.classList.remove('hidden'); 
        friendsList.innerHTML = '';
        
        Array.from(globalUniqueFriends).slice(0, 8).forEach(friend => {
            const chip = document.createElement('button');
            const isSelected = selectedFriends.includes(friend);
            const balance = globalFriendBalances[friend] || 0;
            let balanceText = `$${Math.abs(balance).toFixed(1)}`; 
            let balanceColorClass = "text-gray-400";
            
            if (balance > 0) { 
                balanceText = `+${balanceText}`; 
                balanceColorClass = isSelected ? "text-blue-200" : "text-green-600 font-bold"; 
            } else if (balance < 0) { 
                balanceText = `-${balanceText}`; 
                balanceColorClass = isSelected ? "text-red-200" : "text-red-500 font-bold"; 
            } else { 
                balanceText = `$0.0`; 
            }

            chip.className = isSelected 
                ? "bg-blue-600 border border-blue-600 text-white px-3 py-1.5 rounded-full text-xs font-semibold shadow flex-shrink-0 active:scale-95 transition-all flex items-center gap-1.5"
                : "bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm flex-shrink-0 hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all flex items-center gap-1.5";
            
            chip.innerHTML = `<span>@${friend}</span> <span class="${balanceColorClass} text-[10px] opacity-90">${balanceText}</span>`;
            chip.onclick = () => toggleFriendSelection(friend);
            friendsList.appendChild(chip);
        });
    } else { 
        friendsContainer.classList.add('hidden'); 
    }
}

function toggleFriendSelection(username) {
    const idx = selectedFriends.indexOf(username);
    if (idx > -1) selectedFriends.splice(idx, 1); 
    else selectedFriends.push(username); 
    updateFriendSelectionUI();
}

function clearFriendSelection() {
    selectedFriends = [];
    const debtorInput = document.getElementById('debtor-input');
    debtorInput.value = '';
    debtorInput.readOnly = false;
    debtorInput.classList.remove('bg-blue-50', 'text-blue-700', 'font-semibold', 'border-blue-300');
    document.getElementById('clear-select-btn').classList.add('hidden');
    
    const oldTip = document.getElementById('split-live-tip');
    if (oldTip) oldTip.remove();
    
    renderFriendsChips();
}

function updateFriendSelectionUI() {
    const debtorInput = document.getElementById('debtor-input');
    const clearBtn = document.getElementById('clear-select-btn');
    
    if (selectedFriends.length > 0) {
        debtorInput.value = `Selected: ${selectedFriends.map(f => '@' + f).join(', ')}`;
        debtorInput.readOnly = true; 
        debtorInput.classList.add('bg-blue-50', 'text-blue-700', 'font-semibold', 'border-blue-300');
        clearBtn.classList.remove('hidden');
    } else {
        debtorInput.value = ''; 
        debtorInput.readOnly = false;
        debtorInput.classList.remove('bg-blue-50', 'text-blue-700', 'font-semibold', 'border-blue-300');
        clearBtn.classList.add('hidden');
    }
    renderFriendsChips(); 
    calculateLiveSplit();
}

document.getElementById('amount').addEventListener('input', calculateLiveSplit);

function calculateLiveSplit() {
    const amountInput = document.getElementById('amount');
    const totalAmount = parseFloat(amountInput.value);
    const oldTip = document.getElementById('split-live-tip');
    if (oldTip) oldTip.remove();
    
    if (selectedFriends.length > 0 && !isNaN(totalAmount) && totalAmount > 0) {
        const totalPeople = selectedFriends.length + 1;
        const splitAmount = (totalAmount / totalPeople).toFixed(2);
        const tipDiv = document.createElement('div');
        tipDiv.id = "split-live-tip"; 
        tipDiv.className = "text-xs text-blue-500 font-semibold mt-1 pl-1";
        tipDiv.innerText = `💡 Splitting: $${splitAmount} per person (${totalPeople} people total)`;
        amountInput.parentNode.insertBefore(tipDiv, amountInput.nextSibling);
    }
}


// --- 模糊搜尋好友模組 ---
let searchTimeout = null;
const debtorInput = document.getElementById('debtor-input');
const searchDropdown = document.getElementById('search-dropdown');

debtorInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim().toLowerCase();
    
    if (debtorInput.readOnly || query.length < 1) {
        searchDropdown.classList.add('hidden');
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const { data, error } = await supabaseClient
                .from('profiles')
                .select('username')
                .ilike('username', `%${query}%`) 
                .neq('username', myUsername) 
                .limit(5);
                
            if (error) throw error;
            renderSearchResults(data);
        } catch (err) {
            console.error("Search failed:", err);
        }
    }, 300); 
});

function renderSearchResults(users) {
    searchDropdown.innerHTML = '';
    
    if (!users || users.length === 0) {
        searchDropdown.innerHTML = `<div class="p-3 text-xs text-gray-400 text-center">No users found.</div>`;
        searchDropdown.classList.remove('hidden');
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = "p-3 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors";
        item.innerText = `@${user.username}`;
        
        item.onclick = () => {
            selectedFriends = [];
            debtorInput.value = user.username;
            debtorInput.readOnly = true;
            debtorInput.classList.add('bg-blue-50', 'text-blue-700', 'font-semibold', 'border-blue-300');
            document.getElementById('clear-select-btn').classList.remove('hidden');
            renderFriendsChips();
            searchDropdown.classList.add('hidden');
            const oldTip = document.getElementById('split-live-tip');
            if (oldTip) oldTip.remove();
        };
        
        searchDropdown.appendChild(item);
    });
    
    searchDropdown.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
    if (!debtorInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.add('hidden');
    }
});


// --- 發送與讀取資料 ---
async function sendRequest() {
    const amount = parseFloat(document.getElementById('amount').value);
    const description = document.getElementById('description').value;
    
    if (!amount || isNaN(amount) || amount <= 0) { 
        showToast("Please enter a valid amount.", "error"); 
        return; 
    }
    
    try {
        let targets = [];
        let finalAmountPerPerson = amount;
        
        if (selectedFriends.length > 0) {
            targets = [...selectedFriends];
            finalAmountPerPerson = Math.round((amount / (selectedFriends.length + 1)) * 100) / 100;
        } else {
            const targetInput = document.getElementById('debtor-input').value.trim().toLowerCase();
            if (!targetInput) { showToast("Please select or type a friend's username.", "error"); return; }
            
            const searchTarget = targetInput.includes('@') ? targetInput.replace('selected: ', '').split('@')[1].split(',')[0].trim() : targetInput;
            
            const { data: receiver } = await supabaseClient.from('profiles').select('username').eq('username', searchTarget).maybeSingle();
            if (!receiver || receiver.username === myUsername) { showToast("User not found.", "error"); return; }
            
            targets.push(receiver.username);
        }
        
        for (const targetUser of targets) {
            await supabaseClient.from('requests').insert([{ 
                from_user: myUsername, 
                to_user: targetUser, 
                amount: finalAmountPerPerson, 
                description: description || 'Split Bill', 
                status: 'pending' 
            }]);
            await supabaseClient.from('notifications').insert([{ 
                to_user: targetUser, 
                message: `💰 @${myUsername} requested $${finalAmountPerPerson.toFixed(2)} for [${description || 'Split Bill'}]` 
            }]);
        }
        
        showToast(`Successfully requested from ${targets.length} friends!`, "success");
        clearFriendSelection();
        document.getElementById('amount').value = ''; 
        document.getElementById('description').value = '';
    } catch (e) { 
        showToast("Failed to process splitting.", "error"); 
        console.error(e);
    }
}

function toggleHistory() {
    showingHistory = !showingHistory;
    const reqList = document.getElementById('request-list');
    const histList = document.getElementById('history-list');
    const btn = document.getElementById('history-toggle-btn');
    if (showingHistory) {
        reqList.classList.add('hidden'); 
        histList.classList.remove('hidden'); 
        histList.classList.add('flex');
        btn.innerText = "Show Active"; 
        btn.classList.replace('bg-gray-200', 'bg-blue-100'); 
        btn.classList.replace('text-gray-700', 'text-blue-800');
        loadHistory(true); 
    } else {
        reqList.classList.remove('hidden'); 
        histList.classList.add('hidden'); 
        histList.classList.remove('flex');
        btn.innerText = "Show History"; 
        btn.classList.replace('bg-blue-100', 'bg-gray-200'); 
        btn.classList.replace('text-blue-800', 'text-gray-700');
        loadRequests(true);
    }
}

async function loadRequests(showSkeleton = false) {
    try {
        const listDiv = document.getElementById('request-list');
        if (showSkeleton) listDiv.innerHTML = getSkeletonHTML();

        let query = supabaseClient.from('requests').select('*');
        if (!isAdmin()) { query = query.or(`to_user.eq.${myUsername},from_user.eq.${myUsername}`); }
        const { data: allData, error } = await query.order('created_at', { ascending: false });
        
        if (error) throw error;
        if (!allData) return;

        let totalOwe = 0; let totalOwed = 0; 
        let uniqueFriends = new Set(); 
        let friendBalances = {}; 
        const activeData = [];

        allData.forEach(req => {
            const isFromMe = req.from_user === myUsername; 
            const isToMe = req.to_user === myUsername;
            
            if (isFromMe || isToMe) {
                const friendName = isFromMe ? req.to_user : req.from_user;
                if (friendName && friendName !== myUsername) { 
                    uniqueFriends.add(friendName); 
                    if (!friendBalances[friendName]) friendBalances[friendName] = 0;
                    if (['pending', 'approved', 'payment_submitted', 'partial_submitted'].includes(req.status)) {
                        let amt = Number(req.amount); 
                        friendBalances[friendName] = Math.round((friendBalances[friendName] + (isFromMe ? amt : -amt)) * 100) / 100;
                    }
                }
            }
            if (['pending', 'approved', 'payment_submitted', 'partial_submitted'].includes(req.status)) {
                activeData.push(req);
                if (req.status === 'pending' || req.status === 'approved') { 
                    if (isToMe) totalOwe += Number(req.amount); 
                    if (isFromMe) totalOwed += Number(req.amount); 
                }
            }
        });

        document.getElementById('total-owe').innerText = `$${totalOwe.toFixed(2)}`;
        document.getElementById('total-owed').innerText = `$${totalOwed.toFixed(2)}`;

        globalUniqueFriends = uniqueFriends; 
        globalFriendBalances = friendBalances; 
        renderFriendsChips();

        if (activeData.length === 0) { 
            listDiv.innerHTML = "<p class='text-gray-400 text-xs italic py-4 text-center'>No active requests.</p>"; 
            return; 
        }
        
        const fragment = document.createDocumentFragment();
        listDiv.innerHTML = '';
        
        activeData.forEach(req => {
            const item = document.createElement('div'); 
            item.className = 'request-item flex flex-col gap-2 p-3 bg-white rounded-xl border border-gray-100 shadow-sm';
            const isDebtor = (req.to_user === myUsername); 
            const timeString = formatDate(req.created_at);
            let statusBadge = "", actionButtons = "";
            
            switch(req.status) {
                case 'pending':
                    statusBadge = `<span class="bg-yellow-100 text-yellow-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Pending</span>`;
                    if (isDebtor) { 
                        actionButtons = `<div class="flex gap-2 justify-end mt-1"><button class="btn-sm bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 active:scale-95" onclick="updateStatus('${req.id}', 'rejected', '${req.from_user}', 'rejected request.')">Reject</button><button class="btn-sm bg-blue-500 text-white hover:bg-blue-600 shadow-sm active:scale-95" onclick="updateStatus('${req.id}', 'approved', '${req.from_user}', 'accepted request.')">Accept</button></div>`; 
                    } else { 
                        actionButtons = `<span class="text-[11px] text-gray-400 italic text-right mt-1 block">Awaiting approval...</span>`; 
                    }
                    break;
                case 'approved':
                    statusBadge = `<span class="bg-blue-100 text-blue-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Approved</span>`;
                    if (isDebtor) { 
                        actionButtons = `<div class="flex gap-2 justify-end mt-1"><button class="btn-sm bg-amber-500 text-white hover:bg-amber-600 shadow-sm active:scale-95" onclick='openPartialModal(${JSON.stringify(req).replace(/"/g, '&quot;')})'>Pay Partially</button><button class="btn-sm bg-green-600 text-white hover:bg-green-700 shadow-sm active:scale-95" onclick="initiatePayment('${req.id}', '${req.from_user}')">💳 Pay & Mark Paid</button></div>`;
                    } else { 
                        actionButtons = `<span class="text-[11px] text-gray-400 italic text-right mt-1 block">Waiting for friend to pay...</span>`; 
                    }
                    break;
                case 'payment_submitted':
                    statusBadge = `<span class="bg-purple-100 text-purple-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Verify?</span>`;
                    if (!isDebtor) { 
                        actionButtons = `<div class="flex gap-2 justify-end mt-1"><button class="btn-sm bg-red-500 text-white hover:bg-red-600 shadow-sm active:scale-95" onclick="updateStatus('${req.id}', 'approved', '${req.to_user}', 'declined payment confirmation.')">Reject Payment</button><button class="btn-sm bg-green-600 text-white hover:bg-green-700 shadow-sm active:scale-95" onclick="updateStatus('${req.id}', 'paid', '${req.to_user}', 'confirmed payment!')">Accept & Close</button></div>`; 
                    } else { 
                        actionButtons = `<span class="text-[11px] text-gray-400 italic text-right mt-1 block">Waiting for verification...</span>`; 
                    }
                    break;
                case 'partial_submitted':
                    statusBadge = `<span class="bg-orange-100 text-orange-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Partial ($${Number(req.partial_amount).toFixed(2)})</span>`;
                    if (!isDebtor) { 
                        actionButtons = `<div class="flex gap-2 justify-end mt-1"><button class="btn-sm bg-red-500 text-white hover:bg-red-600 shadow-sm active:scale-95" onclick="updateStatus('${req.id}', 'approved', '${req.to_user}', 'declined partial payment.')">Reject</button><button class="btn-sm bg-green-600 text-white hover:bg-green-700 shadow-sm active:scale-95" onclick="acceptPartialSplitting('${req.id}', ${req.amount}, ${req.partial_amount}, '${req.to_user}', '${req.description}')">Accept & Split</button></div>`; 
                    } else { 
                        actionButtons = `<span class="text-[11px] text-gray-400 italic text-right mt-1 block">Awaiting partner split...</span>`; 
                    }
                    break;
            }

            if (isAdmin()) {
                let adminBtnHtml = `<button class="btn-sm border border-blue-200 text-blue-800 bg-white hover:bg-blue-100 active:scale-95 transition-all shadow-sm" onclick="adminOverrideAmount('${req.id}', ${req.amount}, '${req.from_user}', '${req.to_user}')">🔧 Edit</button>`;
                if (req.status === 'pending') { adminBtnHtml += `<button class="btn-sm border border-blue-200 text-blue-800 bg-white hover:bg-blue-100 active:scale-95 transition-all shadow-sm" onclick="adminForceAccept('${req.id}', '${req.from_user}', '${req.to_user}')">⚡ Accept</button>`; }
                if (['approved', 'payment_submitted', 'partial_submitted'].includes(req.status)) { adminBtnHtml += `<button class="btn-sm border border-blue-200 text-blue-800 bg-white hover:bg-blue-100 active:scale-95 transition-all shadow-sm" onclick="adminForcePaid('${req.id}', '${req.from_user}', '${req.to_user}')">⚡ Paid</button>`; }
                
                const adminZoneHtml = `<div class="w-full mt-3 pt-2 border-t border-blue-100 flex gap-2 justify-end items-center bg-blue-50 rounded-b-xl px-2 pb-1"><span class="text-[9px] text-blue-800 font-extrabold uppercase tracking-widest mr-auto pl-1 opacity-70">Admin Zone</span>${adminBtnHtml}</div>`;
                if (actionButtons.includes('flex')) { actionButtons = actionButtons.replace('</div>', `</div>${adminZoneHtml}`); } 
                else { actionButtons = `<div class="w-full">${actionButtons}${adminZoneHtml}</div>`; }
            }

            item.innerHTML = `<div class="flex justify-between items-start"><div><span class="font-bold text-gray-800 text-sm">@${req.from_user} ➔ @${req.to_user}</span><p class="text-xs text-gray-500 mt-0.5">Item: ${req.description || 'Uncategorized'}</p><p class="text-[10px] text-gray-400 mt-0.5">🕒 ${timeString}</p></div><div class="text-right"><span class="text-[17px] font-extrabold text-gray-900">$${Number(req.amount).toFixed(2)}</span><div class="mt-1.5">${statusBadge}</div></div></div>${actionButtons}`;
            fragment.appendChild(item);
        });
        
        listDiv.appendChild(fragment);
    } catch (e) {
        console.error("Failed to load requests:", e);
    }
}

async function loadHistory(showSkeleton = false) {
    try {
        const listDiv = document.getElementById('history-list');
        if (showSkeleton) listDiv.innerHTML = getSkeletonHTML();

        let query = supabaseClient.from('requests').select('*');
        if (!isAdmin()) { query = query.or(`to_user.eq.${myUsername},from_user.eq.${myUsername}`); }
        
        const { data, error } = await query.in('status', ['paid', 'rejected']).order('created_at', { ascending: false }).limit(30);
        if (error) throw error;
        
        if (!data || data.length === 0) { 
            listDiv.innerHTML = "<p class='text-gray-400 text-xs italic py-4 text-center'>No history records.</p>"; 
            return; 
        }
        
        const fragment = document.createDocumentFragment();
        listDiv.innerHTML = '';
        
        data.forEach(req => {
            const item = document.createElement('div'); 
            item.className = 'request-item flex flex-col gap-2 opacity-85 bg-gray-50 p-3.5 rounded-xl border border-gray-100 transition-all';
            const timeString = formatDate(req.created_at);
            let statusBadge = req.status === 'paid' ? `<span class="bg-gray-200 text-gray-700 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Paid</span>` : `<span class="bg-red-50 text-red-500 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-bold">Rejected</span>`;
            
            item.innerHTML = `<div class="flex justify-between items-start"><div><span class="font-bold text-gray-700 text-sm">@${req.from_user} ➔ @${req.to_user}</span><p class="text-xs text-gray-500 mt-0.5">Item: ${req.description || 'Uncategorized'}</p><p class="text-[10px] text-gray-400 mt-0.5">🕒 ${timeString}</p></div><div class="text-right"><span class="text-[15px] font-bold text-gray-500">$${Number(req.amount).toFixed(2)}</span><div class="mt-1.5">${statusBadge}</div></div></div>`;
            fragment.appendChild(item);
        });
        listDiv.appendChild(fragment);
    } catch (e) {
        console.error("Failed to load history:", e);
    }
}

async function updateStatus(id, newStatus, notifyTarget, notifyActionMessage) {
    try {
        await supabaseClient.from('requests').update({ status: newStatus }).eq('id', id);
        await supabaseClient.from('notifications').insert([{ to_user: notifyTarget, message: `🔔 @${myUsername} ${notifyActionMessage}` }]);
        
        if (showingHistory) await loadHistory(false); 
        else await loadRequests(false); 
        
        showToast("Status updated successfully!", "success");
    } catch (e) { 
        showToast("Action failed.", "error"); 
        console.error(e);
    }
}

// --- 部分還款邏輯 ---
function openPartialModal(req) {
    currentPartialReq = req; 
    document.getElementById('modal-total-display').innerText = Number(req.amount).toFixed(2);
    document.getElementById('modal-partial-amount').value = ''; 
    document.getElementById('partial-modal').classList.remove('hidden');
}

function closePartialModal() { 
    currentPartialReq = null; 
    document.getElementById('partial-modal').classList.add('hidden'); 
}

async function submitPartialPayment() {
    const amt = parseFloat(document.getElementById('modal-partial-amount').value);
    if (!amt || amt <= 0 || amt >= Number(currentPartialReq.amount)) { 
        showToast("Invalid amount. Must be less than total.", "error"); 
        return; 
    }
    try {
        await supabaseClient.from('requests').update({ status: 'partial_submitted', partial_amount: amt }).eq('id', currentPartialReq.id);
        await supabaseClient.from('notifications').insert([{ to_user: currentPartialReq.from_user, message: `💰 @${myUsername} submitted a partial payment of $${amt.toFixed(2)}` }]);
        
        closePartialModal(); 
        loadRequests(false); 
        showToast("Partial payment submitted!", "success");
    } catch (e) { 
        showToast("Submission failed.", "error"); 
        console.error(e);
    }
}

async function acceptPartialSplitting(id, totalAmount, partialAmount, debtorUser, description) {
    try {
        await supabaseClient.from('requests').update({ status: 'paid', amount: partialAmount, description: `${description} (Partial Paid)` }).eq('id', id);
        const remainder = Math.round((Number(totalAmount) - Number(partialAmount)) * 100) / 100;
        await supabaseClient.from('requests').insert([{ from_user: myUsername, to_user: debtorUser, amount: remainder, description: `${description} (Remaining Balance)`, status: 'pending' }]);
        await supabaseClient.from('notifications').insert([{ to_user: debtorUser, message: `⚖️ @${myUsername} accepted partial payment. Remaining: $${remainder.toFixed(2)}` }]);
        
        loadRequests(false); 
        showToast("Partial split accepted!", "success");
    } catch(e) { 
        showToast("Failed to accept split.", "error"); 
        console.error(e);
    }
}

// --- 管理員操作 ---
async function adminOverrideAmount(id, currentAmount, fromUser, toUser) {
    const newAmountStr = await showIOSModal({
        title: "Admin Override",
        message: `Editing bill between @${fromUser} & @${toUser}\nEnter new amount ($):`,
        type: 'prompt',
        defaultValue: currentAmount
    });
    if (newAmountStr === null) return; 
    
    const newAmount = parseFloat(newAmountStr);
    if (isNaN(newAmount) || newAmount < 0) { showToast("Invalid amount.", "error"); return; }
    
    try {
        await supabaseClient.from('requests').update({ amount: newAmount }).eq('id', id);
        await supabaseClient.from('notifications').insert([
            { to_user: fromUser, message: `🔧 Admin adjusted bill to $${newAmount}` },
            { to_user: toUser, message: `🔧 Admin adjusted bill to $${newAmount}` }
        ]);
        loadRequests(false); 
        showToast("Amount updated.", "success");
    } catch (e) { 
        showToast("Action failed.", "error"); 
        console.error(e);
    }
}

async function adminForceAccept(id, fromUser, toUser) {
    const confirmed = await showIOSModal({
        title: "Force Accept",
        message: `Force @${toUser} to ACCEPT the request from @${fromUser}?`,
        type: 'confirm'
    });
    if (!confirmed) return;
    try {
        await supabaseClient.from('requests').update({ status: 'approved' }).eq('id', id);
        await supabaseClient.from('notifications').insert([
            { to_user: fromUser, message: `⚡ [Admin] @${toUser} accepted your request.` },
            { to_user: toUser, message: `⚡ [Admin] Admin forced you to accept @${fromUser}'s request.` }
        ]);
        loadRequests(false); 
        showToast("Forced accept successful.", "success");
    } catch (e) { 
        showToast("Action failed.", "error"); 
    }
}

async function adminForcePaid(id, fromUser, toUser) {
    const confirmed = await showIOSModal({
        title: "Force Paid",
        message: `Force close this bill as PAID between @${fromUser} and @${toUser}?`,
        type: 'confirm'
    });
    if (!confirmed) return;
    try {
        await supabaseClient.from('requests').update({ status: 'paid' }).eq('id', id);
        await supabaseClient.from('notifications').insert([
            { to_user: fromUser, message: `⚡ [Admin] Your bill with @${toUser} was marked as PAID.` },
            { to_user: toUser, message: `⚡ [Admin] Your bill with @${fromUser} was marked as PAID.` }
        ]);
        loadRequests(false); 
        showToast("Forced paid successful.", "success");
    } catch (e) { 
        showToast("Action failed.", "error"); 
    }
}


// ==========================================
// 5. 系統通知與即時監聽 (Realtime & Notifications)
// ==========================================
async function requestNotificationPermission() {
    if ("Notification" in window) {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            showToast("Push notifications connected successfully!", "success");
            document.getElementById('enable-notif-btn').classList.add('hidden');
        } else { 
            showToast("Notification permission denied.", "error"); 
        }
    }
}

function updateNotificationButtonUI() {
    const btn = document.getElementById('enable-notif-btn');
    if ("Notification" in window && Notification.permission === "default") { 
        btn.classList.remove('hidden'); 
    } else { 
        btn.classList.add('hidden'); 
    }
}

function setupRealtime() {
    if (isRealtimeSubscribed) return;
    realtimeChannel = supabaseClient.channel('custom-db-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, (payload) => {
            if ((payload.new && payload.new.to_user === myUsername) || (payload.old && payload.old.to_user === myUsername)) {
                if (payload.eventType === 'INSERT') { showToast("🔔 " + payload.new.message, "info"); }
                loadNotifications();
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, async (payload) => {
            const record = payload.new || payload.old;
            if (isAdmin() || (record && (record.to_user === myUsername || record.from_user === myUsername))) {
                await loadRequests(false); 
                if (showingHistory) { await loadHistory(false); }
            }
        }).subscribe();
    isRealtimeSubscribed = true;
}

async function loadNotifications() {
    try {
        const { data, error } = await supabaseClient.from('notifications').select('*').eq('to_user', myUsername).order('created_at', { ascending: false }).limit(20);
        if (error) throw error;
        
        const notiDiv = document.getElementById('noti-list');
        if (!data || data.length === 0) { 
            notiDiv.innerHTML = "<p class='text-gray-400 italic text-center py-2'>No notifications.</p>"; 
            return; 
        }
        
        notiDiv.innerHTML = '';
        data.forEach(noti => {
            const item = document.createElement('div'); 
            item.className = 'noti-item text-gray-700 bg-white pl-3 pr-1 py-1.5 rounded-lg border border-gray-100 shadow-sm text-[11px] flex justify-between items-center gap-2 mt-1';
            item.innerHTML = `<div class="flex-1 leading-relaxed"><span class="text-[9px] text-gray-400 block mb-0.5">${formatDate(noti.created_at)}</span>${noti.message}</div><button onclick="deleteNotification('${noti.id}')" class="text-gray-300 hover:text-red-500 px-2 py-1 text-sm font-bold transition-colors">&times;</button>`; 
            notiDiv.appendChild(item);
        });
    } catch (e) {
        console.error("Failed to load notifications:", e);
    }
}

async function deleteNotification(id) { 
    try { 
        await supabaseClient.from('notifications').delete().eq('id', id); 
        await loadNotifications(); 
    } catch (e) {
        console.error("Failed to delete notification:", e);
    } 
}


// ==========================================
// 6. 銀行帳號與頭像外掛模組 (Bank & Avatar Plugin)
// ==========================================
let currentPaymentTargetId = null;
let currentPaymentTargetUser = null;

// 打開個人設定
async function openBankSetup() {
    document.getElementById('bank-setup-modal').classList.remove('hidden');
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('bank_code, bank_account, avatar_style, avatar_url')
            .eq('username', myUsername)
            .maybeSingle();
            
        if (data) {
            document.getElementById('my-bank-code').value = data.bank_code || '';
            document.getElementById('my-bank-account').value = data.bank_account || '';
            if (data.avatar_style) {
                document.getElementById('my-avatar-style').value = data.avatar_style;
            }
        }
    } catch (e) {
        console.error("Failed to load profile info:", e);
    }
}

function closeBankSetup() {
    document.getElementById('bank-setup-modal').classList.add('hidden');
}

// 儲存個人設定 (支援預設風格與上傳真實頭像)
async function saveBankInfo() {
    const code = document.getElementById('my-bank-code').value.trim();
    const account = document.getElementById('my-bank-account').value.trim();
    const avatarStyle = document.getElementById('my-avatar-style') ? document.getElementById('my-avatar-style').value : 'fun-emoji';
    const fileInput = document.getElementById('avatar-file-input');
    
    try {
        let publicUrl = null;

        // 如果使用者有選擇上傳新圖片
        if (fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileExt = file.name.split('.').pop();
            const fileName = `${myUsername}-${Date.now()}.${fileExt}`;
            
            // 上傳至 Supabase Storage 的 avatars 桶
            const { error: uploadError } = await supabaseClient.storage
                .from('avatars')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            // 取得公開網址
            const { data: urlData } = supabaseClient.storage
                .from('avatars')
                .getPublicUrl(fileName);
                
            publicUrl = urlData.publicUrl;
        }

        // 準備要更新的資料物件
        const updateData = { 
            bank_code: code, 
            bank_account: account, 
            avatar_style: avatarStyle 
        };
        
        // 只有在確實上傳了新圖片時，才更新 avatar_url 欄位
        if (publicUrl) {
            updateData.avatar_url = publicUrl;
        }

        const { error } = await supabaseClient
            .from('profiles')
            .update(updateData)
            .eq('username', myUsername);
            
        if (error) throw error;
        showToast("Profile saved successfully!", "success");
        
        // 即時更新畫面上的大頭貼
        const { data: updatedProfile } = await supabaseClient
            .from('profiles')
            .select('avatar_style, avatar_url')
            .eq('username', myUsername)
            .maybeSingle();
            
        const avatarImg = document.getElementById('my-avatar-img');
        if(avatarImg) avatarImg.src = getAvatarDisplay(updatedProfile, myUsername);
        
        closeBankSetup();
    } catch (e) {
        showToast("Failed to save profile.", "error");
        console.error(e);
    }
}

// 準備付款：打開付款資訊彈窗並撈取對方銀行資料
async function initiatePayment(requestId, targetUsername) {
    currentPaymentTargetId = requestId;
    currentPaymentTargetUser = targetUsername;
    
    document.getElementById('pay-target-name').innerText = `@${targetUsername}`;
    document.getElementById('payment-info-modal').classList.remove('hidden');
    
    const infoDisplay = document.getElementById('bank-info-display');
    const noInfoDisplay = document.getElementById('no-bank-info');
    
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('bank_code, bank_account')
            .eq('username', targetUsername)
            .maybeSingle();
            
        if (data && data.bank_code && data.bank_account) {
            document.getElementById('display-bank-code').innerText = data.bank_code;
            document.getElementById('display-bank-account').innerText = data.bank_account;
            infoDisplay.classList.remove('hidden');
            noInfoDisplay.classList.add('hidden');
        } else {
            infoDisplay.classList.add('hidden');
            noInfoDisplay.classList.remove('hidden');
        }
        
        const confirmBtn = document.getElementById('confirm-transfer-btn');
        confirmBtn.onclick = () => {
            updateStatus(currentPaymentTargetId, 'payment_submitted', currentPaymentTargetUser, 'marked paid. Verify.');
            closePaymentInfo();
        };
        
    } catch (e) {
        console.error("Failed to fetch target bank info:", e);
        showToast("Could not load bank info.", "error");
    }
}

function closePaymentInfo() {
    document.getElementById('payment-info-modal').classList.add('hidden');
    currentPaymentTargetId = null;
    currentPaymentTargetUser = null;
}

// 一鍵複製到剪貼簿功能
function copyBankInfo() {
    const code = document.getElementById('display-bank-code').innerText;
    const account = document.getElementById('display-bank-account').innerText;
    const textToCopy = `${code}-${account}`;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        showToast("Copied to clipboard! 📋", "success");
    }).catch(err => {
        console.error("Clipboard copy failed:", err);
        showToast("Failed to copy. Please copy manually.", "error");
    });
}
