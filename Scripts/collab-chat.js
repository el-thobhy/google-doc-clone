/**
 * Collaborative Chat - SignalR Live Chat Integration
 *
 * Library reusable untuk menambahkan live chat antar user
 * yang terhubung di dokumen yang sama via SignalR.
 *
 * Dependencies:
 *   - jQuery
 *   - jquery.signalR (SignalR JS client)
 *   - /signalr/hubs (auto-generated SignalR proxy)
 *   - SignalR hub harus punya method: SendChatMessage(documentId, userName, message)
 *   - SignalR hub harus broadcast: ReceiveChatMessage(userName, message, time)
 *
 * ============================================================
 * HTML YANG DIBUTUHKAN:
 * ============================================================
 *
 *   <!-- Chat Toggle Button -->
 *   <button class="chat-toggle-btn" id="chatToggleBtn" title="Chat">
 *       💬
 *       <span class="chat-badge" id="chatBadge">0</span>
 *   </button>
 *
 *   <!-- Chat Panel -->
 *   <div class="chat-panel" id="chatPanel">
 *       <div class="chat-header">
 *           <span>💬 Chat</span>
 *           <button class="chat-close" id="chatCloseBtn">&times;</button>
 *       </div>
 *       <div class="chat-messages" id="chatMessages"></div>
 *       <div class="chat-input-area">
 *           <input type="text" id="chatInput" placeholder="Ketik pesan..." autocomplete="off" />
 *           <button id="chatSendBtn">➤</button>
 *       </div>
 *   </div>
 *
 * ============================================================
 * CARA PAKAI:
 * ============================================================
 *
 *   CollabChat.init({
 *       userName: 'Budi',
 *       documentId: 'doc-123',
 *       // Optional: custom element IDs
 *       toggleBtnId: 'chatToggleBtn',
 *       panelId: 'chatPanel',
 *       closeBtnId: 'chatCloseBtn',
 *       messagesId: 'chatMessages',
 *       inputId: 'chatInput',
 *       sendBtnId: 'chatSendBtn',
 *       badgeId: 'chatBadge',
 *       // Optional: custom colors
 *       colors: [...],
 *       // Optional: callbacks
 *       onMessageReceived: function(sender, message, time) {},
 *       onChatOpened: function() {},
 *       onChatClosed: function() {}
 *   });
 */

