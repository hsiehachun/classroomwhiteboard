/**
 * pages.js - 多頁板書分頁管理與本機持久化儲存 (Multi-page & Persistence)
 */

import { ShapeRenderer } from './shapes.js';
import { WhiteboardStorage } from './storage.js';

export class PageManager {
  constructor() {
    this.pages = [];
    this.currentPageIndex = 0;
    this.storage = new WhiteboardStorage();
    this.initialSettings = null;
    this.appSettingsGetter = null;
    this.onPageChange = null;

    this.initDefaultOrLoad();
  }

  initDefaultOrLoad() {
    const saved = this.storage.loadSync();
    if (saved && saved.pages && saved.pages.length > 0) {
      try {
        this.pages = saved.pages.map(p => ({
          id: p.id || Math.random().toString(36).substr(2, 9),
          title: p.title || '第 1 頁',
          elements: this.restoreElements(p.elements || []),
          undoStack: [],
          redoStack: [],
          panX: p.panX || 0,
          panY: p.panY || 0,
          scale: p.scale || 1.0
        }));
        this.currentPageIndex = Math.min(saved.currentPageIndex || 0, this.pages.length - 1);
        if (saved.settings) {
          this.initialSettings = saved.settings;
        }
        return;
      } catch (e) {
        console.warn('無法讀取歷史板書儲存，重設為預設狀態：', e);
      }
    }

    // 預設第 1 頁
    this.pages = [this.createNewPageData(1)];
    this.currentPageIndex = 0;
  }

  /**
   * 非同步從 IndexedDB 載入完整大圖與備份 (避免 LocalStorage 5MB 限制導致的缺失)
   */
  async hydrateFromIndexedDB() {
    try {
      const idbData = await this.storage.loadAsync();
      if (!idbData || !idbData.pages || idbData.pages.length === 0) return;

      let hasUpdate = false;
      idbData.pages.forEach((p, idx) => {
        if (this.pages[idx]) {
          p.elements?.forEach((el, elIdx) => {
            const curEl = this.pages[idx].elements[elIdx];
            if (curEl && curEl.type === 'image' && el.src && el.src !== '[stored_in_indexeddb]' && curEl.src !== el.src) {
              curEl.src = el.src;
              curEl.img = new Image();
              curEl.img.src = el.src;
              hasUpdate = true;
            }
          });
        } else {
          // 若 IndexedDB 擁有更多頁面，直接還原
          this.pages.push({
            id: p.id,
            title: p.title,
            elements: this.restoreElements(p.elements || []),
            undoStack: [],
            redoStack: [],
            panX: p.panX || 0,
            panY: p.panY || 0,
            scale: p.scale || 1.0
          });
          hasUpdate = true;
        }
      });

      if (hasUpdate && this.onPageChange) {
        this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
      }
    } catch (err) {
      console.warn('非同步還原板書時發生錯誤:', err);
    }
  }

  createNewPageData(index) {
    return {
      id: 'page_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title: `第 ${index} 頁`,
      elements: [],
      undoStack: [],
      redoStack: [],
      panX: 0,
      panY: 0,
      scale: 1.0
    };
  }

  getCurrentPage() {
    return this.pages[this.currentPageIndex];
  }

  getTotalPages() {
    return this.pages.length;
  }

  addPage() {
    const newPage = this.createNewPageData(this.pages.length + 1);
    this.pages.push(newPage);
    this.currentPageIndex = this.pages.length - 1;
    this.saveToLocalStorage();
    if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
    return newPage;
  }

  removeCurrentPage() {
    if (this.pages.length <= 1) {
      // 只有一頁時直接清空，不刪除頁面
      const page = this.getCurrentPage();
      page.elements = [];
      page.undoStack = [];
      page.redoStack = [];
      this.saveToLocalStorage();
      if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
      return false;
    }

    this.pages.splice(this.currentPageIndex, 1);
    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = this.pages.length - 1;
    }

    // 重新命名序號
    this.pages.forEach((p, idx) => {
      p.title = `第 ${idx + 1} 頁`;
    });

