/**
 * canvas.js - 核心畫布引擎 (無限平移、縮放、雙層渲染、Retina 高解析度)
 */

export class WhiteboardCanvas {
  constructor({ containerId, bgCanvasId, mainCanvasId, overlayCanvasId, spotlightCanvasId }) {
    this.container = document.getElementById(containerId);
    this.bgCanvas = document.getElementById(bgCanvasId);
    this.mainCanvas = document.getElementById(mainCanvasId);
    this.overlayCanvas = document.getElementById(overlayCanvasId);
    this.spotlightCanvas = document.getElementById(spotlightCanvasId);

    this.bgCtx = this.bgCanvas.getContext('2d');
    this.mainCtx = this.mainCanvas.getContext('2d');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.spotlightCtx = this.spotlightCanvas ? this.spotlightCanvas.getContext('2d') : null;

    // 視圖變換參數 (無邊界畫布世界座標)
    this.panX = 0;
    this.panY = 0;
    this.scale = 1.0;
    this.minScale = 0.15;
    this.maxScale = 5.0;

    // 畫布背景與格線風格
    this.theme = 'whiteboard'; // 'whiteboard' | 'greenboard' | 'blackboard'
    this.gridType = 'grid'; // 'blank' | 'grid' | 'dots' | 'lines'

    // Retina 縮放比
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;

    // 縮放變化回調
    this.onViewChange = null;

    this.initResizeListener();
    this.resize();
  }

  initResizeListener() {
    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    const setupCanvas = (canvas, ctx) => {
      canvas.width = Math.floor(this.width * this.dpr);
      canvas.height = Math.floor(this.height * this.dpr);
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0); // 重設變換
    };

    setupCanvas(this.bgCanvas, this.bgCtx);
    setupCanvas(this.mainCanvas, this.mainCtx);
    setupCanvas(this.overlayCanvas, this.overlayCtx);
    if (this.spotlightCanvas && this.spotlightCtx) {
      setupCanvas(this.spotlightCanvas, this.spotlightCtx);
    }

    this.renderBackground();
    if (this.onViewChange) this.onViewChange();
  }

  // 螢幕座標轉世界座標 (Screen -> World)
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale
    };
  }

  // 世界座標轉螢幕座標 (World -> Screen)
  worldToScreen(wx, wy) {
    return {
      x: wx * this.scale + this.panX,
      y: wy * this.scale + this.panY
    };
  }

  // 平移畫布
  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.renderBackground();
    if (this.onViewChange) this.onViewChange();
  }

  // 縮放畫布 (以特定螢幕座標點為錨點)
  zoomAt(sx, sy, zoomFactor) {
    const oldScale = this.scale;
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, oldScale * zoomFactor));
    if (Math.abs(newScale - oldScale) < 0.0001) return;

    // 錨點公式：使螢幕上 (sx, sy) 對應的世界座標在縮放前後保持一致
    this.panX = sx - (sx - this.panX) * (newScale / oldScale);
    this.panY = sy - (sy - this.panY) * (newScale / oldScale);
    this.scale = newScale;

    this.renderBackground();
    if (this.onViewChange) this.onViewChange();
  }

  // 重設縮放到 100% 並置中
  resetView() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.renderBackground();
    if (this.onViewChange) this.onViewChange();
  }

  // 設定背景主題與格線模式
  setThemeAndGrid(theme, gridType) {
    if (theme) this.theme = theme;
    if (gridType) this.gridType = gridType;
    this.renderBackground();
  }

  // 繪製背景與格線 (在 bgCanvas 上，支援無限延伸)
  renderBackground() {
    const ctx = this.bgCtx;
    const dpr = this.dpr;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 主題底色
    let bgColor = '#f8fafc';
    let gridColor = '#e2e8f0';
    let dotColor = '#cbd5e1';

    if (this.theme === 'greenboard') {
      bgColor = '#173829';
      gridColor = 'rgba(255, 255, 255, 0.09)';
      dotColor = 'rgba(255, 255, 255, 0.2)';
    } else if (this.theme === 'blackboard') {
      bgColor = '#161b22';
      gridColor = 'rgba(255, 255, 255, 0.07)';
      dotColor = 'rgba(255, 255, 255, 0.18)';
    }

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (this.gridType === 'blank') {
      ctx.restore();
      return;
    }

    // 計算動態網格間距 (基礎 40px，隨 scale 自適應分度)
    let baseGridSize = 40;
    let visualGridSize = baseGridSize * this.scale;
    while (visualGridSize < 24) visualGridSize *= 2;
    while (visualGridSize > 80) visualGridSize /= 2;

    const startX = (this.panX % visualGridSize + visualGridSize) % visualGridSize;
    const startY = (this.panY % visualGridSize + visualGridSize) % visualGridSize;

    if (this.gridType === 'grid') {
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= w; x += visualGridSize) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, h);
      }
      for (let y = startY; y <= h; y += visualGridSize) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
      }
      ctx.stroke();
    } else if (this.gridType === 'dots') {
      ctx.fillStyle = dotColor;
      for (let x = startX; x <= w; x += visualGridSize) {
        for (let y = startY; y <= h; y += visualGridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (this.gridType === 'lines') {
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = startY; y <= h; y += visualGridSize) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // 套用世界座標變換到上下文
  applyTransform(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);
  }

  // 清除主要繪製層
  clearMain() {
    const ctx = this.mainCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
  }

  // 清除頂層浮動繪製層 (預覽/即時筆劃)
  clearOverlay() {
    const ctx = this.overlayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  // 繪製課堂聚光探照燈 (壓暗背景全場，亮出指定半徑光圈)
  renderSpotlight(sx, sy, radius) {
    if (!this.spotlightCtx) return;
    const ctx = this.spotlightCtx;
    const dpr = this.dpr;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 1. 全螢幕深色遮罩 (營造專注聚光舞台效果)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.76)';
    ctx.fillRect(0, 0, w, h);

    // 2. 開出圓形透光視窗
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 3. 探照燈金黃色光暈外圈 (極具儀式感與吸睛效果)
    ctx.globalCompositeOperation = 'source-over';

    // 外圈發光光暈
    ctx.save();
    ctx.shadowColor = 'rgba(250, 204, 21, 0.85)';
    ctx.shadowBlur = 20;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 內圈細緻高光白環
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, radius - 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // 清除探照燈
  clearSpotlight() {
    if (!this.spotlightCtx) return;
    const ctx = this.spotlightCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.spotlightCanvas.width, this.spotlightCanvas.height);
  }
}