var CollabChat = (function ($) {
    'use strict';

    // === PRIVATE STATE ===
    var _config = {};
    var _hub = null;
    var _chatOpen = false;
    var _unreadCount = 0;
    var _userColorMap = {};
    var _nextColorIndex = 0;
    var _initialized = false;

    // === DEFAULT OPTIONS ===
    var _defaults = {
        userName: 'Anonymous',
        documentId: 'default',
        // Element IDs
        toggleBtnId: 'chatToggleBtn',
        panelId: 'chatPanel',
        closeBtnId: 'chatCloseBtn',
        messagesId: 'chatMessages',
        inputId: 'chatInput',
        sendBtnId: 'chatSendBtn',
        badgeId: 'chatBadge',
        // Warna balon chat per user (incoming)
        colors: [
            { bg: '#e3f2fd', text: '#1565c0', sender: '#1565c0' },
            { bg: '#fce4ec', text: '#c62828', sender: '#c62828' },
            { bg: '#e8f5e9', text: '#2e7d32', sender: '#2e7d32' },
            { bg: '#fff3e0', text: '#e65100', sender: '#e65100' },
            { bg: '#f3e5f5', text: '#6a1b9a', sender: '#6a1b9a' },
            { bg: '#e0f7fa', text: '#00695c', sender: '#00695c' },
            { bg: '#fbe9e7', text: '#bf360c', sender: '#bf360c' },
            { bg: '#ede7f6', text: '#4527a0', sender: '#4527a0' }
        ],
        // Callbacks
        onMessageReceived: null,
        onChatOpened: null,
        onChatClosed: null
    };

    // === PRIVATE METHODS ===

    function _getUserColor(sender) {
        if (!_userColorMap[sender]) {
            _userColorMap[sender] = _config.colors[_nextColorIndex % _config.colors.length];
            _nextColorIndex++;
        }
        return _userColorMap[sender];
    }

    function _escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function _appendMessage(sender, message, time, isOwn) {
        var container = document.getElementById(_config.messagesId);
        if (!container) return;

        var msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg ' + (isOwn ? 'outgoing' : 'incoming');

        if (!isOwn) {
            var color = _getUserColor(sender);
            msgDiv.style.background = color.bg;
            msgDiv.style.color = color.text;
        }

        var senderHtml = isOwn ? '' : '<div class="msg-sender" style="color:' + _getUserColor(sender).sender + '">' + _escapeHtml(sender) + '</div>';
        msgDiv.innerHTML = senderHtml +
            '<div class="msg-text">' + _escapeHtml(message) + '</div>' +
            '<div class="msg-time">' + time + '</div>';

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    function _sendMessage() {
        var input = document.getElementById(_config.inputId);
        if (!input) return;

        var message = input.value.trim();
        if (!message) return;

        _hub.server.sendChatMessage(_config.documentId, _config.userName, message);
        input.value = '';
        input.focus();
    }

    function _toggleChat() {
        _chatOpen = !_chatOpen;
        var panel = document.getElementById(_config.panelId);
        if (panel) {
            panel.classList.toggle('open', _chatOpen);
        }

        if (_chatOpen) {
            _unreadCount = 0;
            var badge = document.getElementById(_config.badgeId);
            if (badge) badge.style.display = 'none';

            var input = document.getElementById(_config.inputId);
            if (input) input.focus();

            if (typeof _config.onChatOpened === 'function') {
                _config.onChatOpened();
            }
        } else {
            if (typeof _config.onChatClosed === 'function') {
                _config.onChatClosed();
            }
        }
    }

    function _closeChat() {
        _chatOpen = false;
        var panel = document.getElementById(_config.panelId);
        if (panel) panel.classList.remove('open');

        if (typeof _config.onChatClosed === 'function') {
            _config.onChatClosed();
        }
    }

    function _registerHubHandler() {
        _hub.client.receiveChatMessage = function (sender, message, time) {
            var isOwn = sender === _config.userName;
            _appendMessage(sender, message, time, isOwn);

            // Badge untuk unread
            if (!_chatOpen && !isOwn) {
                _unreadCount++;
                var badge = document.getElementById(_config.badgeId);
                if (badge) {
                    badge.textContent = _unreadCount;
                    badge.style.display = 'flex';
                }
            }

            // Callback
            if (typeof _config.onMessageReceived === 'function') {
                _config.onMessageReceived(sender, message, time);
            }
        };
    }

    function _bindUIEvents() {
        var toggleBtn = document.getElementById(_config.toggleBtnId);
        var closeBtn = document.getElementById(_config.closeBtnId);
        var sendBtn = document.getElementById(_config.sendBtnId);
        var input = document.getElementById(_config.inputId);

        if (toggleBtn) {
            toggleBtn.addEventListener('click', _toggleChat);
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', _closeChat);
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', _sendMessage);
        }

        if (input) {
            input.addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    _sendMessage();
                }
            });
        }
    }

    // === PUBLIC API ===
    return {
        /**
         * Inisialisasi chat.
         * Panggil SEBELUM $.connection.hub.start() atau setelah hub sudah connected.
         *
         * @param {Object} options - Konfigurasi
         */
        init: function (options) {
            _config = $.extend({}, _defaults, options);

            if (!$ || !$.connection || !$.connection.documentHub) {
                console.error('[CollabChat] SignalR hub proxy not available.');
                return;
            }

            _hub = $.connection.documentHub;
            _registerHubHandler();
            _bindUIEvents();
            _initialized = true;

            console.log('[CollabChat] Initialized | Document: ' + _config.documentId + ' | User: ' + _config.userName);
        },

        /**
         * Kirim pesan secara programmatic
         * @param {string} message - Pesan yang akan dikirim
         */
        send: function (message) {
            if (!_initialized || !message) return;
            _hub.server.sendChatMessage(_config.documentId, _config.userName, message);
        },

        /**
         * Buka chat panel
         */
        open: function () {
            if (!_chatOpen) _toggleChat();
        },

        /**
         * Tutup chat panel
         */
        close: function () {
            if (_chatOpen) _closeChat();
        },

        /**
         * Cek apakah chat sedang terbuka
         * @returns {boolean}
         */
        isOpen: function () {
            return _chatOpen;
        },

        /**
         * Ambil jumlah unread messages
         * @returns {number}
         */
        getUnreadCount: function () {
            return _unreadCount;
        },

        /**
         * Clear semua pesan di chat
         */
        clearMessages: function () {
            var container = document.getElementById(_config.messagesId);
            if (container) container.innerHTML = '';
        },

        /**
         * Tambah pesan system (notifikasi)
         * @param {string} message - Pesan system
         */
        addSystemMessage: function (message) {
            var container = document.getElementById(_config.messagesId);
            if (!container) return;

            var msgDiv = document.createElement('div');
            msgDiv.className = 'chat-system-msg';
            msgDiv.textContent = message;
            container.appendChild(msgDiv);
            container.scrollTop = container.scrollHeight;
        }
    };

})(jQuery);
