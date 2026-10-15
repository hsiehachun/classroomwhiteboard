/**
 * app.js - 主應用程式控制核心、UI 事件監聽、快速鍵、雙層持久化與手勢整合
 */

import { WhiteboardCanvas } from './canvas.js';
import { PageManager } from './pages.js';
import { HistoryManager } from './history.js';
import { ToolManager } from './tools.js';
import { ClassroomWidgets } from './widgets.js';

class WhiteboardApp {
  constructor() {
    // 初始化分頁與歷史管理器
    this.pageManager = new PageManager();
    this.historyManager = new HistoryManager(this.pageManager);

    // 初始化多層渲染畫布
    this.engine = new WhiteboardCanvas({
      containerId: 'canvas-container',
      bgCanvasId: 'bg-canvas',
      mainCanvasId: 'main-canvas',
      overlayCanvasId: 'overlay-canvas',
      spotlightCanvasId: 'spotlight-canvas'
    });

    // 初始化工具控制器
    this.toolManager = new ToolManager(this.engine, this.historyManager);

    // 初始化課堂小工具
    this.widgets = new ClassroomWidgets();

    // 視圖與畫布狀態
    this.isSpacePressed = false;
    this.isMiddlePanning = false;
    this.lastPanPos = null;
    this.activePointers = new Map();
    this.initialPinchDistance = null;

    // 提供給持久化層提取全域偏好
    this.pageManager.appSettingsGetter = () => this.getAppSettings();

    this.initCallbacks();
    this.initSaveStatus();
    this.initCanvasEvents();
    this.initToolbarEvents();
    this.initKeyboardShortcuts();
    this.initClipboardAndDrop();
    this.initThemeAndGridEvents();
    this.initLifecycleSave();

    // 還原偏好設定 (主題、格線、筆觸、顏色、智慧辨識)
    this.restoreSavedPreferences();

    // 載入當前頁面與首次繪製
    this.loadCurrentPageToCanvas();

    // 非同步還原 IndexedDB 大圖與歷史
    this.pageManager.hydrateFromIndexedDB().then(() => {
      this.toolManager.redrawMain();
    });
  }

  getAppSettings() {
    return {
      theme: this.engine.theme,
      grid: this.engine.gridType,
      tool: this.toolManager.currentTool,
      color: this.toolManager.currentColor,
      strokeWidth: this.toolManager.strokeWidth,
      smartShape: this.toolManager.smartShapeEnabled
    };
  }

  initCallbacks() {
    // 當視圖縮放或平移時更新 UI 與儲存視野
    this.engine.onViewChange = () => {
      const zoomPct = Math.round(this.engine.scale * 100);
      const zoomEl = document.getElementById('zoom-percentage');
      if (zoomEl) zoomEl.innerText = `${zoomPct}%`;

      // 儲存當前頁面的視角
      const curPage = this.pageManager.getCurrentPage();
      if (curPage) {
        curPage.panX = this.engine.panX;
        curPage.panY = this.engine.panY;
        curPage.scale = this.engine.scale;
        this.pageManager.saveDebounced();
      }
      this.toolManager.redrawMain();
    };

    // 歷史狀態變動時更新復原/重做按鈕狀態
    this.historyManager.onStateChange = () => {
      const undoBtn = document.getElementById('btn-undo');
      const redoBtn = document.getElementById('btn-redo');
      if (undoBtn) undoBtn.disabled = !this.historyManager.canUndo();
      if (redoBtn) redoBtn.disabled = !this.historyManager.canRedo();
    };

    // 換頁回調
    this.pageManager.onPageChange = (page, idx) => {
      this.loadCurrentPageToCanvas();
    };
  }

  // 監聽並反映本機自動備份狀態
  initSaveStatus() {
    const badge = document.getElementById('save-status-badge');
    const badgeText = document.getElementById('save-status-text');

    this.pageManager.storage.onStatusChange((status) => {
      if (!badge) return;
      if (status === 'saving') {
        badge.classList.add('saving');
        if (badgeText) badgeText.innerText = '儲存中...';
      } else {
        badge.classList.remove('saving');
        if (badgeText) badgeText.innerText = '已自動儲存';
      }
    });
  }

  // 網頁關閉、跳轉或切換至背景時同步儲存
  initLifecycleSave() {
    window.addEventListener('beforeunload', () => {
      this.pageManager.saveToLocalStorage(true);
    });
    window.addEventListener('pagehide', () => {
      this.pageManager.saveToLocalStorage(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pageManager.saveToLocalStorage(true);
      }
    });
  }

