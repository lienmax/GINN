/**
 * Expense Splitter & Requester - AI Receipt Splitter Plugin
 * 特性：純 Vanilla JS、Canvas 768px 圖片壓縮、Penny Drop 餘數發起人吸收、iOS 原生體感
 */

(function () {
    // 1. 建立 HTML 結構 (不破壞原 HTML，採用動態 DOM 注入)
    const injectStylesAndElements = () => {
        // 注入專屬的 iOS 鍵盤彈出防滅頂媒體查詢與動畫
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
            .animate-slide-up { animation: slideUp 0.3s cubic-bezier(0.1, 0.76, 0.55, 0.94) forwards; }
            @media screen and (max-height: 550px) {
                #ai-ocr-drawer { max-height: 92vh !important; padding-bottom: 1.5rem !important; }
                #scanned-items-container { max-height: 42vh !important; overflow-y: auto; }
            }
        `;
        document.head.appendChild(style);

        // 建立相機按鈕與磨砂玻璃 Modal
        const container = document.createElement('div');
        container.id = "ai-splitter-plugin-root";
        container.innerHTML = `
            <input type="file" id="ai-camera-input" accept="image/*" capture="environment" class="hidden">

            <button id="ai-btn-scan" class="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-500 text-white rounded-full shadow-xl flex items-center justify-center active:scale-90 transition-transform z-[999]">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
            </button>

            <div id="ai-ocr-modal" class="fixed inset-0 bg-black/40 backdrop-blur-md z-[1001] flex items-end justify-center hidden opacity-0 transition-opacity duration-300">
                <div id="ai-ocr-drawer" class="bg-white w-full max-h-[85vh] rounded-t-2xl p-5 overflow-y-auto pb-8 shadow-2xl transform translate-y-full transition-transform duration-300 max-w-md">
                    <div class="flex justify-between items-center mb-4 border-b pb-3">
                        <div>
                            <h3 class="text-lg font-bold text-gray-900">AI Receipt Splitter</h3>
                            <p class="text-[11px] text-gray-400 font-medium">Tap item first, then tap friends to toggle split.</p>
                        </div>
                        <button id="ai-close-modal" class="text-gray-400 hover:text-gray-6xl font-semibold text-2xl px-2 active:scale-90 transition-transform">&times;</button>
                    </div>

                    <div id="ai-ocr-skeleton" class="space-y-4 hidden">
                        <div class="h-4 bg-gray-200 rounded animate-pulse w-1/3"></div>
                        <div class="p-4 bg-gray-50 rounded-xl space-y-3">
                            <div class="h-4 bg-gray-200 rounded w-2/3 animate-pulse"></div>
                            <div class="h-3 bg-gray-100 rounded w-1/2 animate-pulse"></div>
                            <div class="flex gap-2"><div class="h-6 bg-gray-200 rounded-full w-12 animate-pulse"></div><div class="h-6 bg-gray-200 rounded-full w-12 animate-pulse"></div></div>
                        </div>
                        <div class="p-4 bg-gray-50 rounded-xl space-y-3">
                            <div class="h-4 bg-gray-200 rounded w-1/2 animate-pulse"></div>
                            <div class="flex gap-2"><div class="h-6 bg-gray-200 rounded-full w-12 animate-pulse"></div></div>
                        </div>
                    </div>

                    <div id="ai-ocr-content" class="space-y-4 hidden">
                        <div id="scanned-items-container" class="space-y-3 max-h-[50vh] overflow-y-auto pr-1 hide-scrollbar"></div>
                        
                        <button id="ai-btn-submit-split" class="w-full bg-blue-500 hover:bg-blue-600 active:scale-95 text-white py-3 rounded-xl font-semibold transition-all shadow-md mt-2">
                            Confirm & Post Split Bills
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);
    };

    // 2. 內部封裝狀態管理 (完全獨立，不污染全域變數)
    let receiptState = {
        items: [],       // 結構：{ id, item_name, amount }
        selectedItemId: null,
        assignments: {}  // 結構：itemId -> Set (儲存勾選的 usernames)
    };

    // 3. 初始化事件監聽
    const initEvents = () => {
        const btnScan = document.getElementById('ai-btn-scan');
        const cameraInput = document.getElementById('ai-camera-input');
        const ocrModal = document.getElementById('ai-ocr-modal');
        const ocrDrawer = document.getElementById('ai-ocr-drawer');
        const closeModal = document.getElementById('ai-close-modal');
        const btnSubmit = document.getElementById('ai-btn-submit-split');

        // 觀測登入狀態：只有在主畫面呈現時才顯示相機按鈕
        const observer = new MutationObserver(() => {
            const mainSection = document.getElementById('main-section');
            if (mainSection && !mainSection.classList.contains('hidden')) {
                btnScan.classList.remove('hidden');
            } else {
                btnScan.classList.add('hidden');
            }
        });
        observer.observe(document.getElementById('main-section'), { attributes: true, attributeFilter: ['class'] });

        // 喚起相機
        btnScan.addEventListener('click', () => cameraInput.click());

        // 監聽拍照/檔案選取
        cameraInput.addEventListener('change', async (e) => {
            if (!e.target.files.length) return;
            
            toggleModal(true);
            showLoading(true);

            try {
                const file = e.target.files[0];
                // 【精準優化】：前端進行 Canvas 點陣壓縮鎖定 768px 寬度，杜絕高額 Token 消耗
                const compressedBase64 = await compressImageTo768(file);
                
                // 呼叫 Edge Function 進行多模態 AI 語意解析
                const parsedItems = await requestAiOcrService(compressedBase64);
                
                // 初始化拆單狀態
                initSplitState(parsedItems);
                showLoading(false);
            } catch (error) {
                window.showToast("❌ AI parsing failed. Please retry.", "error");
                toggleModal(false);
            } finally {
                cameraInput.value = ''; // 清空以利下次觸發
            }
        });

        closeModal.addEventListener('click', () => toggleModal(false));
        btnSubmit.addEventListener('click', () => submitSplitBills());
    };

    // 4. 前端極致防爆 Token：Canvas 點陣縮放優化演算法
    const compressImageTo768 = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    const TARGET_WIDTH = 768; // 契合 OpenAI 圖片 Tile 切格黃金臨界點
                    const scale = TARGET_WIDTH / img.width;
                    canvas.width = TARGET_WIDTH;
                    canvas.height = img.height * scale;
                    
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.65)); // 壓縮率 0.65 兼顧清晰度與超小體積
                };
            };
        });
    };

    // 5. 核心 AI 串接代理 (不將金鑰與實作細節寫入前端，投遞至 Supabase Edge Function)
    const requestAiOcrService = async (base64Image) => {
        // 請確保您的 Supabase 專案中已部署對應的 'ai-receipt-ocr' Edge Function
        // 這裡可抽換成您的後端 API 節點
        const { data, error } = await window.supabaseClient.functions.invoke('ai-receipt-ocr', {
            body: { image: base64Image }
        });
        
        if (error || !data || !data.items) {
            throw new Error(error?.message || "Invalid AI Response");
        }
        
        // 預期回傳格式： [{ item_name: "Wagyu Beef", amount: 120.00 }, ...]
        return data.items.map((item, index) => ({
            id: `ai-item-${Date.now()}-${index}`,
            item_name: item.item_name,
            amount: Math.round(parseFloat(item.amount) * 100) / 100
        }));
    };

    // 6. 初始化拆單狀態
    const initSplitState = (items) => {
        receiptState.items = items;
        receiptState.selectedItemId = items[0]?.id || null;
        receiptState.assignments = {};
        
        items.forEach(item => {
            // 預設將當前登入者納入基本平攤分母
            receiptState.assignments[item.id] = new Set([window.myUsername]);
        });
        
        renderDrawerItems();
    };

    // 7. 渲染明細互動區域 (完全採用記憶體快取 DocumentFragment，防 Layout Shift 閃爍)
    const renderDrawerItems = () => {
        const container = document.getElementById('scanned-items-container');
        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        receiptState.items.forEach(item => {
            const isSelected = receiptState.selectedItemId === item.id;
            const assignedUsers = receiptState.assignments[item.id];
            
            // 金融級精準度：整數分 (Cents) 計算，防浮點數外溢
            const totalCents = Math.round(item.amount * 100);
            const count = assignedUsers.size;
            const perPersonAmount = count > 0 ? ((Math.floor(totalCents / count)) / 100).toFixed(2) : "0.00";

            const card = document.createElement('div');
            card.className = `p-3 rounded-xl border transition-all ${
                isSelected ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-400' : 'border-gray-100 bg-white shadow-sm'
            }`;
            
            card.addEventListener('click', () => {
                receiptState.selectedItemId = item.id;
                renderDrawerItems();
            });

            // 整合 ContentEditable 允許人為即時微調校正
            card.innerHTML = `
                <div class="flex justify-between items-center mb-2 gap-2">
                    <span contenteditable="true" data-field="name" data-id="${item.id}" 
                          class="font-medium text-gray-800 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 rounded transition-colors break-all text-sm">
                        ${item.item_name}
                    </span>
                    <div class="flex items-center gap-1 shrink-0">
                        <span class="text-gray-400 text-xs">$</span>
                        <span contenteditable="true" data-field="amount" data-id="${item.id}" 
                              class="font-semibold text-gray-900 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-1 rounded transition-colors text-right min-w-[45px] text-sm">
                            ${item.amount.toFixed(2)}
                        </span>
                        <button data-delete-id="${item.id}" class="text-gray-300 hover:text-red-500 font-bold p-1 transition-colors ml-1">&times;</button>
                    </div>
                </div>
                
                <div class="flex flex-wrap gap-1.5 mt-2">
                    ${[window.myUsername, ...Array.from(window.globalUniqueFriends)].map(user => {
                        const isUserSelected = assignedUsers.has(user);
                        return `
                            <span data-item-id="${item.id}" data-user="${user}" class="ai-friend-chip text-[11px] px-2.5 py-1 rounded-full border transition-all cursor-pointer select-none ${
                                isUserSelected 
                                    ? 'bg-blue-600 border-blue-600 text-white font-medium shadow-sm' 
                                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                            }">
                                @${user === window.myUsername ? 'me' : user}
                            </span>
                        `;
                    }).join('')}
                </div>

                ${isSelected && count > 0 ? `
                    <div class="text-[11px] text-blue-600 mt-2 font-medium bg-blue-100/40 px-2 py-0.5 rounded w-max">
                        Split: ~$${perPersonAmount} each (${count} ppl)
                    </div>
                ` : ''}
            `;

            // --- 綁定單卡內部細緻化事件監聽 (阻斷冒泡防止外層 Card 誤觸) ---
            // A. ContentEditable 即時數據同步
            card.querySelectorAll('[contenteditable]').forEach(el => {
                el.addEventListener('click', (e) => e.stopPropagation());
                el.addEventListener('blur', (e) => {
                    const field = e.target.getAttribute('data-field');
                    const id = e.target.getAttribute('data-id');
                    const targetItem = receiptState.items.find(i => i.id === id);
                    if (!targetItem) return;

                    if (field === 'name') {
                        targetItem.item_name = e.target.innerText.trim();
                    } else if (field === 'amount') {
                        const val = parseFloat(e.target.innerText) || 0;
                        targetItem.amount = Math.round(val * 100) / 100;
                        renderDrawerItems();
                    }
                });
            });

            // B. 刪除品項
            card.querySelector('[data-delete-id]').addEventListener('click', (e) => {
                e.stopPropagation();
                const id = e.target.getAttribute('data-delete-id');
                receiptState.items = receiptState.items.filter(i => i.id !== id);
                delete receiptState.assignments[id];
                if (receiptState.selectedItemId === id) {
                    receiptState.selectedItemId = receiptState.items[0]?.id || null;
                }
                renderDrawerItems();
            });

            // C. 朋友標籤即時變色切換 (0 延遲，不觸發網路請求)
            card.querySelectorAll('.ai-friend-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const itemId = chip.getAttribute('data-item-id');
                    const user = chip.getAttribute('data-user');
                    const set = receiptState.assignments[itemId];

                    if (set.has(user)) {
                        if (set.size > 1) set.delete(user); // 確保每筆帳單至少有人承擔
                    } else {
                        set.add(user);
                    }
                    renderDrawerItems();
                });
            });

            fragment.appendChild(card);
        });

        // 注入「手動兜底新增品項」按鈕
        const appendAddBtn = document.createElement('button');
        appendAddBtn.className = "w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:text-blue-500 hover:border-blue-300 transition-colors flex items-center justify-center gap-1 mt-1";
        appendAddBtn.innerHTML = `<span>➕ Add Custom Item</span>`;
        appendAddBtn.addEventListener('click', () => {
            const newId = `custom-item-${Date.now()}`;
            receiptState.items.push({ id: newId, item_name: "New Item", amount: 0.00 });
            receiptState.assignments[newId] = new Set([window.myUsername]);
            receiptState.selectedItemId = newId;
            renderDrawerItems();
        });
        fragment.appendChild(appendAddBtn);

        container.appendChild(fragment);
    };

    // 8. 核心金融計算：Penny Drop 餘數吸收與 Supabase 批次寫入
    const submitSplitBills = async () => {
        if (receiptState.items.length === 0) {
            window.showToast("No items to split.", "error");
            return;
        }

        const btnSubmit = document.getElementById('ai-btn-submit-split');
        btnSubmit.disabled = true;
        btnSubmit.innerText = "Posting Bills...";

        try {
            // 遍歷所有品項，計算每筆拆單
            for (const item of receiptState.items) {
                const assignedUsers = Array.from(receiptState.assignments[item.id]);
                const totalCents = Math.round(item.amount * 100);
                const count = assignedUsers.size;

                if (count === 0 || totalCents === 0) continue;

                const baseShareCents = Math.floor(totalCents / count);
                let remainderCents = totalCents % count;

                // 篩選出除自己以外的其他債務人
                const debtors = assignedUsers.filter(u => u !== window.myUsername);
                
                // 計算自己應該負擔的部分（含吸收 Penny Drop 餘數）
                let myShareCents = baseShareCents;
                if (assignedUsers.includes(window.myUsername)) {
                    myShareCents += remainderCents;
                    remainderCents = 0; // 餘數已被發起人完全吸收
                }

                // 批次寫入對應的債務人帳單至 Supabase
                for (const debtorUser of debtors) {
                    let finalDebtorCents = baseShareCents;
                    
                    // 萬一自己不在分攤名單內，餘數由第一個朋友遞補吸收
                    if (remainderCents > 0) {
                        finalDebtorCents += remainderCents;
                        remainderCents = 0;
                    }

                    const finalAmount = finalDebtorCents / 100;

                    // 對接主程式的 'requests' 與 'notifications' 資料表結構
                    await window.supabaseClient.from('requests').insert([{
                        from_user: window.myUsername,
                        to_user: debtorUser,
                        amount: finalAmount,
                        description: `[AI] ${item.item_name}`,
                        status: 'pending'
                    }]);

                    await window.supabaseClient.from('notifications').insert([{
                        to_user: debtorUser,
                        message: `💰 @${window.myUsername} requested $${finalAmount.toFixed(2)} for [${item.item_name}] via AI Robot`
                    }]);
                }
            }

            window.showToast("🚀 All split bills posted successfully!", "success");
            toggleModal(false);
            if (typeof window.loadRequests === 'function') window.loadRequests(false);
        } catch (error) {
            window.showToast("Failed to post some bills.", "error");
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerText = "Confirm & Post Split Bills";
        }
    };

    // UI 動態輔助控制
    const toggleModal = (show) => {
        const modal = document.getElementById('ai-ocr-modal');
        const drawer = document.getElementById('ai-ocr-drawer');
        if (show) {
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                drawer.classList.add('animate-slide-up');
            }, 10);
        } else {
            modal.classList.add('opacity-0');
            drawer.classList.remove('animate-slide-up');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }
    };

    const showLoading = (isLoading) => {
        document.getElementById('ai-ocr-skeleton').classList.toggle('hidden', !isLoading);
        document.getElementById('ai-ocr-content').classList.toggle('hidden', isLoading);
    };

    // 初始化掛載執行
    injectStylesAndElements();
    initEvents();
})();