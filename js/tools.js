/**
 * tools.js - 白板畫筆、螢光筆、幾何形狀、橡皮擦、雷射筆、文字與便利貼工具管理
 */

import { ShapeRenderer, ShapeRecognizer } from './shapes.js';

export class ToolManager {
  constructor(canvasEngine, historyManager) {
    this.engine = canvasEngine;
    this.history = historyManager;

    // 當前工具設定
    this.currentTool = 'pen'; // 'pen' | 'highlighter' | 'shape' | 'eraser' | 'laser' | 'text' | 'sticky' | 'select' | 'hand'
    this.currentColor = '#1e293b';
    this.strokeWidth = 3;
    this.currentShapeType = 'rect'; // 'rect' | 'circle' | 'line' | 'arrow' | 'double_arrow' | 'triangle' | 'coordinate'
    this.smartShapeEnabled = true; // 智慧辨識

    // 筆劃繪製狀態
    this.isDrawing = false;
    this.currentPoints = [];
    this.startWorldPoint = null;

    // 雷射筆軌跡
    this.laserPoints = [];
    this.laserAnimFrame = null;
    this.laserColor = '#ef4444'; // 紅色雷射

    // 橡皮擦半徑
    this.eraserRadius = 14;
    this.erasedInThisStroke = false;

    // 文字輸入 DOM 參考
    this.textOverlay = document.getElementById('text-editor-overlay');
    this.activeTextElement = null;
    this.activeStickyElement = null;

    // 便利貼顏色序列
    this.stickyColors = ['#fef08a', '#bbf7d0', '#bae6fd', '#fed7aa', '#fbcfe8'];
    this.stickyColorIndex = 0;

    // 選取與拖曳狀態
    this.selectedElement = null;
    this.dragStart = null;
    this.elementStartPos = null;

    // 探照燈聚光設定
    this.spotlightRadius = 160;
    this.lastSpotlightPos = { sx: 0, sy: 0 };

    this.initTextEditor();
  }

  // 設定當前工具
  setTool(tool) {
    this.finishTextEditing();

    // 如果離開探照燈工具，清除全螢幕遮罩
    if (this.currentTool === 'spotlight' && tool !== 'spotlight') {
      this.engine.clearSpotlight();
    }

    this.currentTool = tool;
    this.selectedElement = null;
    this.updateSelectedActions();
    this.engine.clearOverlay();

    // 依工具切換游標外觀
    if (tool === 'select') {
      this.engine.container.style.cursor = 'default';
    } else if (tool === 'hand') {
      this.engine.container.style.cursor = 'grab';
    } else if (tool === 'text') {
      this.engine.container.style.cursor = 'text';
    } else if (tool === 'eraser' || tool === 'laser') {
      this.engine.container.style.cursor = 'none';
    } else {
      this.engine.container.style.cursor = 'crosshair';
    }

    // 如果切換為探照燈，初始化聚光位置
    if (tool === 'spotlight') {
      this.lastSpotlightPos = { sx: this.engine.width / 2, sy: this.engine.height / 2 };
      this.engine.renderSpotlight(this.lastSpotlightPos.sx, this.lastSpotlightPos.sy, this.spotlightRadius);
    }

    this.redrawMain();
  }

  adjustSpotlightRadius(delta) {
    this.spotlightRadius = Math.max(60, Math.min(450, this.spotlightRadius + delta));
    this.engine.renderSpotlight(this.lastSpotlightPos.sx, this.lastSpotlightPos.sy, this.spotlightRadius);
  }

  // 設定顏色與筆寬
  setColor(color) {
    this.currentColor = color;
    // 若當前正選取任何物件 (幾何形狀、便利貼、文字、筆畫)，直接變更該物件顏色
    if (this.selectedElement) {
      this.selectedElement.color = color;
      this.history.recordChange();
      this.redrawMain();
    }
  }

