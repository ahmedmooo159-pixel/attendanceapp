/**
 * Audio feedback generator using Web Audio API
 * No external MP3 files required - works 100% reliably offline.
 */
class SoundEffects {
  constructor() {
    this.audioCtx = null;
  }

  initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Play a welcoming two-tone chime for Check-in (تسجيل حضور)
  playCheckInSuccess() {
    try {
      this.initContext();
      if (!this.audioCtx) return;

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

      // Vibration on mobile phones
      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Play an accomplished harmonic chime for Check-out (تسجيل انصراف)
  playCheckOutSuccess() {
    try {
      this.initContext();
      if (!this.audioCtx) return;

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

      if (navigator.vibrate) {
        navigator.vibrate([150, 80, 250]);
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Error buzz
  playError() {
    try {
      this.initContext();
      if (!this.audioCtx) return;

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

      if (navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }
}

window.soundEffects = new SoundEffects();
