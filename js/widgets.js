/**
 * widgets.js - 課堂專屬輔助工具 (課堂計時器、隨機學生抽籤器、音效合成)
 */

export class ClassroomWidgets {
  constructor() {
    this.timerInterval = null;
    this.timerSeconds = 180; // 預設 3 分鐘
    this.isTimerRunning = false;
    this.timerMode = 'countdown'; // 'countdown' | 'stopwatch'

    // 抽籤器狀態
    this.pickerInterval = null;
    this.pickerMaxNumber = 35;
    this.customNames = [];

    this.audioCtx = null;

    this.initAudio();
    this.initTimerUI();
    this.initPickerUI();
  }

  initAudio() {
    // 延遲初始化 Web Audio API
    const init = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
      window.removeEventListener('pointerdown', init);
      window.removeEventListener('keydown', init);
    };
    window.addEventListener('pointerdown', init);
    window.addEventListener('keydown', init);
  }

  // 播放提示鐘聲 (3 音和弦 C5 - E5 - G5)
  playChime() {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = this.audioCtx.currentTime + idx * 0.12;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.25, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.25);
    });
  }

  // 播放抽籤滾動點擊聲
  playTick() {
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 600 + Math.random() * 200;

    const t = this.audioCtx.currentTime;
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  // ===== 計時器 UI 與邏輯 =====

  initTimerUI() {
    this.timerDisplay = document.getElementById('timer-display');
    this.timerStartBtn = document.getElementById('timer-start-btn');
    this.updateTimerDisplay();

    // 增減時間按鈕
    document.getElementById('timer-add-1m')?.addEventListener('click', () => this.addTime(60));
    document.getElementById('timer-add-3m')?.addEventListener('click', () => this.addTime(180));
    document.getElementById('timer-add-5m')?.addEventListener('click', () => this.addTime(300));
    document.getElementById('timer-reset-btn')?.addEventListener('click', () => this.resetTimer());
    this.timerStartBtn?.addEventListener('click', () => this.toggleTimer());

    // 關閉按鈕
    document.getElementById('timer-close-btn')?.addEventListener('click', () => {
      document.getElementById('timer-window').classList.remove('show');
    });
  }

  updateTimerDisplay() {
    const mins = Math.floor(Math.abs(this.timerSeconds) / 60);
    const secs = Math.abs(this.timerSeconds) % 60;
    const str = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    if (this.timerDisplay) {
      this.timerDisplay.innerText = str;
    }
  }

  addTime(seconds) {
    this.timerSeconds += seconds;
    this.updateTimerDisplay();
  }

  resetTimer() {
    this.pauseTimer();
    this.timerSeconds = 180;
    this.updateTimerDisplay();
  }

  toggleTimer() {
    if (this.isTimerRunning) {
      this.pauseTimer();
    } else {
      this.startTimer();
    }
  }

  startTimer() {
    if (this.isTimerRunning) return;
    this.isTimerRunning = true;
    if (this.timerStartBtn) this.timerStartBtn.innerText = '暫停';

    this.timerInterval = setInterval(() => {
      if (this.timerSeconds > 0) {
        this.timerSeconds--;
        this.updateTimerDisplay();

        if (this.timerSeconds === 0) {
          this.pauseTimer();
          this.playChime();
          this.showToast('🔔 課堂計時結束！');
        }
      }
    }, 1000);
  }

  pauseTimer() {
    this.isTimerRunning = false;
    clearInterval(this.timerInterval);
    if (this.timerStartBtn) this.timerStartBtn.innerText = '開始';
  }

  // ===== 隨機抽籤器 UI 與邏輯 =====

  initPickerUI() {
    this.pickerResult = document.getElementById('picker-result');
    this.pickerBtn = document.getElementById('picker-start-btn');
    this.pickerInput = document.getElementById('picker-max-num');

    this.pickerBtn?.addEventListener('click', () => this.runLuckyDraw());

    document.getElementById('picker-close-btn')?.addEventListener('click', () => {
      document.getElementById('picker-window').classList.remove('show');
    });
  }

  runLuckyDraw() {
    if (this.pickerInterval) return;

    const max = parseInt(this.pickerInput?.value || '35', 10) || 35;
    let rollCount = 0;
    const totalRolls = 25;

    this.pickerBtn.disabled = true;
    this.pickerBtn.innerText = '抽籤中...';

    this.pickerInterval = setInterval(() => {
      rollCount++;
      const randNum = Math.floor(Math.random() * max) + 1;
      if (this.pickerResult) {
        this.pickerResult.innerText = `${randNum} 號`;
      }
      this.playTick();

      if (rollCount >= totalRolls) {
        clearInterval(this.pickerInterval);
        this.pickerInterval = null;
        this.pickerBtn.disabled = false;
        this.pickerBtn.innerText = '再次抽籤';
        this.playChime();
        this.showToast(`🎯 恭喜抽中：${this.pickerResult.innerText}！`);
      }
    }, 80);
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2500);
  }
}