  setStrokeWidth(width) {
    this.strokeWidth = width;
    // 若當前正選取幾何圖形或筆畫，直接調整其粗細
    if (this.selectedElement) {
      if (this.selectedElement.type === 'shape' || this.selectedElement.shapeType) {
        this.selectedElement.strokeWidth = width;
        if (this.selectedElement.shapeType !== 'rect' && this.selectedElement.shapeType !== 'coordinate') {
          this.selectedElement.width = width;
        }
        this.history.recordChange();
        this.redrawMain();
      } else if (this.selectedElement.type === 'stroke') {
        this.selectedElement.width = width;
        this.selectedElement.strokeWidth = width;
        this.history.recordChange();
        this.redrawMain();
      }
    }
  }

  setShapeType(shapeType) {
    this.currentShapeType = shapeType;
    this.setTool('shape');
  }

  toggleSmartShape() {
    this.smartShapeEnabled = !this.smartShapeEnabled;
    return this.smartShapeEnabled;
  }

  // ===== 繪製與指標事件處理 (Pointer Events) =====

  handlePointerDown(e) {
    const rect = this.engine.container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = this.engine.screenToWorld(sx, sy);

    this.isDrawing = true;
    this.startWorldPoint = worldPos;
    this.currentPoints = [{ x: worldPos.x, y: worldPos.y, p: e.pressure || 0.5 }];

    if (this.currentTool === 'eraser') {
      this.erasedInThisStroke = false;
      this.checkEraserCollision(worldPos);
    } else if (this.currentTool === 'laser') {
      this.addLaserPoint(worldPos);
    } else if (this.currentTool === 'spotlight') {
      this.isDrawing = true;
      this.currentPoints = [{ x: worldPos.x, y: worldPos.y, p: e.pressure || 0.5 }];
    } else if (this.currentTool === 'text') {
      this.openTextEditor(worldPos, sx, sy);
      this.isDrawing = false;
    } else if (this.currentTool === 'sticky') {
      this.createStickyNote(worldPos);
      this.isDrawing = false;
      this.setTool('select');
    } else if (this.currentTool === 'select') {
      const found = this.findElementAt(worldPos);

      // 檢查是否直接點選便利貼右上角紅色的 [✕] 刪除按鈕
      if (found && found.type === 'sticky') {
        const closeX = found.x + found.width - 16;
        const closeY = found.y + 16;
        if (Math.hypot(worldPos.x - closeX, worldPos.y - closeY) <= 18) {
          const elements = this.history.getCurrentElements();
          const idx = elements.indexOf(found);
          if (idx !== -1) {
            elements.splice(idx, 1);
            this.selectedElement = null;
            this.updateSelectedActions();
            this.history.recordChange();
            this.redrawMain();
            this.isDrawing = false;
            return;
          }
        }
      }

      this.selectedElement = found;
      if (this.selectedElement) {
        this.dragStart = worldPos;
        this.engine.container.style.cursor = 'grabbing';
      } else {
        this.dragStart = null;
        this.engine.container.style.cursor = 'default';
      }
      this.updateSelectedActions();
      this.redrawMain();
    }
  }

  handlePointerMove(e) {
    const rect = this.engine.container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = this.engine.screenToWorld(sx, sy);

    // 雷射筆未按下時也可作為游標指示，按下時留下一道殘影
    if (this.currentTool === 'laser') {
      this.addLaserPoint(worldPos);
      return;
    }

    // 探照燈聚光隨滑鼠移動
    if (this.currentTool === 'spotlight') {
      this.lastSpotlightPos = { sx, sy };
      this.engine.renderSpotlight(sx, sy, this.spotlightRadius);
      if (this.isDrawing) {
        this.currentPoints.push({ x: worldPos.x, y: worldPos.y, p: e.pressure || 0.5 });
        this.renderLiveStroke();
      }
      return;
    }

    // 當選取工具處於靜止懸停時，顯示 move 游標提示可拖曳
    if (this.currentTool === 'select' && !this.isDrawing) {
      const hoverEl = this.findElementAt(worldPos);
      this.engine.container.style.cursor = hoverEl ? 'move' : 'default';
      return;
    }

    if (!this.isDrawing) return;

    this.currentPoints.push({ x: worldPos.x, y: worldPos.y, p: e.pressure || 0.5 });

    if (this.currentTool === 'pen' || this.currentTool === 'highlighter') {
      this.renderLiveStroke();
    } else if (this.currentTool === 'shape') {
      this.renderShapePreview(this.startWorldPoint, worldPos);
    } else if (this.currentTool === 'eraser') {
      this.checkEraserCollision(worldPos);
      this.renderEraserCursor(sx, sy);
    } else if (this.currentTool === 'select' && this.selectedElement && this.dragStart) {
      const dx = worldPos.x - this.dragStart.x;
      const dy = worldPos.y - this.dragStart.y;
      this.moveElement(this.selectedElement, dx, dy);
      this.dragStart = worldPos;
      this.updateSelectedActions();
      this.redrawMain();
    }
  }

  handlePointerUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const rect = this.engine.container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldPos = this.engine.screenToWorld(sx, sy);

    this.engine.clearOverlay();

    if (this.currentTool === 'pen' || this.currentTool === 'spotlight') {
      this.commitPenStroke();
    } else if (this.currentTool === 'highlighter') {
      this.commitHighlighterStroke();
    } else if (this.currentTool === 'shape') {
      this.commitShape(this.startWorldPoint, worldPos);
    } else if (this.currentTool === 'eraser') {
      if (this.erasedInThisStroke) {
        this.history.recordChange();
      }
    } else if (this.currentTool === 'select') {
      if (this.selectedElement) {
        this.history.recordChange();
        this.updateSelectedActions();
        this.engine.container.style.cursor = 'move';
      } else {
        this.engine.container.style.cursor = 'default';
      }
    }

    this.currentPoints = [];
    this.startWorldPoint = null;
    this.redrawMain();
  }

  // ===== 筆劃提交與平滑處理 =====

  commitPenStroke() {
    if (this.currentPoints.length < 2) return;

    // 智慧圖形識別
    if (this.smartShapeEnabled) {
      const recognized = ShapeRecognizer.recognize(this.currentPoints);
      if (recognized) {
        const shapeElement = {
          ...recognized,
          type: 'shape',
          shapeType: recognized.type,
          color: this.currentColor,
          strokeWidth: this.strokeWidth,
          width: recognized.width !== undefined ? recognized.width : this.strokeWidth
        };
        this.history.getCurrentElements().push(shapeElement);
        this.history.recordChange();
        return;
      }
    }

    // 普通筆劃
    const strokeElement = {
      type: 'stroke',
      tool: 'pen',
      color: this.currentColor,
      width: this.strokeWidth,
      points: [...this.currentPoints]
    };
    this.history.getCurrentElements().push(strokeElement);
    this.history.recordChange();
  }

  commitHighlighterStroke() {
    if (this.currentPoints.length < 2) return;
    const strokeElement = {
      type: 'stroke',
      tool: 'highlighter',
      color: this.currentColor,
      width: Math.max(16, this.strokeWidth * 3.5),
      points: [...this.currentPoints]
    };
    this.history.getCurrentElements().push(strokeElement);
    this.history.recordChange();
  }

  commitShape(p1, p2) {
    if (!p1 || !p2) return;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.hypot(dx, dy) < 4) return; // 太小不建立

    let shapeObj = {
      type: 'shape',
      shapeType: this.currentShapeType,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      width: this.strokeWidth
    };

    const minX = Math.min(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const width = Math.max(4, Math.abs(dx));
    const height = Math.max(4, Math.abs(dy));

    switch (this.currentShapeType) {
      case 'rect':
        shapeObj.x = minX;
        shapeObj.y = minY;
        shapeObj.width = width;
        shapeObj.height = height;
        break;

      case 'circle': {
        const r = Math.max(4, Math.hypot(dx, dy) / 2);
        shapeObj.cx = (p1.x + p2.x) / 2;
        shapeObj.cy = (p1.y + p2.y) / 2;
        shapeObj.r = r;
        break;
      }

      case 'ellipse':
        shapeObj.cx = minX + width / 2;
        shapeObj.cy = minY + height / 2;
        shapeObj.rx = Math.max(4, width / 2);
        shapeObj.ry = Math.max(4, height / 2);
        break;

      case 'line':
      case 'arrow':
      case 'double_arrow':
        shapeObj.x1 = p1.x;
        shapeObj.y1 = p1.y;
        shapeObj.x2 = p2.x;
        shapeObj.y2 = p2.y;
        break;

      case 'triangle':
        shapeObj.points = [
          { x: minX + width / 2, y: minY },
          { x: minX, y: minY + height },
          { x: minX + width, y: minY + height }
        ];
        break;

      case 'coordinate':
        shapeObj.x = minX;
        shapeObj.y = minY;
        shapeObj.width = width;
        shapeObj.height = height;
        break;
    }

    this.history.getCurrentElements().push(shapeObj);
    this.history.recordChange();
  }

  // ===== 即時預覽渲染 (Overlay Layer) =====

  renderLiveStroke() {
    const ctx = this.engine.overlayCtx;
    this.engine.clearOverlay();
    this.engine.applyTransform(ctx);

    const isHighlighter = this.currentTool === 'highlighter';
    ctx.save();
    ctx.strokeStyle = this.currentColor;
    ctx.lineWidth = isHighlighter ? Math.max(16, this.strokeWidth * 3.5) : this.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isHighlighter) {
      ctx.globalAlpha = 0.35;
    }

    this.drawSmoothStroke(ctx, this.currentPoints);
    ctx.restore();
  }

  renderShapePreview(p1, p2) {
    if (!p1 || !p2) return;
    const ctx = this.engine.overlayCtx;
    this.engine.clearOverlay();
    this.engine.applyTransform(ctx);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const minX = Math.min(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const width = Math.max(4, Math.abs(dx));
    const height = Math.max(4, Math.abs(dy));

    const tempShape = {
      type: 'shape',
      shapeType: this.currentShapeType,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      width: this.strokeWidth
    };

    switch (this.currentShapeType) {
      case 'rect':
        tempShape.x = minX;
        tempShape.y = minY;
        tempShape.width = width;
        tempShape.height = height;
        break;
      case 'circle':
        tempShape.cx = (p1.x + p2.x) / 2;
        tempShape.cy = (p1.y + p2.y) / 2;
        tempShape.r = Math.max(4, Math.hypot(dx, dy) / 2);
        break;
      case 'ellipse':
        tempShape.cx = minX + width / 2;
        tempShape.cy = minY + height / 2;
        tempShape.rx = Math.max(4, width / 2);
        tempShape.ry = Math.max(4, height / 2);
        break;
      case 'line':
      case 'arrow':
      case 'double_arrow':
        tempShape.x1 = p1.x;
        tempShape.y1 = p1.y;
        tempShape.x2 = p2.x;
        tempShape.y2 = p2.y;
        break;
      case 'triangle':
        tempShape.points = [
          { x: minX + width / 2, y: minY },
          { x: minX, y: minY + height },
          { x: minX + width, y: minY + height }
        ];
        break;
      case 'coordinate':
        tempShape.x = minX;
        tempShape.y = minY;
        tempShape.width = width;
        tempShape.height = height;
        break;
    }

    ShapeRenderer.drawShape(ctx, tempShape);
  }

  renderEraserCursor(sx, sy) {
    const ctx = this.engine.overlayCtx;
    this.engine.clearOverlay();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.engine.dpr, this.engine.dpr);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, this.eraserRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ===== 雷射筆功能 (Laser Pointer with Decay Trail) =====

  addLaserPoint(worldPos) {
    const now = performance.now();
    this.laserPoints.push({ x: worldPos.x, y: worldPos.y, time: now });

    if (!this.laserAnimFrame) {
      this.animateLaser();
    }
  }

  animateLaser() {
    const now = performance.now();
    const duration = 1100; // 1.1 秒消散

    // 過濾過期的點
    this.laserPoints = this.laserPoints.filter(p => now - p.time < duration);

    const ctx = this.engine.overlayCtx;
    this.engine.clearOverlay();

    if (this.laserPoints.length > 0) {
      this.engine.applyTransform(ctx);

      // 繪製漸隱發光尾巴
      for (let i = 1; i < this.laserPoints.length; i++) {
        const p1 = this.laserPoints[i - 1];
        const p2 = this.laserPoints[i];
        const progress = (now - p2.time) / duration; // 0 (最新) ~ 1 (最舊)
        const alpha = Math.max(0, 1 - progress);

        ctx.save();
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.85})`;
        ctx.lineWidth = Math.max(2, 8 * (1 - progress));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }

      // 繪製頭部亮點 (雷射焦點光暈)
      const head = this.laserPoints[this.laserPoints.length - 1];
      ctx.save();
      // 外層發光圈
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 14, 0, Math.PI * 2);
      ctx.fill();
      // 內層焦點
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      this.laserAnimFrame = requestAnimationFrame(() => this.animateLaser());
    } else {
      this.laserAnimFrame = null;
    }
  }

  // ===== 橡皮擦筆劃碰撞 (Stroke Eraser) =====

  checkEraserCollision(pos) {
    const elements = this.history.getCurrentElements();
    const threshold = this.eraserRadius / this.engine.scale;

    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      let hit = false;

      if (el.type === 'stroke') {
        hit = el.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < threshold + el.width / 2);
      } else if (el.type === 'shape' || el.shapeType) {
        hit = this.isPointInOrNearShape(el, pos, threshold);
      } else if (el.type === 'text' || el.type === 'sticky' || el.type === 'image') {
        const bounds = this.getElementBounds(el);
        hit = pos.x >= bounds.x - threshold && pos.x <= bounds.x + bounds.width + threshold &&
              pos.y >= bounds.y - threshold && pos.y <= bounds.y + bounds.height + threshold;
      }

      if (hit) {
        if (this.selectedElement === el) {
          this.selectedElement = null;
          this.updateSelectedActions();
        }
        elements.splice(i, 1);
        this.erasedInThisStroke = true;
      }
    }

    if (this.erasedInThisStroke) {
      this.redrawMain();
    }
  }

  isShapeIntersecting(shape, pos, threshold) {
    return this.isPointInOrNearShape(shape, pos, threshold);
  }

  // ===== 文字工具 (Inline DOM Text Editor) =====

  initTextEditor() {
    this.textOverlay.addEventListener('blur', () => {
      this.finishTextEditing();
    });

    this.textOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && this.activeStickyElement)) {
        this.finishTextEditing();
      }
    });

    // 綁定選取工具列的按鈕事件
    document.getElementById('btn-delete-selected')?.addEventListener('click', () => {
      this.deleteSelected();
    });

    document.getElementById('btn-edit-selected')?.addEventListener('click', () => {
      if (this.selectedElement) {
        if (this.selectedElement.type === 'sticky') {
          this.editStickyNote(this.selectedElement);
        } else if (this.selectedElement.type === 'text') {
          const screenPos = this.engine.worldToScreen(this.selectedElement.x, this.selectedElement.y);
          this.openTextEditor(this.selectedElement, screenPos.x, screenPos.y, this.selectedElement);
        }
      }
    });
  }

  openTextEditor(worldPos, sx, sy, existingElement = null) {
    this.activeTextElement = existingElement;
    this.textOverlay.style.left = `${sx}px`;
    this.textOverlay.style.top = `${sy}px`;
    this.textOverlay.style.fontSize = `${Math.max(16, 20 * this.engine.scale)}px`;
    this.textOverlay.style.color = this.currentColor;
    this.textOverlay.style.display = 'block';

    if (existingElement) {
      this.textOverlay.innerText = existingElement.text;
    } else {
      this.textOverlay.innerText = '';
    }

    this.textOverlay.focus();
  }

  editStickyNote(note) {
    if (!note) return;
    const screenPos = this.engine.worldToScreen(note.x, note.y);
    const screenW = note.width * this.engine.scale;
    const screenH = note.height * this.engine.scale;

    this.activeStickyElement = note;
    this.textOverlay.style.left = `${screenPos.x + 8}px`;
    this.textOverlay.style.top = `${screenPos.y + 8}px`;
    this.textOverlay.style.width = `${screenW - 16}px`;
    this.textOverlay.style.minHeight = `${screenH - 16}px`;
    this.textOverlay.style.fontSize = `${Math.max(13, 14 * this.engine.scale)}px`;
    this.textOverlay.style.color = '#1e293b';
    this.textOverlay.style.backgroundColor = note.color;
    this.textOverlay.style.border = '1px dashed #3b82f6';
    this.textOverlay.style.display = 'block';
    this.textOverlay.innerText = note.text;
    this.textOverlay.focus();
  }

  deleteSelected() {
    if (!this.selectedElement) return false;
    const elements = this.history.getCurrentElements();
    const index = elements.indexOf(this.selectedElement);
    if (index !== -1) {
      elements.splice(index, 1);
      this.selectedElement = null;
      this.updateSelectedActions();
      this.history.recordChange();
      this.redrawMain();
      return true;
    }
    return false;
  }

  updateSelectedActions() {
    const actionsBar = document.getElementById('selected-actions');
    if (!actionsBar) return;

    if (!this.selectedElement || this.currentTool !== 'select') {
      actionsBar.style.display = 'none';
      return;
    }

    const el = this.selectedElement;
    const bounds = this.getElementBounds(el);
    const screenPos = this.engine.worldToScreen(bounds.x, bounds.y);
    const screenW = bounds.width * this.engine.scale;

    actionsBar.style.left = `${Math.max(16, screenPos.x + screenW / 2)}px`;
    actionsBar.style.top = `${Math.max(70, screenPos.y - 44)}px`;
    actionsBar.style.transform = 'translateX(-50%)';
    actionsBar.style.display = 'flex';

    const editBtn = document.getElementById('btn-edit-selected');
    if (editBtn) {
      editBtn.style.display = (el.type === 'sticky' || el.type === 'text') ? 'flex' : 'none';
    }
  }

  finishTextEditing() {
    if (this.textOverlay.style.display !== 'block') return;

    const text = this.textOverlay.innerText.trim();
    this.textOverlay.style.display = 'none';
    this.textOverlay.style.backgroundColor = 'transparent';
    this.textOverlay.style.width = '';
    this.textOverlay.style.minHeight = '';
    this.textOverlay.style.border = '1px dashed var(--accent-color)';

    if (this.activeStickyElement) {
      if (text) {
        this.activeStickyElement.text = text;
      }
      this.activeStickyElement = null;
      this.history.recordChange();
      this.redrawMain();
      return;
    }

    if (!text) {
      this.activeTextElement = null;
      return;
    }

    const rect = this.engine.container.getBoundingClientRect();
    const sx = parseFloat(this.textOverlay.style.left);
    const sy = parseFloat(this.textOverlay.style.top);
    const worldPos = this.engine.screenToWorld(sx, sy);

    if (this.activeTextElement) {
      this.activeTextElement.text = text;
    } else {
      const textElement = {
        type: 'text',
        x: worldPos.x,
        y: worldPos.y,
        text: text,
        color: this.currentColor,
        fontSize: 22,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      };
      this.history.getCurrentElements().push(textElement);
    }

    this.history.recordChange();
    this.activeTextElement = null;
    this.redrawMain();
  }

  // ===== 便利貼工具 (Sticky Notes) =====

  createStickyNote(worldPos) {
    const noteColor = this.stickyColors[this.stickyColorIndex % this.stickyColors.length];
    this.stickyColorIndex++;

    const note = {
      type: 'sticky',
      x: worldPos.x - 90,
      y: worldPos.y - 70,
      width: 180,
      height: 140,
      color: noteColor,
      text: '課堂備忘 / 重點提示\n(點擊可移動)'
    };

    this.history.getCurrentElements().push(note);
    this.history.recordChange();
    this.redrawMain();
  }

  // ===== 圖片處理 (Paste / Upload / Drag & Drop) =====

  addImageElement(img, worldPos = null) {
    if (!worldPos) {
      // 放置於當前視窗中心
      worldPos = this.engine.screenToWorld(this.engine.width / 2, this.engine.height / 2);
    }

    // 限制圖片最大寬高不超過 600px，保持長寬比
    const maxDimension = 500;
    let w = img.naturalWidth || img.width || 400;
    let h = img.naturalHeight || img.height || 300;
    if (w > maxDimension || h > maxDimension) {
      if (w > h) {
        h = (h / w) * maxDimension;
        w = maxDimension;
      } else {
        w = (w / h) * maxDimension;
        h = maxDimension;
      }
    }

    const imgElement = {
      type: 'image',
      x: worldPos.x - w / 2,
      y: worldPos.y - h / 2,
      width: w,
      height: h,
      img: img,
      src: img.src
    };

    this.history.getCurrentElements().push(imgElement);
    this.history.recordChange();
    this.redrawMain();
  }

  // ===== 物件選取與移動 =====

  getElementBounds(el) {
    if (!el) return { x: 0, y: 0, width: 40, height: 40 };

    if (el.x !== undefined && el.width !== undefined) {
      return {
        x: el.x,
        y: el.y,
        width: Math.max(16, el.width),
        height: Math.max(16, el.height || 40)
      };
    }
    if (el.cx !== undefined) {
      const rx = Math.abs(el.rx || el.r || 40);
      const ry = Math.abs(el.ry || el.r || 40);
      return {
        x: el.cx - rx,
        y: el.cy - ry,
        width: Math.max(16, rx * 2),
        height: Math.max(16, ry * 2)
      };
    }
    if (el.x1 !== undefined && el.x2 !== undefined) {
      const minX = Math.min(el.x1, el.x2);
      const minY = Math.min(el.y1, el.y2);
      return {
        x: minX,
        y: minY,
        width: Math.max(16, Math.abs(el.x2 - el.x1)),
        height: Math.max(16, Math.abs(el.y2 - el.y1))
      };
    }
    if (el.points && el.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return {
        x: minX,
        y: minY,
        width: Math.max(16, maxX - minX),
        height: Math.max(16, maxY - minY)
      };
    }
    return { x: el.x || 0, y: el.y || 0, width: el.width || 120, height: el.height || 40 };
  }

  isPointInOrNearShape(shape, pos, threshold) {
    const shapeType = shape.shapeType || shape.type;
    switch (shapeType) {
      case 'rect':
      case 'coordinate': {
        const bounds = this.getElementBounds(shape);
        return pos.x >= bounds.x - threshold && pos.x <= bounds.x + bounds.width + threshold &&
               pos.y >= bounds.y - threshold && pos.y <= bounds.y + bounds.height + threshold;
      }

      case 'circle': {
        const dist = Math.hypot(pos.x - shape.cx, pos.y - shape.cy);
        return dist <= (shape.r || 40) + threshold;
      }

      case 'ellipse': {
        const rx = (Math.abs(shape.rx) || 40) + threshold;
        const ry = (Math.abs(shape.ry) || 40) + threshold;
        return (((pos.x - shape.cx) ** 2) / (rx ** 2) + ((pos.y - shape.cy) ** 2) / (ry ** 2)) <= 1;
      }

      case 'line':
      case 'arrow':
      case 'double_arrow': {
        const dx = shape.x2 - shape.x1;
        const dy = shape.y2 - shape.y1;
        const len = Math.hypot(dx, dy) || 1;
        const dist = Math.abs(dy * pos.x - dx * pos.y + shape.x2 * shape.y1 - shape.y2 * shape.x1) / len;
        const inBounds = pos.x >= Math.min(shape.x1, shape.x2) - threshold &&
                         pos.x <= Math.max(shape.x1, shape.x2) + threshold &&
                         pos.y >= Math.min(shape.y1, shape.y2) - threshold &&
                         pos.y <= Math.max(shape.y1, shape.y2) + threshold;
        return dist <= threshold && inBounds;
      }

      case 'triangle': {
        const bounds = this.getElementBounds(shape);
        return pos.x >= bounds.x - threshold && pos.x <= bounds.x + bounds.width + threshold &&
               pos.y >= bounds.y - threshold && pos.y <= bounds.y + bounds.height + threshold;
      }

      default:
        return false;
    }
  }

  findElementAt(worldPos) {
    const elements = this.history.getCurrentElements();
    const threshold = 12 / this.engine.scale;

    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];

      // 1. 便利貼、圖片、文字
      if (el.type === 'sticky' || el.type === 'image' || el.type === 'text') {
        const bounds = this.getElementBounds(el);
        if (worldPos.x >= bounds.x - threshold && worldPos.x <= bounds.x + bounds.width + threshold &&
            worldPos.y >= bounds.y - threshold && worldPos.y <= bounds.y + bounds.height + threshold) {
          return el;
        }
      }

      // 2. 幾何圖形 (支援矩形、圓形、橢圓、直線、箭頭、雙向箭頭、三角形、坐標系)
      if (el.type === 'shape' || el.shapeType) {
        if (this.isPointInOrNearShape(el, worldPos, threshold)) {
          return el;
        }
      }

      // 3. 自由手寫筆跡
      if (el.type === 'stroke' && el.points && el.points.length > 0) {
        const strokeThreshold = threshold + (el.width || 3) / 2;
        const hit = el.points.some(p => Math.hypot(p.x - worldPos.x, p.y - worldPos.y) <= strokeThreshold);
        if (hit) return el;
      }
    }
    return null;
  }

  moveElement(el, dx, dy) {
    if (el.x !== undefined) el.x += dx;
    if (el.y !== undefined) el.y += dy;
    if (el.cx !== undefined) el.cx += dx;
    if (el.cy !== undefined) el.cy += dy;
    if (el.x1 !== undefined) { el.x1 += dx; el.x2 += dx; }
    if (el.y1 !== undefined) { el.y1 += dy; el.y2 += dy; }
    if (el.points) {
      for (const p of el.points) {
        p.x += dx;
        p.y += dy;
      }
    }
  }

  // ===== 主畫布全量重繪 (Redraw Main Canvas) =====

  redrawMain() {
    const ctx = this.engine.mainCtx;
    this.engine.clearMain();
    this.engine.applyTransform(ctx);

    const elements = this.history.getCurrentElements();

    for (const el of elements) {
      ctx.save();

      if (el.type === 'stroke') {
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (el.tool === 'highlighter') {
          ctx.globalAlpha = 0.35;
        }

        this.drawSmoothStroke(ctx, el.points);
      } else if (el.type === 'shape' || el.shapeType) {
        ShapeRenderer.drawShape(ctx, {
          ...el,
          type: el.shapeType || el.type
        });
      } else if (el.type === 'text') {
        ctx.font = `${el.fontSize || 22}px ${el.fontFamily || 'sans-serif'}`;
        ctx.fillStyle = el.color;
        const lines = el.text.split('\n');
        const lineHeight = (el.fontSize || 22) * 1.35;
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], el.x, el.y + (i + 1) * lineHeight);
        }
      } else if (el.type === 'sticky') {
        this.drawStickyNote(ctx, el);
      } else if (el.type === 'image') {
        if (el.img && el.img.complete) {
          ctx.drawImage(el.img, el.x, el.y, el.width, el.height);
        }
      }

      ctx.restore();
    }

    // 繪製被選取物件的外框
    if (this.selectedElement && this.currentTool === 'select') {
      this.drawSelectionBox(ctx, this.selectedElement);
    }
  }

  drawSmoothStroke(ctx, points) {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  drawStickyNote(ctx, note) {
    const { x, y, width, height, color, text } = note;
    const foldSize = 18;

    // 陰影
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // 便利貼多邊形本體 (右下角折角)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.lineTo(x + width, y + height - foldSize);
    ctx.lineTo(x + width - foldSize, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 繪製折角陰影
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.beginPath();
    ctx.moveTo(x + width - foldSize, y + height - foldSize);
    ctx.lineTo(x + width, y + height - foldSize);
    ctx.lineTo(x + width - foldSize, y + height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 右上角刪除按鈕 (圓形 ✕ 符號，點擊即可刪除)
    ctx.save();
    const closeX = x + width - 16;
    const closeY = y + 16;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.beginPath();
    ctx.arc(closeX, closeY, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(closeX - 4, closeY - 4);
    ctx.lineTo(closeX + 4, closeY + 4);
    ctx.moveTo(closeX + 4, closeY - 4);
    ctx.lineTo(closeX - 4, closeY + 4);
    ctx.stroke();
    ctx.restore();

    // 便利貼文字
    ctx.save();
    ctx.fillStyle = '#1e293b';
    ctx.font = '14px sans-serif';
    const lines = (text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + 14, y + 26 + i * 20);
    }
    ctx.restore();
  }

  drawSelectionBox(ctx, el) {
    const bounds = this.getElementBounds(el);
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    const pad = 6;
    ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);

    // 繪製四角選取控制點錨點
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    const corners = [
      { x: bounds.x - pad, y: bounds.y - pad },
      { x: bounds.x + bounds.width + pad, y: bounds.y - pad },
      { x: bounds.x - pad, y: bounds.y + bounds.height + pad },
      { x: bounds.x + bounds.width + pad, y: bounds.y + bounds.height + pad }
    ];
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