  // 還原上次關閉瀏覽器前的偏好設定
  restoreSavedPreferences() {
    const settings = this.pageManager.initialSettings;
    if (!settings) return;

    // 1. 主題
    if (settings.theme) {
      const themeSelect = document.getElementById('theme-select');
      if (themeSelect) themeSelect.value = settings.theme;
      document.body.className = '';
      if (settings.theme === 'greenboard') document.body.classList.add('theme-greenboard');
      if (settings.theme === 'blackboard') document.body.classList.add('theme-blackboard');
      this.engine.setThemeAndGrid(settings.theme, null);
    }

    // 2. 格線
    if (settings.grid) {
      const gridSelect = document.getElementById('grid-select');
      if (gridSelect) gridSelect.value = settings.grid;
      this.engine.setThemeAndGrid(null, settings.grid);
    }

    // 3. 顏色
    if (settings.color) {
      this.toolManager.setColor(settings.color);
      const colorDots = document.querySelectorAll('.color-dot');
      let matched = false;
      colorDots.forEach(dot => {
        const isMatch = dot.getAttribute('data-color') === settings.color;
        dot.classList.toggle('active', isMatch);
        if (isMatch) matched = true;
      });
      if (!matched) {
        const customPicker = document.getElementById('custom-color-picker');
        if (customPicker) customPicker.value = settings.color;
      }
    }

    // 4. 筆劃粗細
    if (settings.strokeWidth) {
      this.toolManager.setStrokeWidth(settings.strokeWidth);
      const sizeBtns = document.querySelectorAll('.size-btn');
      sizeBtns.forEach(btn => {
        const s = parseInt(btn.getAttribute('data-size'), 10);
        btn.classList.toggle('active', s === settings.strokeWidth);
      });
    }

    // 5. 智慧幾何圖形辨識開關
    if (settings.smartShape !== undefined) {
      this.toolManager.smartShapeEnabled = !!settings.smartShape;
      const smartBtn = document.getElementById('smart-shape-toggle');
      if (smartBtn) smartBtn.classList.toggle('active', this.toolManager.smartShapeEnabled);
    }

    // 6. 工具
    if (settings.tool && settings.tool !== 'spotlight' && settings.tool !== 'eraser') {
      this.selectToolByName(settings.tool);
    }
  }

  loadCurrentPageToCanvas() {
    const page = this.pageManager.getCurrentPage();
    if (!page) return;

    // 還原該頁面的視野位置
    this.engine.panX = page.panX || 0;
    this.engine.panY = page.panY || 0;
    this.engine.scale = page.scale || 1.0;
    this.engine.renderBackground();

    // 更新頁碼指示器
    const pageEl = document.getElementById('page-indicator-text');
    if (pageEl) {
      pageEl.innerText = `${this.pageManager.currentPageIndex + 1} / ${this.pageManager.getTotalPages()}`;
    }

    // 更新歷史狀態按鈕
    if (this.historyManager.onStateChange) this.historyManager.onStateChange();

    // 重新繪製頁面內容
    this.toolManager.redrawMain();
  }

  // ===== 指標、觸控、滾輪與縮放事件 =====

  initCanvasEvents() {
    const container = this.engine.container;

    // 滑鼠滾輪縮放 (以滑鼠所在位置為中心進行無損縮放)
    container.addEventListener('wheel', (e) => {
      e.preventDefault();

      // 若當前為探照燈模式，滾輪直接調整聚光圈大小
      if (this.toolManager.currentTool === 'spotlight') {
        const delta = e.deltaY < 0 ? 15 : -15;
        this.toolManager.adjustSpotlightRadius(delta);
        return;
      }

      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        // 精確縮放
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        this.engine.zoomAt(sx, sy, factor);
      } else {
        // 快速縮放
        const factor = e.deltaY < 0 ? 1.15 : 0.85;
        this.engine.zoomAt(sx, sy, factor);
      }
    }, { passive: false });

    // 指標按下 (支援滑鼠、觸控筆、手指觸控)
    container.addEventListener('pointerdown', (e) => {
      container.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 中鍵點擊或空白鍵按住：啟動畫布平移
      if (e.button === 1 || this.isSpacePressed || this.toolManager.currentTool === 'hand') {
        this.isMiddlePanning = true;
        this.lastPanPos = { x: e.clientX, y: e.clientY };
        container.style.cursor = 'grabbing';
        return;
      }

      // 雙指觸控手勢 (Pinch-to-zoom)
      if (this.activePointers.size === 2) {
        const pts = Array.from(this.activePointers.values());
        this.initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        return;
      }

      // 交由工具控制器處理
      this.toolManager.handlePointerDown(e);
    });

