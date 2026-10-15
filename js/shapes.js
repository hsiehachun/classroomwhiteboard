/**
 * shapes.js - 幾何圖形繪製與智慧手繪形狀辨識 (Smart Shape Recognizer)
 * 靈感來自 Ziteboard 的智慧圖形規整技術
 */

export class ShapeRecognizer {
  /**
   * 分析徒手繪製的路徑，判斷是否為幾何圖形 (圓形/橢圓、直線、矩形、三角形)
   * @param {Array<{x: number, y: number}>} points 筆畫點集
   * @returns {Object|null} 辨識結果或 null
   */
  static recognize(points) {
    if (!points || points.length < 8) return null;

    const totalLen = this.getPathLength(points);
    if (totalLen < 30) return null; // 太短不處理

    const pStart = points[0];
    const pEnd = points[points.length - 1];
    const startEndDist = Math.hypot(pEnd.x - pStart.x, pEnd.y - pStart.y);
    const isClosed = (startEndDist / totalLen) < 0.22;

    // 1. 檢查是否為直線 (Collinear check)
    if (!isClosed) {
      const lineFit = this.checkStraightLine(points);
      if (lineFit) {
        return {
          type: 'line',
          x1: pStart.x,
          y1: pStart.y,
          x2: pEnd.x,
          y2: pEnd.y
        };
      }
    }

    // 計算邊界框 (Bounding Box)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    if (width < 20 || height < 20) return null;

    // 2. 檢查是否為閉合圖形 (圓形 / 橢圓 / 矩形 / 三角形)
    if (isClosed) {
      // 2.1 圓形 / 橢圓檢測
      const circleFit = this.checkCircleOrEllipse(points, cx, cy, width, height);
      if (circleFit) {
        return circleFit;
      }

      // 2.2 簡化多邊形頂點檢測 (Douglas-Peucker)
      const simplified = this.douglasPeucker(points, totalLen * 0.04);
      // 若頂點扣除頭尾閉合點約 3 或 4 個
      const cornerCount = simplified.length - 1;

      if (cornerCount === 3) {
        return {
          type: 'triangle',
          points: [simplified[0], simplified[1], simplified[2]]
        };
      } else if (cornerCount === 4 || cornerCount === 5) {
        // 矩形檢測
        const rectFit = this.checkRectangle(points, minX, minY, width, height);
        if (rectFit) {
          return {
            type: 'rect',
            x: minX,
            y: minY,
            width: width,
            height: height
          };
        }
      }
    }

    return null;
  }

  static getPathLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  }

  static checkStraightLine(points) {
    const p1 = points[0];
    const p2 = points[points.length - 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lineLen = Math.hypot(dx, dy);
    if (lineLen < 20) return false;

    let maxDist = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      // 點到直線距離公式
      const dist = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / lineLen;
      if (dist > maxDist) maxDist = dist;
    }

    // 偏離容許度小於 6% 的直線長度，或小於 14px
    return maxDist < Math.max(14, lineLen * 0.07);
  }

  static checkCircleOrEllipse(points, cx, cy, width, height) {
    const rx = width / 2;
    const ry = height / 2;
    const aspectRatio = Math.min(rx, ry) / Math.max(rx, ry);

    let varianceSum = 0;
    for (const p of points) {
      // 橢圓方程 normalized distance: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 應接近 1
      const normalizedDist = Math.hypot((p.x - cx) / (rx || 1), (p.y - cy) / (ry || 1));
      varianceSum += Math.abs(normalizedDist - 1);
    }
    const avgVariance = varianceSum / points.length;

    if (avgVariance < 0.22) {
      if (aspectRatio > 0.8) {
        // 近似完美圓形
        const r = (rx + ry) / 2;
        return {
          type: 'circle',
          cx: cx,
          cy: cy,
          r: r
        };
      } else {
        // 橢圓
        return {
          type: 'ellipse',
          cx: cx,
          cy: cy,
          rx: rx,
          ry: ry
        };
      }
    }
    return null;
  }

  static checkRectangle(points, minX, minY, width, height) {
    // 檢查點是否大多分布於外框四條邊界附近
    let edgeDevSum = 0;
    for (const p of points) {
      const distToLeft = Math.abs(p.x - minX);
      const distToRight = Math.abs(p.x - (minX + width));
      const distToTop = Math.abs(p.y - minY);
      const distToBottom = Math.abs(p.y - (minY + height));
      const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
      edgeDevSum += minDist;
    }
    const avgEdgeDev = edgeDevSum / points.length;
    return avgEdgeDev < Math.max(12, Math.min(width, height) * 0.18);
  }

  static douglasPeucker(points, epsilon) {
    if (points.length <= 2) return points;

    let dmax = 0;
    let index = 0;
    const p1 = points[0];
    const p2 = points[points.length - 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lineLen = Math.hypot(dx, dy) || 1;

    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const d = Math.abs(dy * p.x - dx * p.y + p2.x * p1.y - p2.y * p1.x) / lineLen;
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }

    if (dmax > epsilon) {
      const rec1 = this.douglasPeucker(points.slice(0, index + 1), epsilon);
      const rec2 = this.douglasPeucker(points.slice(index), epsilon);
      return rec1.slice(0, rec1.length - 1).concat(rec2);
    } else {
      return [p1, p2];
    }
  }
}

