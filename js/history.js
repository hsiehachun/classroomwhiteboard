/**
 * history.js - 復原 (Undo) 與重做 (Redo) 歷史記錄管理
 */

export class HistoryManager {
  constructor(pageManager) {
    this.pageManager = pageManager;
    this.maxHistory = 40;
    this.onStateChange = null;
  }

  getCurrentPage() {
    return this.pageManager.getCurrentPage();
  }

  getCurrentElements() {
    const page = this.getCurrentPage();
    return page ? page.elements : [];
  }

  /**
   * 記錄當前狀態變更 (入棧)
   */
  recordChange() {
    const page = this.getCurrentPage();
    if (!page) return;

    // 清空未來的 redo 棧
    page.redoStack = [];

    // 將深拷貝後的 elements 推入 undo 棧
    const snapshot = JSON.stringify(this.serializeElements(page.elements));
    page.undoStack.push(snapshot);

    if (page.undoStack.length > this.maxHistory) {
      page.undoStack.shift();
    }

    if (this.onStateChange) this.onStateChange();
    this.pageManager.saveToLocalStorage();
  }

  undo() {
    const page = this.getCurrentPage();
    if (!page || page.undoStack.length === 0) return false;

    // 當前畫面存入 redo 棧
    const currentSnapshot = JSON.stringify(this.serializeElements(page.elements));
    page.redoStack.push(currentSnapshot);

    // 從 undo 棧取出上一狀態
    const prevSnapshot = page.undoStack.pop();
    page.elements = this.deserializeElements(JSON.parse(prevSnapshot));

    if (this.onStateChange) this.onStateChange();
    this.pageManager.saveToLocalStorage();
    return true;
  }

  redo() {
    const page = this.getCurrentPage();
    if (!page || page.redoStack.length === 0) return false;

    // 當前畫面存入 undo 棧
    const currentSnapshot = JSON.stringify(this.serializeElements(page.elements));
    page.undoStack.push(currentSnapshot);

    // 從 redo 棧取出下一狀態
    const nextSnapshot = page.redoStack.pop();
    page.elements = this.deserializeElements(JSON.parse(nextSnapshot));

    if (this.onStateChange) this.onStateChange();
    this.pageManager.saveToLocalStorage();
    return true;
  }

  canUndo() {
    const page = this.getCurrentPage();
    return page ? page.undoStack.length > 0 : false;
  }

  canRedo() {
    const page = this.getCurrentPage();
    return page ? page.redoStack.length > 0 : false;
  }

  clear() {
    const page = this.getCurrentPage();
    if (!page) return;
    this.recordChange();
    page.elements = [];
    if (this.onStateChange) this.onStateChange();
    this.pageManager.saveToLocalStorage();
  }

  serializeElements(elements) {
    return elements.map(el => {
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
    });
  }

  deserializeElements(serialized) {
    return serialized.map(el => {
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
}