    this.saveToLocalStorage();
    if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
    return true;
  }

  nextPage() {
    if (this.currentPageIndex < this.pages.length - 1) {
      this.currentPageIndex++;
      this.saveToLocalStorage();
      if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
      return true;
    }
    return false;
  }

  prevPage() {
    if (this.currentPageIndex > 0) {
      this.currentPageIndex--;
      this.saveToLocalStorage();
      if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
      return true;
    }
    return false;
  }

  saveToLocalStorage(syncOnly = false) {
    try {
      const data = {
        currentPageIndex: this.currentPageIndex,
        settings: this.appSettingsGetter ? this.appSettingsGetter() : {},
        pages: this.pages.map(p => ({
          id: p.id,
          title: p.title,
          elements: p.elements.map(el => {
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
            return el;
          }),
          panX: p.panX,
          panY: p.panY,
          scale: p.scale
        }))
      };
      this.storage.save(data, syncOnly);
    } catch (e) {
      console.warn('板書儲存例外:', e);
    }
  }

  saveDebounced() {
    this.storage.saveDebounced(() => ({
      currentPageIndex: this.currentPageIndex,
      settings: this.appSettingsGetter ? this.appSettingsGetter() : {},
      pages: this.pages.map(p => ({
        id: p.id,
        title: p.title,
        elements: p.elements.map(el => {
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
          return el;
        }),
        panX: p.panX,
        panY: p.panY,
        scale: p.scale
      }))
    }));
  }

  restoreElements(elements) {
    return elements.map(el => {
      if (el.type === 'image') {
        const img = new Image();
        img.src = el.src;
        return {
          ...el,
          img: img
        };
      }
      return el;
    });
  }

  // 匯出整個板書為 JSON 檔案
  exportJSON() {
    const data = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      settings: this.appSettingsGetter ? this.appSettingsGetter() : {},
      pages: this.pages.map(p => ({
        title: p.title,
        panX: p.panX,
        panY: p.panY,
        scale: p.scale,
        elements: p.elements.map(el => {
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
          return el;
        })
      }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `課堂板書_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 匯入板書 JSON 檔案
  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data.pages || !Array.isArray(data.pages)) {
        throw new Error('不合法的板書檔案格式');
      }

      this.pages = data.pages.map((p, idx) => ({
        id: 'page_' + Date.now() + '_' + idx,
        title: p.title || `第 ${idx + 1} 頁`,
        elements: this.restoreElements(p.elements || []),
        undoStack: [],
        redoStack: [],
        panX: p.panX || 0,
        panY: p.panY || 0,
        scale: p.scale || 1.0
      }));

      this.currentPageIndex = 0;
      if (data.settings) {
        this.initialSettings = data.settings;
      }
      this.saveToLocalStorage();
      if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
      return true;
    } catch (e) {
      alert('匯入失敗：' + e.message);
      return false;
    }
  }

  // 清空本機快取與重設
  resetBoard() {
    this.pages = [this.createNewPageData(1)];
    this.currentPageIndex = 0;
    this.storage.clearAll();
    if (this.onPageChange) this.onPageChange(this.getCurrentPage(), this.currentPageIndex);
  }

  // 匯出高解析度 PNG 圖片
  exportPNG(engine, theme) {
    const page = this.getCurrentPage();
    const elements = page.elements;

    // 計算所有元素的邊界 (Bounding Box)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (elements.length === 0) {
      minX = 0; minY = 0; maxX = 1200; maxY = 800;
    } else {
      for (const el of elements) {
        if (el.points) {
          for (const p of el.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
        } else if (el.cx !== undefined) {
          const r = el.r || el.rx || 50;
          minX = Math.min(minX, el.cx - r);
          maxX = Math.max(maxX, el.cx + r);
          minY = Math.min(minY, el.cy - (el.ry || r));
          maxY = Math.max(maxY, el.cy + (el.ry || r));
        } else {
          const x = el.x ?? el.x1 ?? 0;
          const y = el.y ?? el.y1 ?? 0;
          const w = el.width ?? Math.abs((el.x2 ?? 0) - (el.x1 ?? 0)) ?? 100;
          const h = el.height ?? Math.abs((el.y2 ?? 0) - (el.y1 ?? 0)) ?? 100;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        }
      }
    }

    const padding = 60;
    const exportW = Math.max(800, (maxX - minX) + padding * 2);
    const exportH = Math.max(600, (maxY - minY) + padding * 2);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = exportW * 2; // 2x 雙倍解析度
    offCanvas.height = exportH * 2;
    const ctx = offCanvas.getContext('2d');
    ctx.scale(2, 2);

    // 填充底色
    let bgColor = '#ffffff';
    if (theme === 'greenboard') bgColor = '#173829';
    if (theme === 'blackboard') bgColor = '#161b22';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, exportW, exportH);

    // 平移坐標系
    ctx.translate(padding - minX, padding - minY);

    // 繪製所有物件
    for (const el of elements) {
      ctx.save();
      if (el.type === 'stroke') {
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (el.tool === 'highlighter') ctx.globalAlpha = 0.35;

        const pts = el.points;
        if (pts && pts.length > 0) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const xc = (pts[i].x + pts[i + 1].x) / 2;
            const yc = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
        }
      } else if (el.type === 'shape' || el.shapeType) {
        ShapeRenderer.drawShape(ctx, { ...el, type: el.shapeType || el.type });
      } else if (el.type === 'text') {
        ctx.font = `${el.fontSize || 22}px sans-serif`;
        ctx.fillStyle = el.color;
        const lines = el.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], el.x, el.y + (i + 1) * 28);
        }
      } else if (el.type === 'sticky') {
        ctx.fillStyle = el.color || '#fef08a';
        ctx.fillRect(el.x, el.y, el.width || 180, el.height || 140);
        ctx.fillStyle = '#1e293b';
        ctx.font = '14px sans-serif';
        const lines = (el.text || '').split('\n');
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], el.x + 14, el.y + 26 + i * 20);
        }
      } else if (el.type === 'image' && el.img) {
        ctx.drawImage(el.img, el.x, el.y, el.width, el.height);
      }
      ctx.restore();
    }

    // 下載
    const a = document.createElement('a');
    a.href = offCanvas.toDataURL('image/png');
    a.download = `課堂筆記_${page.title}_${Date.now()}.png`;
    a.click();
  }
}