/**
 * 幾何圖形渲染器
 */
export class ShapeRenderer {
  static drawShape(ctx, shape, options = {}) {
    ctx.save();
    ctx.strokeStyle = shape.color || options.color || '#333333';
    ctx.lineWidth = shape.width || options.width || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.fill) {
      ctx.fillStyle = shape.fill;
    }

    switch (shape.type) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        break;

      case 'arrow':
        this.drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, false);
        break;

      case 'double_arrow':
        this.drawArrow(ctx, shape.x1, shape.y1, shape.x2, shape.y2, true);
        break;

      case 'rect':
        ctx.beginPath();
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
        if (shape.fill) ctx.fill();
        ctx.stroke();
        break;

      case 'circle':
        ctx.beginPath();
        ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        if (shape.fill) ctx.fill();
        ctx.stroke();
        break;

      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(shape.cx, shape.cy, Math.abs(shape.rx), Math.abs(shape.ry), 0, 0, Math.PI * 2);
        if (shape.fill) ctx.fill();
        ctx.stroke();
        break;

      case 'triangle':
        if (shape.points && shape.points.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(shape.points[0].x, shape.points[0].y);
          ctx.lineTo(shape.points[1].x, shape.points[1].y);
          ctx.lineTo(shape.points[2].x, shape.points[2].y);
          ctx.closePath();
          if (shape.fill) ctx.fill();
          ctx.stroke();
        }
        break;

      case 'coordinate':
        this.drawCoordinateSystem(ctx, shape);
        break;
    }

    ctx.restore();
  }

  static drawArrow(ctx, x1, y1, x2, y2, doubleEnded = false) {
    const headLength = Math.max(14, ctx.lineWidth * 3.5);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    // 主線條
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 終點箭頭
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.stroke();

    // 起點箭頭 (雙向)
    if (doubleEnded) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + headLength * Math.cos(angle - Math.PI / 6), y1 + headLength * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + headLength * Math.cos(angle + Math.PI / 6), y1 + headLength * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }

  static drawCoordinateSystem(ctx, shape) {
    const { x, y, width, height } = shape;
    const originX = x + width * 0.2;
    const originY = y + height * 0.8;

    // X 軸 (水平向右)
    this.drawArrow(ctx, x, originY, x + width, originY);
    // Y 軸 (垂直向上)
    this.drawArrow(ctx, originX, y + height, originX, y);

    // 標示 "X", "Y", "O"
    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillText('X', x + width - 12, originY + 18);
    ctx.fillText('Y', originX - 16, y + 14);
    ctx.fillText('O', originX - 14, originY + 14);
    ctx.restore();
  }
}
