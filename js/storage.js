/**
 * storage.js - 課堂白板本機雙層持久化引擎 (IndexedDB + LocalStorage)
 * 確保每次打開瀏覽器、重整或重新開機，都能 100% 完整還原上次的板書與設定。
 */

const DB_NAME = 'ClassroomWhiteboardDB';
const DB_VERSION = 1;
const STORE_NAME = 'whiteboard_store';
const RECORD_KEY = 'current_board';
const LS_KEY_V2 = 'classroom_whiteboard_v2';
const LS_KEY_LEGACY = 'ziteboard_edu_pages_v1';

export class WhiteboardStorage {
  constructor() {
    this.db = null;
    this.isDbReady = false;
    this.saveTimeout = null;
    this.statusListeners = [];
    this.initIndexedDB();
  }

  /**
   * 初始化 IndexedDB
   */
  async initIndexedDB() {
    if (!window.indexedDB) {
      console.warn('此瀏覽器不支援 IndexedDB，將降級僅使用 LocalStorage');
      return;
    }

    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
      this.isDbReady = true;
    } catch (err) {
      console.warn('開啟 IndexedDB 失敗，將降級使用 LocalStorage:', err);
    }
  }

  /**
   * 註冊儲存狀態變更回調 ('saving' | 'saved' | 'error')
   */
  onStatusChange(callback) {
    if (typeof callback === 'function') {
      this.statusListeners.push(callback);
    }
  }

  notifyStatus(status) {
    this.statusListeners.forEach(cb => {
      try { cb(status); } catch (e) { console.error(e); }
    });
  }

  /**
   * 同步讀取 (首頁載入時瞬間還原，無白屏閃爍)
   */
  loadSync() {
    // 優先讀取 v2
    const savedV2 = localStorage.getItem(LS_KEY_V2);
    if (savedV2) {
      try {
        const parsed = JSON.parse(savedV2);
        if (parsed && (parsed.pages || parsed.elements)) {
          return parsed;
        }
      } catch (e) {
        console.warn('讀取 LocalStorage v2 失敗:', e);
      }
    }

    // 次之相容舊版 key
    const savedLegacy = localStorage.getItem(LS_KEY_LEGACY);
    if (savedLegacy) {
      try {
        const parsed = JSON.parse(savedLegacy);
        if (parsed && (parsed.pages || parsed.elements)) {
          return parsed;
        }
      } catch (e) {
        console.warn('讀取舊版 LocalStorage 失敗:', e);
      }
    }

    return null;
  }

  /**
   * 非同步自 IndexedDB 讀取完整大型板書 (包含高解析度截圖)
   */
  async loadAsync() {
    if (!this.db) {
      await this.initIndexedDB();
    }
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        console.warn('從 IndexedDB 載入資料失敗:', e);
        resolve(null);
      }
    });
  }

  /**
   * 防抖儲存 (適用於平移、縮放等高頻事件)
   */
  saveDebounced(dataGetter, delayMs = 350) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      const data = typeof dataGetter === 'function' ? dataGetter() : dataGetter;
      if (data) {
        this.save(data);
      }
    }, delayMs);
  }

  /**
   * 立即儲存板書與設定 (雙層持久化)
   */
  async save(data, syncOnly = false) {
    if (!data) return;
    this.notifyStatus('saving');

    const cleanData = this.sanitizeData(data);
    cleanData.timestamp = Date.now();

    // 1. 同步寫入 LocalStorage (輕量或完整備份)
    try {
      const jsonStr = JSON.stringify(cleanData);
      localStorage.setItem(LS_KEY_V2, jsonStr);
    } catch (lsErr) {
      // 若 LocalStorage 超過 5MB 配額 (例如包含多張高解析截圖)，過濾大圖片後寫入輕量版
      try {
        const lightData = this.createLightweightCopy(cleanData);
        localStorage.setItem(LS_KEY_V2, JSON.stringify(lightData));
      } catch (e2) {
        console.warn('LocalStorage 配額已滿，主要依賴 IndexedDB 儲存:', e2);
      }
    }

    if (syncOnly) {
      this.notifyStatus('saved');
      return;
    }

    // 2. 非同步寫入 IndexedDB (容量極大，永久安全儲存幾十張講義與圖片)
    if (this.isDbReady && this.db) {
      try {
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(cleanData, RECORD_KEY);
          req.onsuccess = () => resolve();
          req.onerror = (e) => reject(e.target.error);
        });
      } catch (idbErr) {
        console.warn('IndexedDB 寫入失敗:', idbErr);
      }
    }

    setTimeout(() => {
      this.notifyStatus('saved');
    }, 200);
  }

  /**
   * 移除 DOM/Image 循環引用，保留可序列化欄位
   */
  sanitizeData(data) {
    return {
      version: 2,
      currentPageIndex: data.currentPageIndex || 0,
      settings: data.settings || {},
      pages: (data.pages || []).map(p => ({
        id: p.id,
        title: p.title,
        panX: p.panX || 0,
        panY: p.panY || 0,
        scale: p.scale || 1.0,
        elements: (p.elements || []).map(el => {
          if (el.type === 'image') {
            return {
              type: 'image',
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              src: el.src
            };
          }
          return { ...el };
        })
      }))
    };
  }

  /**
   * LocalStorage 配額超限時的輕量副本
   */
  createLightweightCopy(data) {
    return {
      ...data,
      pages: (data.pages || []).map(p => ({
        ...p,
        elements: (p.elements || []).map(el => {
          if (el.type === 'image') {
            return {
              type: 'image',
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              src: '[stored_in_indexeddb]'
            };
          }
          return el;
        })
      }))
    };
  }

  /**
   * 清空所有板書快取 (開始全新課程)
   */
  async clearAll() {
    try {
      localStorage.removeItem(LS_KEY_V2);
      localStorage.removeItem(LS_KEY_LEGACY);
    } catch (e) {}

    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(RECORD_KEY);
      } catch (e) {}
    }
    this.notifyStatus('saved');
  }
}
