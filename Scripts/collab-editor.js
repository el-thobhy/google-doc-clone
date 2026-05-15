/**
 * Collaborative Editor - SignalR + diff-match-patch Integration
 * 
 * Library reusable untuk menambahkan real-time collaboration ke TinyMCE editor
 * yang SUDAH diinisialisasi dengan config sendiri.
 *
 * Dependencies:
 *   - jQuery
 *   - jquery.signalR (SignalR JS client)
 *   - /signalr/hubs (auto-generated SignalR proxy)
 *   - diff_match_patch.js
 *   - TinyMCE (sudah diinisialisasi)
 *
 * ============================================================
 * CARA PAKAI:
 * ============================================================
 * 
 * 1. Inisialisasi TinyMCE seperti biasa dengan config kamu sendiri.
 * 2. Di dalam setup > editor.on('init'), panggil CollabEditor.attach()
 *
 * Contoh:
 *
 *   tinymce.init({
 *       selector: '.textarea-editor',
 *       plugins: '...',
 *       toolbar: '...',
 *       setup: function(editor) {
 *           // ... custom buttons, shortcuts, dll ...
 *
 *           editor.on('init', function() {
 *               // Attach collaboration setelah editor ready
 *               CollabEditor.attach(editor, {
 *                   userName: 'Budi',
 *                   documentId: 'doc-123',
 *                   debounceMs: 300,
 *                   reconnectDelayMs: 5000,
 *                   onUserListChanged: function(users) { },
 *                   onConnectionChanged: function(connected) { },
 *                   onRemoteEdit: function(fromUser) { },
 *                   onLocalEdit: function() { }
 *               });
 *           });
 *       }
 *   });
 *
 * ============================================================
 * PUBLIC API:
 * ============================================================
 * 
 *   CollabEditor.attach(editor, options)  - Attach collaboration ke editor
 *   CollabEditor.detach()                 - Lepas collaboration & disconnect
 *   CollabEditor.getContent()             - Ambil konten editor
 *   CollabEditor.setContent(html)         - Set konten & broadcast ke user lain
 *   CollabEditor.disconnect()             - Putus koneksi SignalR
 *   CollabEditor.reconnect()              - Sambung ulang SignalR
 *   CollabEditor.isConnected()            - Cek status koneksi
 *   CollabEditor.isReady()                - Cek apakah sudah attached & ready
 *   CollabEditor.sendChanges()            - Force kirim perubahan sekarang
 */

