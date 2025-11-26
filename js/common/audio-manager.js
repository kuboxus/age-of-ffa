const AudioManager = {
    ctx: null,
    sounds: {},
    muted: false,

    init: function() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.muted = localStorage.getItem('aow_muted') === 'true';
            this.updateMuteButton();
        } catch(e) {
            console.log("Audio not supported");
        }
    },

    toggleMute: function() {
        this.muted = !this.muted;
        localStorage.setItem('aow_muted', this.muted);
        this.updateMuteButton();
        if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    updateMuteButton: function() {
        const btn = document.getElementById('mute-btn');
        if(btn) {
            btn.innerText = this.muted ? "🔇" : "🔊";
            btn.classList.toggle('opacity-50', this.muted);
        }
    },

    playSound: function(type) {
        if(this.muted || !this.ctx) return;
        
        // Resume context if needed (browsers block auto-play)
        if(this.ctx.state === 'suspended') this.ctx.resume();

        // Placeholder Synth Sounds (No assets required!)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        const now = this.ctx.currentTime;
        
        switch(type) {
            case 'shoot':
                // Pew Pew
                osc.type = 'square';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
                
            case 'hit':
                // Thud
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.1);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
                
            case 'spawn':
                // Ding
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
                break;

            case 'explosion':
                // Noise-ish
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
                
            case 'levelUp':
                // Fanfare
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.setValueAtTime(554, now + 0.1);
                osc.frequency.setValueAtTime(659, now + 0.2);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.linearRampToValueAtTime(0, now + 0.6);
                osc.start(now);
                osc.stop(now + 0.6);
                break;
        }
    }
};

