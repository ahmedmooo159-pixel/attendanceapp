/**
 * Audio feedback generator using Web Audio API
 * No external MP3 files required - works 100% reliably offline.
 * Unlocks AudioContext on first user gesture for iOS Safari compatibility.
 * Guards navigator.vibrate and never blocks attendance flow.
 */
class SoundEffects {
  constructor() {
    this.audioCtx = null;
    this.isUnlocked = false;
    this.setupGestureUnlock();
  }

  setupGestureUnlock() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const unlockEvents = ['click', 'touchstart', 'touchend', 'keydown'];
    const unlockHandler = () => {
      this.unlockAudio();
      unlockEvents.forEach(evt => {
        try {
          document.removeEventListener(evt, unlockHandler);
        } catch (e) {}
      });
    };

    unlockEvents.forEach(evt => {
      try {
        document.addEventListener(evt, unlockHandler, { once: true, passive: true });
      } catch (e) {
        document.addEventListener(evt, unlockHandler);
      }
    });
  }

  unlockAudio() {
    try {
      this.initContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().then(() => {
          this.isUnlocked = true;
        }).catch(() => {});
      } else if (this.audioCtx && this.audioCtx.state === 'running') {
        this.isUnlocked = true;
      }
    } catch (e) {
      // Never throw
    }
  }

  initContext() {
    try {
      if (!this.audioCtx && typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      // Never throw or block
    }
  }

  safeVibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch (e) {
      // Ignore vibration errors completely
    }
  }

  // Play a welcoming two-tone chime for Check-in (تسجيل حضور)
  playCheckInSuccess() {
    try {
      this.initContext();
      if (!this.audioCtx) {
        this.safeVibrate([100, 50, 100]);
        return;
      }

      const now = this.audioCtx.currentTime;
      
      // Note 1 (E5)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2 (B5)
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.12);
      gain2.gain.setValueAtTime(0.2, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.65);

      this.safeVibrate([100, 50, 100]);
    } catch (e) {
      // Never block attendance flow
      console.warn('Audio play error (non-fatal):', e);
    }
  }

  // Play an accomplished harmonic chime for Check-out (تسجيل انصراف)
  playCheckOutSuccess() {
    try {
      this.initContext();
      if (!this.audioCtx) {
        this.safeVibrate([150, 80, 250]);
        return;
      }

      const now = this.audioCtx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major arpeggio

      notes.forEach((freq, index) => {
        const startTime = now + (index * 0.1);
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.4);
      });

      this.safeVibrate([150, 80, 250]);
    } catch (e) {
      // Never block attendance flow
      console.warn('Audio play error (non-fatal):', e);
    }
  }

  // Error buzz
  playError() {
    try {
      this.initContext();
      if (!this.audioCtx) {
        this.safeVibrate([300, 100, 300]);
        return;
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.15);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);

      this.safeVibrate([300, 100, 300]);
    } catch (e) {
      // Never block attendance flow
      console.warn('Audio play error (non-fatal):', e);
    }
  }
}

if (typeof window !== 'undefined') {
  window.SoundEffects = SoundEffects;
  window.soundEffects = new SoundEffects();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SoundEffects };
}