var CollabEditor = (function ($) {
    'use strict';

    // === PRIVATE STATE ===
    var _config = {};
    var _dmp = null;
    var _hub = null;
    var _editor = null;
    var _lastContent = '';
    var _isRemoteUpdate = false;
    var _attached = false;
    var _debounceTimer = null;
    var _boundHandlers = {};

    // === DEFAULT OPTIONS ===
    var _defaults = {
        userName: 'Anonymous',
        documentId: 'default',
        debounceMs: 300,
        reconnectDelayMs: 5000,
        onUserListChanged: null,
        onConnectionChanged: null,
        onRemoteEdit: null,
        onLocalEdit: null
    };

    // === PRIVATE METHODS ===

    function _initDiffMatchPatch() {
        if (typeof diff_match_patch === 'undefined') {
            console.error('[CollabEditor] diff_match_patch library not loaded.');
            return false;
        }
        _dmp = new diff_match_patch();
        return true;
    }

    function _initSignalRHub() {
        if (!$ || !$.connection || !$.connection.documentHub) {
            console.error('[CollabEditor] SignalR hub proxy not available. Pastikan jquery.signalR dan /signalr/hubs sudah di-load.');
            return false;
        }
        _hub = $.connection.documentHub;
        _registerHubHandlers();
        return true;
    }

    function _registerHubHandlers() {
        // Menerima patch dari user lain
        _hub.client.receivePatch = function (patchText, fromUser) {
            if (!_attached || !_editor) return;

            try {
                var currentContent = _editor.getContent();

                var patches = _dmp.patch_fromText(patchText);
                var result = _dmp.patch_apply(patches, currentContent);
                var newContent = result[0];
                var success = result[1];

                var allSuccess = success.every(function (s) { return s; });

                if (allSuccess && newContent !== currentContent) {
                    // Simpan posisi cursor
                    var bookmark = _editor.selection.getBookmark(2, true);

                    _isRemoteUpdate = true;
                    _editor.setContent(newContent);
                    _lastContent = newContent;

                    // Restore posisi cursor
                    try {
                        _editor.selection.moveToBookmark(bookmark);
                    } catch (e) { }

                    _isRemoteUpdate = false;

                    if (typeof _config.onRemoteEdit === 'function') {
                        _config.onRemoteEdit(fromUser);
                    }
                } else if (!allSuccess) {
                    console.warn('[CollabEditor] Patch apply gagal, requesting full sync...');
                }
            } catch (e) {
                console.error('[CollabEditor] Error applying patch:', e);
            }
        };

        // Menerima full content (saat join atau fallback)
        _hub.client.receiveFullContent = function (content) {
            if (!_attached || !_editor) return;

            _isRemoteUpdate = true;
            _editor.setContent(content || '');
            _lastContent = content || '';
            _isRemoteUpdate = false;
        };

        // Update daftar user online
        _hub.client.updateUserList = function (users) {
            if (typeof _config.onUserListChanged === 'function') {
                _config.onUserListChanged(users);
            }
        };
    }

    function _startConnection() {
        $.connection.hub.start().done(function () {
            _hub.server.joinDocument(_config.documentId, _config.userName);
            _fireConnectionChanged(true);
        }).fail(function (err) {
            console.error('[CollabEditor] SignalR connection failed:', err);
            _fireConnectionChanged(false);
        });

        $.connection.hub.disconnected(function () {
            _fireConnectionChanged(false);
            // Auto-reconnect
            setTimeout(function () {
                if (_attached) {
                    $.connection.hub.start().done(function () {
                        _hub.server.joinDocument(_config.documentId, _config.userName);
                        _fireConnectionChanged(true);
                    });
                }
            }, _config.reconnectDelayMs);
        });
    }

    function _fireConnectionChanged(connected) {
        if (typeof _config.onConnectionChanged === 'function') {
            _config.onConnectionChanged(connected);
        }
    }

    function _debounceSendChanges() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
        }
        _debounceTimer = setTimeout(function () {
            _sendChanges();
        }, _config.debounceMs);
    }

    function _sendChanges() {
        if (!_attached || !_editor) return;

        var currentContent = _editor.getContent();

        if (currentContent === _lastContent) return;

        // Buat diff/patch
        var diffs = _dmp.diff_main(_lastContent, currentContent);
        _dmp.diff_cleanupEfficiency(diffs);
        var patches = _dmp.patch_make(_lastContent, diffs);
        var patchText = _dmp.patch_toText(patches);

        if (patchText) {
            _hub.server.sendPatch(_config.documentId, patchText, _config.userName);
            _hub.server.updateServerContent(_config.documentId, currentContent);
        }

        _lastContent = currentContent;

        if (typeof _config.onLocalEdit === 'function') {
            _config.onLocalEdit();
        }
    }

    function _bindEditorEvents() {
        // Handler untuk deteksi perubahan
        _boundHandlers.onInput = function () {
            if (!_isRemoteUpdate) _debounceSendChanges();
        };
        _boundHandlers.onChange = function () {
            if (!_isRemoteUpdate) _debounceSendChanges();
        };
        _boundHandlers.onKeyup = function () {
            if (!_isRemoteUpdate) _debounceSendChanges();
        };

        _editor.on('input', _boundHandlers.onInput);
        _editor.on('change', _boundHandlers.onChange);
        _editor.on('keyup', _boundHandlers.onKeyup);
    }

    function _unbindEditorEvents() {
        if (_editor && _boundHandlers.onInput) {
            _editor.off('input', _boundHandlers.onInput);
            _editor.off('change', _boundHandlers.onChange);
            _editor.off('keyup', _boundHandlers.onKeyup);
        }
        _boundHandlers = {};
    }

    // === PUBLIC API ===
    return {
        /**
         * Attach collaboration ke TinyMCE editor yang sudah diinisialisasi.
         * Panggil ini di dalam editor.on('init', ...) callback.
         *
         * @param {Object} editor - Instance TinyMCE editor
         * @param {Object} options - Konfigurasi collaboration
         * @param {string} options.userName - Nama user
         * @param {string} options.documentId - ID dokumen untuk collaboration
         * @param {number} [options.debounceMs=300] - Debounce delay (ms)
         * @param {number} [options.reconnectDelayMs=5000] - Reconnect delay (ms)
         * @param {function} [options.onUserListChanged] - Callback saat user list berubah
         * @param {function} [options.onConnectionChanged] - Callback saat koneksi berubah
         * @param {function} [options.onRemoteEdit] - Callback saat ada edit dari user lain
         * @param {function} [options.onLocalEdit] - Callback saat user lokal mengedit
         */
        attach: function (editor, options) {
            if (!editor) {
                console.error('[CollabEditor] Editor instance is required.');
                return;
            }

            _config = $.extend({}, _defaults, options);
            _editor = editor;

            if (!_initDiffMatchPatch()) return;
            if (!_initSignalRHub()) return;

            // Simpan konten awal
            _lastContent = _editor.getContent();

            // Bind event listeners ke editor
            _bindEditorEvents();

            _attached = true;

            // Mulai koneksi SignalR
            _startConnection();

            console.log('[CollabEditor] Attached to editor "' + _editor.id + '" | Document: ' + _config.documentId + ' | User: ' + _config.userName);
        },

        /**
         * Lepas collaboration dari editor & disconnect SignalR
         */
        detach: function () {
            _unbindEditorEvents();

            if ($.connection && $.connection.hub) {
                $.connection.hub.stop();
            }

            _editor = null;
            _attached = false;
            _lastContent = '';
            _isRemoteUpdate = false;

            console.log('[CollabEditor] Detached.');
        },

        /**
         * Mendapatkan konten editor saat ini
         * @returns {string}
         */
        getContent: function () {
            if (!_attached || !_editor) return '';
            return _editor.getContent();
        },

        /**
         * Set konten editor (akan di-broadcast ke user lain)
         * @param {string} content - HTML content
         */
        setContent: function (content) {
            if (!_attached || !_editor) return;
            _isRemoteUpdate = true;
            _editor.setContent(content);
            _lastContent = content;
            _isRemoteUpdate = false;
            _hub.server.sendFullContent(_config.documentId, content, _config.userName);
        },

        /**
         * Force kirim perubahan sekarang (tanpa debounce)
         */
        sendChanges: function () {
            _sendChanges();
        },

        /**
         * Disconnect dari SignalR
         */
        disconnect: function () {
            if ($.connection && $.connection.hub) {
                $.connection.hub.stop();
            }
        },

        /**
         * Reconnect ke SignalR
         */
        reconnect: function () {
            _startConnection();
        },

        /**
         * Cek status koneksi
         * @returns {boolean}
         */
        isConnected: function () {
            return $.connection.hub && $.connection.hub.state === $.signalR.connectionState.connected;
        },

        /**
         * Cek apakah sudah attached & ready
         * @returns {boolean}
         */
        isReady: function () {
            return _attached;
        }
    };

})(jQuery);