    // 指標移動
    container.addEventListener('pointermove', (e) => {
      if (this.activePointers.has(e.pointerId)) {
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // 平移中
      if (this.isMiddlePanning && this.lastPanPos) {
        const dx = e.clientX - this.lastPanPos.x;
        const dy = e.clientY - this.lastPanPos.y;
        this.engine.panBy(dx, dy);
        this.lastPanPos = { x: e.clientX, y: e.clientY };
        return;
      }

      // 雙指捏合縮放
      if (this.activePointers.size === 2 && this.initialPinchDistance) {
        const pts = Array.from(this.activePointers.values());
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const factor = curDist / this.initialPinchDistance;
        const center = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2
        };
        const rect = container.getBoundingClientRect();
        this.engine.zoomAt(center.x - rect.left, center.y - rect.top, factor);
        this.initialPinchDistance = curDist;
        return;
      }

      // 工具繪製中
      this.toolManager.handlePointerMove(e);
    });

    // 指標放開
    const handlePointerUp = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.initialPinchDistance = null;
      }

      if (this.isMiddlePanning) {
        this.isMiddlePanning = false;
        this.lastPanPos = null;
        container.style.cursor = this.isSpacePressed ? 'grab' : 'default';
        return;
      }

      this.toolManager.handlePointerUp(e);
    };

    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerUp);
  }

  // ===== 工具列與介面操作事件 =====

  initToolbarEvents() {
    // 工具按鈕切換
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool');
        const popover = document.getElementById('shapes-popover');

        if (tool === 'shape') {
          // 切換幾何圖形彈出選單
          popover.classList.toggle('show');
        } else {
          popover.classList.remove('show');
        }

        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.toolManager.setTool(tool);
        this.pageManager.saveDebounced();

        if (tool === 'spotlight') {
          this.widgets.showToast('🔦 探照燈已開啟（滑鼠移動聚光，滾輪調整大小，按 F 或 Esc 關閉）');
        }
      });
    });

    // 幾何形狀子選單按鈕
    const shapeOptions = document.querySelectorAll('.shape-option-btn');
    shapeOptions.forEach(btn => {
      btn.addEventListener('click', () => {
        const shapeType = btn.getAttribute('data-shape');
        shapeOptions.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.toolManager.setShapeType(shapeType);
        document.getElementById('shapes-popover').classList.remove('show');
        this.pageManager.saveDebounced();
      });
    });

    // 智慧圖形辨識按鈕開關
    const smartBtn = document.getElementById('smart-shape-toggle');
    if (smartBtn) {
      smartBtn.addEventListener('click', () => {
        const enabled = this.toolManager.toggleSmartShape();
        smartBtn.classList.toggle('active', enabled);
        this.pageManager.saveDebounced();
        this.widgets.showToast(enabled ? '⚡ 已開啟「智慧圖形辨識」' : '已關閉智慧辨識');
      });
    }

    // 顏色選擇器色點
    const colorDots = document.querySelectorAll('.color-dot');
    colorDots.forEach(dot => {
      dot.addEventListener('click', () => {
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        const color = dot.getAttribute('data-color');
        this.toolManager.setColor(color);
        this.pageManager.saveDebounced();
      });
    });

    // 自訂顏色選擇器
    const customColorInput = document.getElementById('custom-color-picker');
    if (customColorInput) {
      customColorInput.addEventListener('input', (e) => {
        colorDots.forEach(d => d.classList.remove('active'));
        this.toolManager.setColor(e.target.value);
        this.pageManager.saveDebounced();
      });
    }

    // 筆劃粗細按鈕
    const sizeBtns = document.querySelectorAll('.size-btn');
    sizeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        sizeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const size = parseInt(btn.getAttribute('data-size'), 10);
        this.toolManager.setStrokeWidth(size);
        this.pageManager.saveDebounced();
      });
    });

    // 復原與重做按鈕
    document.getElementById('btn-undo')?.addEventListener('click', () => {
      if (this.historyManager.undo()) {
        this.toolManager.redrawMain();
      }
    });

    document.getElementById('btn-redo')?.addEventListener('click', () => {
      if (this.historyManager.redo()) {
        this.toolManager.redrawMain();
      }
    });

    // 畫布清空按鈕
    document.getElementById('btn-clear-canvas')?.addEventListener('click', () => {
      if (confirm('確定要清空當前頁面的所有板書內容嗎？此動作可透過「復原 (Ctrl+Z)」還原。')) {
        this.historyManager.clear();
        this.toolManager.redrawMain();
        this.widgets.showToast('🧹 已清空當前頁面');
      }
    });

    // 分頁控制按鈕
    document.getElementById('btn-prev-page')?.addEventListener('click', () => {
      this.pageManager.prevPage();
    });

    document.getElementById('btn-next-page')?.addEventListener('click', () => {
      this.pageManager.nextPage();
    });

    document.getElementById('btn-add-page')?.addEventListener('click', () => {
      this.pageManager.addPage();
      this.widgets.showToast(`📄 已新增第 ${this.pageManager.getTotalPages()} 頁`);
    });

    document.getElementById('btn-delete-page')?.addEventListener('click', () => {
      if (confirm('確定要刪除此頁面嗎？')) {
        this.pageManager.removeCurrentPage();
      }
    });

    // 縮放重設與加減
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.engine.zoomAt(this.engine.width / 2, this.engine.height / 2, 1.2);
    });

    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.engine.zoomAt(this.engine.width / 2, this.engine.height / 2, 0.83);
    });

    document.getElementById('zoom-percentage')?.addEventListener('click', () => {
      this.engine.resetView();
    });

    // 課堂輔助小工具開關 (計時器、抽籤器)
    document.getElementById('btn-open-timer')?.addEventListener('click', () => {
      document.getElementById('timer-window')?.classList.toggle('show');
    });

    document.getElementById('btn-open-picker')?.addEventListener('click', () => {
      document.getElementById('picker-window')?.classList.toggle('show');
    });

    // 全螢幕切換
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // 說明與快速鍵視窗
    document.getElementById('btn-help-modal')?.addEventListener('click', () => {
      document.getElementById('help-modal')?.classList.add('show');
    });

    document.getElementById('help-modal-close')?.addEventListener('click', () => {
      document.getElementById('help-modal')?.classList.remove('show');
    });

    // 匯出與匯入功能
    document.getElementById('btn-export-png')?.addEventListener('click', () => {
      this.pageManager.exportPNG(this.engine, this.engine.theme);
      this.widgets.showToast('🖼️ 正在匯出高解析度圖片...');
    });

    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      this.pageManager.exportJSON();
      this.widgets.showToast('💾 已下載板書備份檔案');
    });

    // 檔案選取上傳圖片
    const imgUploadInput = document.getElementById('image-file-input');
    imgUploadInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        this.loadFileAsImage(file);
      }
      e.target.value = '';
    });

    document.getElementById('btn-upload-image')?.addEventListener('click', () => {
      imgUploadInput?.click();
    });

    // 匯入 JSON 板書
    const jsonImportInput = document.getElementById('json-file-input');
    jsonImportInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          this.pageManager.importJSON(event.target.result);
          if (this.pageManager.initialSettings) {
            this.restoreSavedPreferences();
          }
        };
        reader.readAsText(file);
      }
      e.target.value = '';
    });

    document.getElementById('btn-import-json')?.addEventListener('click', () => {
      jsonImportInput?.click();
    });

    // 重設全新空白白板
    document.getElementById('btn-reset-board-all')?.addEventListener('click', () => {
      if (confirm('確定要清空所有歷史板書並重設為全新空白白板嗎？此動作將清除所有分頁。')) {
        this.pageManager.resetBoard();
        document.getElementById('help-modal')?.classList.remove('show');
        this.loadCurrentPageToCanvas();
        this.widgets.showToast('✨ 已重設為全新空白課程！');
      }
    });
  }

  // ===== 黑白板主題與格線切換 =====

  initThemeAndGridEvents() {
    // 主題切換 (白板 / 綠板 / 黑板)
    const themeSelect = document.getElementById('theme-select');
    themeSelect?.addEventListener('change', (e) => {
      const theme = e.target.value;
      document.body.className = '';
      if (theme === 'greenboard') document.body.classList.add('theme-greenboard');
      if (theme === 'blackboard') document.body.classList.add('theme-blackboard');

      // 若切換為深色黑板/綠板且當前為深黑畫筆，自動切換為白色粉筆以利板書
      if (theme === 'greenboard' || theme === 'blackboard') {
        if (this.toolManager.currentColor === '#1e293b' || this.toolManager.currentColor === '#000000') {
          this.toolManager.setColor('#ffffff');
          const whiteDot = document.querySelector('.color-dot[data-color="#ffffff"]');
          if (whiteDot) {
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            whiteDot.classList.add('active');
          }
        }
      } else if (theme === 'whiteboard') {
        if (this.toolManager.currentColor === '#ffffff') {
          this.toolManager.setColor('#1e293b');
          const blackDot = document.querySelector('.color-dot[data-color="#1e293b"]');
          if (blackDot) {
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            blackDot.classList.add('active');
          }
        }
      }

      this.engine.setThemeAndGrid(theme, null);
      this.toolManager.redrawMain();
      this.pageManager.saveToLocalStorage();
      const themeName = themeSelect.options[themeSelect.selectedIndex].text;
      this.widgets.showToast(`🎨 畫面已切換為：${themeName}`);
    });

    // 格線風格 (空白 / 方格 / 點陣 / 橫線)
    const gridSelect = document.getElementById('grid-select');
    gridSelect?.addEventListener('change', (e) => {
      const grid = e.target.value;
      this.engine.setThemeAndGrid(null, grid);
      this.pageManager.saveToLocalStorage();
      const gridName = gridSelect.options[gridSelect.selectedIndex].text;
      this.widgets.showToast(`📐 格線已切換為：${gridName}`);
    });
  }

  // ===== 鍵盤快速鍵支援 =====

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 避免在打字輸入時觸發快速鍵
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // 刪除選取的物件 (Delete / Backspace)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.toolManager.selectedElement) {
          e.preventDefault();
          this.toolManager.deleteSelected();
          this.widgets.showToast('🗑️ 已刪除選取的便利貼/物件');
          return;
        }
      }

      // 空白鍵：啟動平移
      if (e.code === 'Space' && !this.isSpacePressed) {
        this.isSpacePressed = true;
        this.engine.container.style.cursor = 'grab';
        e.preventDefault();
      }

      // 復原 (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (this.historyManager.undo()) this.toolManager.redrawMain();
      }

      // 重做 (Ctrl+Y 或 Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (this.historyManager.redo()) this.toolManager.redrawMain();
      }

      // 按 Escape 鍵快速關閉探照燈返回畫筆
      if (e.key === 'Escape' && this.toolManager.currentTool === 'spotlight') {
        this.selectToolByName('pen');
        return;
      }

      // 工具單鍵快捷鍵
      const key = e.key.toLowerCase();
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (key === 'p') this.selectToolByName('pen');
        else if (key === 'h') this.selectToolByName('highlighter');
        else if (key === 'e') this.selectToolByName('eraser');
        else if (key === 'l') this.selectToolByName('laser');
        else if (key === 'f') {
          if (this.toolManager.currentTool === 'spotlight') {
            this.selectToolByName('pen');
          } else {
            this.selectToolByName('spotlight');
          }
        }
        else if (key === 's') this.selectToolByName('shape');
        else if (key === 't') this.selectToolByName('text');
        else if (key === 'v') this.selectToolByName('select');
        else if (key === '?') {
          document.getElementById('help-modal')?.classList.toggle('show');
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (!this.isMiddlePanning) {
          this.engine.container.style.cursor = 'default';
        }
      }
    });
  }

  selectToolByName(name) {
    const btn = document.querySelector(`.tool-btn[data-tool="${name}"]`);
    if (btn) btn.click();
  }

  // ===== 剪貼簿貼上 (Ctrl+V) 與檔案拖曳 =====

  initClipboardAndDrop() {
    // 剪貼簿直接貼上截圖 (教學超常用：截圖講義或題目直接貼上黑板！)
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            this.loadFileAsImage(blob);
            this.widgets.showToast('📋 已將剪貼簿圖片貼入板書！');
          }
        }
      }
    });

    // 拖曳圖片檔案至畫布
    const container = this.engine.container;
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith('image/')) {
            const rect = container.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            const worldPos = this.engine.screenToWorld(sx, sy);
            this.loadFileAsImage(files[i], worldPos);
          }
        }
      }
    });
  }

  loadFileAsImage(file, worldPos = null) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.toolManager.addImageElement(img, worldPos);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }
}

// 頁面加載完成後啟動白板應用
window.addEventListener('DOMContentLoaded', () => {
  window.whiteboardApp = new WhiteboardApp();
});
