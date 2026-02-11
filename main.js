// We need a map from keys to frequencies.
const keyboardFrequencyMap = {
    '90': 261.625565300598634,  //Z - C
    '83': 277.182630976872096, //S - C#
    '88': 293.664767917407560,  //X - D
    '68': 311.126983722080910, //D - D#
    '67': 329.627556912869929,  //C - E
    '86': 349.228231433003884,  //V - F
    '71': 369.994422711634398, //G - F#
    '66': 391.995435981749294,  //B - G
    '72': 415.304697579945138, //H - G#
    '78': 440.000000000000000,  //N - A
    '74': 466.163761518089916, //J - A#
    '77': 493.883301256124111,  //M - B
    '81': 523.251130601197269,  //Q - C
    '50': 554.365261953744192, //2 - C#
    '87': 587.329535834815120,  //W - D
    '51': 622.253967444161821, //3 - D#
    '69': 659.255113825739859,  //E - E
    '82': 698.456462866007768,  //R - F
    '53': 739.988845423268797, //5 - F#
    '84': 783.990871963498588,  //T - G
    '54': 830.609395159890277, //6 - G#
    '89': 880.000000000000000,  //Y - A
    '55': 932.327523036179832, //7 - A#
    '85': 987.766602512248223,  //U - B
}

// To start, we initialize an audio context. We setup a gain node, and give ourselves a bit of room to avoid clipping
document.addEventListener("DOMContentLoaded", function(event) {

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const globalGain = audioCtx.createGain();
    globalGain.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // Normalization to prevent clipping when multiple voices play
    const normalizeGain = audioCtx.createGain();
    const baseMasterGain = 0.8; // maximum level
    normalizeGain.gain.setValueAtTime(baseMasterGain, audioCtx.currentTime);
    globalGain.connect(normalizeGain);
    normalizeGain.connect(audioCtx.destination);

    // analyser node to monitor output amplitude
    const globalAnalyser = audioCtx.createAnalyser();
    normalizeGain.connect(globalAnalyser);

    let currentWaveform = 'sine';
    let currentMode = 'Additive';
    const memFadeSec = 1; // seconds for color memory fade
    const memMap = {}; // map key code -> color overlay element

    // Simple oscillator for synthesis experiments EXPERIMENTAL
    let simpleOscillator = null;
    const cFrequency = 261.625565300598634; // C

    function freqToHue(freq) {
        // map frequency (log) into 0..360 hue range using expected piano range
        const minF = 130.8127826502993; // C3
        const maxF = 987.7666025122482; // B5
        const v = (Math.log(freq) - Math.log(minF)) / (Math.log(maxF) - Math.log(minF));
        return Math.round(((v % 1) + 1) * 360) % 360;
    }

    const keyboardDiv = document.querySelector(".keyboard");

    const keys = [
    { label: "C", code: "90" },
    { label: "C#", code: "83" },
    { label: "D", code: "88" },
    { label: "D#", code: "68" },
    { label: "E", code: "67" },
    { label: "F", code: "86" },
    { label: "F#", code: "71" },
    { label: "G", code: "66" },
    { label: "G#", code: "72" },
    { label: "A", code: "78" },
    { label: "A#", code: "74" },
    { label: "B", code: "77" },
    { label: "C", code: "81" },
    { label: "C#", code: "50" },
    { label: "D", code: "87" },
    { label: "D#", code: "51" },
    { label: "E", code: "69" },
    { label: "F", code: "82" },
    { label: "F#", code: "53" },
    { label: "G", code: "84" },
    { label: "G#", code: "54" },
    { label: "A", code: "89" },
    { label: "A#", code: "55" },
    { label: "B", code: "85" },
    ];

    keys.forEach(k => {
    const keyDiv = document.createElement("div");
    keyDiv.className = "key";
    keyDiv.dataset.key = k.code;
    keyDiv.style.position = 'relative';
    keyDiv.innerHTML = `<div>${k.label}</div>`;
    // create a color-memory overlay that will be faded out after release
    const mem = document.createElement('div');
    mem.className = 'mem';
    mem.style.position = 'absolute';
    mem.style.left = '0';
    mem.style.top = '0';
    mem.style.right = '0';
    mem.style.bottom = '0';
    mem.style.pointerEvents = 'none';
    mem.style.opacity = '0';
    mem.style.transition = `opacity ${memFadeSec}s ease`;
    mem.style.zIndex = '2';
    keyDiv.appendChild(mem);
    memMap[k.code] = mem;
    keyDiv.style.zIndex = '1';
    keyboardDiv.appendChild(keyDiv);

    // Add click handlers to visual keys
    keyDiv.addEventListener('mousedown', () => {
        // resume AudioContext on first user gesture becuz audio context was showing as suspended
        const start = () => {
            if (!activeOscillators[k.code]) {
                playNote(k.code);
                keyDiv.classList.add('active');
                // set memory overlay color immediately
                const hue = freqToHue(keyboardFrequencyMap[k.code]);
                mem.style.background = `hsl(${hue},70%,50%)`;
                mem.style.transition = `opacity ${memFadeSec}s ease, background-color 0.05s linear`;
                mem.style.opacity = '1';
            }
        };
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(start);
        } else {
            start();
        }
    });

    keyDiv.addEventListener('mouseup', () => {
        if (activeOscillators[k.code]) {
            const notes = activeOscillators[k.code];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel pending automations to avoid clicks
            notes.gain.gain.cancelScheduledValues(releaseStartTime);
            const currentGain = notes.gain.gain.value;
            notes.gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
            // Release: linear ramp to 0
            notes.gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            
            // Stop oscillator(s) just after release completes
            if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            } else if (notes.osc) {
                notes.osc.stop(releaseStartTime + releaseTime + 0.01);
            }
            
            delete activeOscillators[k.code];
            updateNormalization();
            keyDiv.classList.remove('active');
            // start fading the memory overlay (leave color, fade opacity)
            mem.style.transition = `opacity ${memFadeSec}s ease`;
            // ensure visible then fade
            mem.style.opacity = '1';
            requestAnimationFrame(() => { mem.style.opacity = '0'; });
        }
    });

    keyDiv.addEventListener('mouseleave', () => {
        if (activeOscillators[k.code]) {
            const notes = activeOscillators[k.code];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel pending automations to avoid clicks
            notes.gain.gain.cancelScheduledValues(releaseStartTime);
            const currentGain = notes.gain.gain.value;
            notes.gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
            // Release: linear ramp to 0
            notes.gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            
            // Stop oscillator(s) just after release completes
            if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            } else if (notes.osc) {
                notes.osc.stop(releaseStartTime + releaseTime + 0.01);
            }
            
            delete activeOscillators[k.code];
            updateNormalization();
            keyDiv.classList.remove('active');
            mem.style.transition = `opacity ${memFadeSec}s ease`;
            mem.style.opacity = '1';
            requestAnimationFrame(() => { mem.style.opacity = '0'; });
        }
    });
    });


    // Add listener to waveform selector
    const waveformSelect = document.querySelector('select[name="waveform"]');
    if (waveformSelect) {
        waveformSelect.addEventListener('change', (e) => {
            currentWaveform = e.target.value;
        });
    }

    // Add listener to synthesis selector
    const synthesisSelect = document.querySelector('select[name="synthesis"]');
    if (synthesisSelect) {
        synthesisSelect.addEventListener('change', (e) => {
            currentMode = e.target.value;
        });
    }

    // Add listeners for play/stop buttons - EXPERIMENTAL
    const playButton = document.querySelector('#playButton');
    const stopButton = document.querySelector('#stopButton');

    if (playButton) {
        playButton.addEventListener('click', () => {
            if (!simpleOscillator) {
                const now = audioCtx.currentTime;
                
                // Create oscillator, modutor, and gain nodes
                carrier = audioCtx.createOscillator();
                modulator = audioCtx.createOscillator();
                
                carrier.frequency.value = cFrequency;
                carrier.type = currentWaveform;

                modulator.frequency.value = cFrequency * 0.5; // modulator at half the frequency of carrier for audible effect
                modulator.type = currentWaveform;

                depth = audioCtx.createGain();
                depth.gain.value = 0.5;
                modulated = audioCtx.createGain();
                modulated.gain.value = 1.0 - depth.gain.value;

                
                modulator.connect(depth).connect(modulated.gain);
                carrier.connect(modulated);

                //ADSR envelope
                envelope = audioCtx.createGain();
                envelope.gain.setValueAtTime(0, now);
                
                modulated.connect(envelope);
                envelope.connect(globalGain);

                // Start the oscillators
                carrier.start();
                modulator.start();

                //ADSR envelope
                const attackTime = 0.2;
                const decayTime = 0.3;
                const sustainLevel = 0.3;
                const maxGain = 0.4;

                envelope.gain.setTargetAtTime(maxGain, now, attackTime);
                envelope.gain.setTargetAtTime(sustainLevel, now + attackTime, decayTime);

                playButton.disabled = true;
                stopButton.disabled = false;
            }
        });
    }

    if (stopButton) {
        stopButton.addEventListener('click', () => {
            if (carrier && modulator && envelope) {
                const now = audioCtx.currentTime;
                
                // Release
                const releaseTime = 0.12;
                const releaseStartTime = audioCtx.currentTime;

                // Cancel any pending automations (attack/decay) to avoid clicks
                envelope.gain.cancelScheduledValues(releaseStartTime);

                // Release: linear ramp from current to 0
                envelope.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);

                // Stop oscillator just after release completes
                modulator.stop(releaseStartTime + releaseTime + 0.01);
                carrier.stop(releaseStartTime + releaseTime + 0.01);
                
                playButton.disabled = false;
                stopButton.disabled = true;
            }
        });
    }

    // Next we add listeners to the keys. These will add and remove activeOscillators.
    window.addEventListener('keydown', keyDown, false);
    window.addEventListener('keyup', keyUp, false);

    activeOscillators = {} // will store {osc, gain} for each key

    // Update normalization gain based on number of active voices to avoid clipping.
    function updateNormalization() {
        const n = Object.keys(activeOscillators).length || 1;
        const scale = baseMasterGain / Math.max(1, n);
        // smooth the change slightly to avoid clicks
        normalizeGain.gain.cancelScheduledValues(audioCtx.currentTime);
        normalizeGain.gain.setTargetAtTime(scale, audioCtx.currentTime, 0.5);
    }

    // Amplitude monitoring
    let maxAllTime = 0;
    const analyser = globalAnalyser;
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function monitorAmplitude() {
        analyser.getByteTimeDomainData(dataArray);
        // values range 0-255, midpoint 128 -> scale to -1..1
        const peak = (dataArray.reduce((m, v) => (v > m ? v : m), 0) - 128) / 127.0;
        if (peak > maxAllTime) {
            maxAllTime = peak;
            console.log('[AMPLITUDE] New record peak =', maxAllTime.toFixed(3));
        }
        if (peak > 0.95) {
            console.warn('[AMPLITUDE] WARNING current peak approaching 1.0 ->', peak.toFixed(3));
        }
        // continue monitoring
        requestAnimationFrame(monitorAmplitude);
    }

    monitorAmplitude();

    function keyDown(event) {
        // Resume AudioContext on first user gesture becuz audio context was showing as suspended
        const proceed = () => {
            const key = (event.detail || event.which).toString();
            if (keyboardFrequencyMap[key] && !activeOscillators[key]) {
                playNote(key);
                // Highlight the visual key
                const keyDiv = document.querySelector(`[data-key="${key}"]`);
                if (keyDiv) {
                    keyDiv.classList.add('active');
                    const mem = memMap[key];
                    if (mem) {
                        const hue = freqToHue(keyboardFrequencyMap[key]);
                        mem.style.background = `hsl(${hue},70%,50%)`;
                        mem.style.transition = `opacity ${memFadeSec}s ease, background-color 0.05s linear`;
                        mem.style.opacity = '1';
                    }
                }
            }
        };
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(proceed);
        } else {
            proceed();
        }
    }

    function keyUp(event) {
        const key = (event.detail || event.which).toString();
        if (keyboardFrequencyMap[key] && activeOscillators[key]) {
            const notes = activeOscillators[key];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel any pending automations (attack/decay) to avoid clicks
            notes.gain.gain.cancelScheduledValues(releaseStartTime);
            
            // Capture current gain value and release from there
            const currentGain = notes.gain.gain.value;
            notes.gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
            // Release: linear ramp from current to 0
            notes.gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            
            // Stop oscillator(s) just after release completes
            // Handle additive synthesis (multiple oscillators)
            if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            } 
            // Handle other synthesis modes (single oscillator)
            else if (notes.osc) {
                notes.osc.stop(releaseStartTime + releaseTime + 0.01);
            }
            
            delete activeOscillators[key];
            updateNormalization();
            
            // Remove highlight from the visual key
            const keyDiv = document.querySelector(`[data-key="${key}"]`);
            if (keyDiv) keyDiv.classList.remove('active');
            const mem = memMap[key];
            if (mem) {
                mem.style.transition = `opacity ${memFadeSec}s ease`;
                mem.style.opacity = '1';
                requestAnimationFrame(() => { mem.style.opacity = '0'; });
            }
        }
    }

    // Dispatcher function to route to the appropriate synthesis mode
    function playNote(key) {
        if (currentMode === 'Additive') {
            playNoteAdditive(key);
        } else if (currentMode === 'AM') {
            playNoteAM(key);
        } else if (currentMode === 'FM') {
            playNoteFM(key);
        } else if (currentMode === 'None') {
            playNoteNone(key);
        }
    }

    // ============================================
    // ADDITIVE SYNTHESIS
    // ============================================
    function playNoteAdditive(key) {
        const now = audioCtx.currentTime;

        // Create oscillator and gain nodes
        oscillator1 = audioCtx.createOscillator();
        oscillator2 = audioCtx.createOscillator();
        oscillator3 = audioCtx.createOscillator();
        gain1 = audioCtx.createGain();
        gain2 = audioCtx.createGain();
        gain3 = audioCtx.createGain();

        oscillator1.frequency.setValueAtTime(keyboardFrequencyMap[key], now);
        oscillator1.type = currentWaveform;

        oscillator2.frequency.setValueAtTime(keyboardFrequencyMap[key] * 2, now);
        oscillator2.type = currentWaveform;

        oscillator3.frequency.setValueAtTime(keyboardFrequencyMap[key] * 3, now);
        oscillator3.type = currentWaveform;

        // Set gain, control individual amplitude
        gain1.gain.setValueAtTime(0.75, now);
        gain2.gain.setValueAtTime(0.2, now);
        gain3.gain.setValueAtTime(0.05, now);
                
        // Connect the oscillators
        oscillator1.connect(gain1);
        oscillator2.connect(gain2);
        oscillator3.connect(gain3);

        // envelope for overall control
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        gain1.connect(envelope);
        gain2.connect(envelope);
        gain3.connect(envelope);
        
        // Connect through globalGain and normalizeGain to properly handle multiple voices
        envelope.connect(globalGain);

        //ADSR envelope
        const attackTime = 0.2;
        const decayTime = 0.3;
        const sustainLevel = 0.3;
        const maxGain = 0.4;

        envelope.gain.setTargetAtTime(maxGain, now, attackTime);
        envelope.gain.setTargetAtTime(sustainLevel, now + attackTime, decayTime);

        // Start the oscillators
        oscillator1.start();
        oscillator2.start();
        oscillator3.start();

        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {osc1: oscillator1, osc2: oscillator2, osc3: oscillator3, gain: envelope, sustainLevel: 0.3}
        updateNormalization();
    }

    // ============================================
    // AM SYNTHESIS
    // ============================================
    function playNoteAM(key) {
        // TODO: Implement AM (Amplitude Modulation) synthesis
        const now = audioCtx.currentTime;
                
        // Create carrier, modutor, and gain nodes
        carrier = audioCtx.createOscillator();
        modulator = audioCtx.createOscillator();
                
        carrier.frequency.value = keyboardFrequencyMap[key];
        carrier.type = currentWaveform;
        modulator.frequency.value = keyboardFrequencyMap[key] * 0.5; // modulator at half the frequency of carrier for audible effect
        modulator.type = currentWaveform;

        depth = audioCtx.createGain();
        depth.gain.value = 0.5;
        modulated = audioCtx.createGain();
        modulated.gain.value = 1.0 - depth.gain.value;

        modulator.connect(depth).connect(modulated.gain);
        carrier.connect(modulated);

        //ADSR envelope
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        modulated.connect(envelope);
        envelope.connect(globalGain);

        //ADSR envelope
        const attackTime = 0.2;
        const decayTime = 0.3;
        const sustainLevel = 0.3;
        const maxGain = 0.4;

        envelope.gain.setTargetAtTime(maxGain, now, attackTime);
        envelope.gain.setTargetAtTime(sustainLevel, now + attackTime, decayTime);

        // Start the oscillators
        carrier.start();
        modulator.start();

        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {oscCarr: carrier, oscMod: modulator, gain: envelope, sustainLevel: 0.3}
        updateNormalization();
    }

    // ============================================
    // FM SYNTHESIS
    // ============================================
    function playNoteFM(key) {
        // TODO: Implement FM (Frequency Modulation) synthesis
        // Should create carrier and modulator oscillators
        
        const now = audioCtx.currentTime;
        const noteGain = audioCtx.createGain();
        noteGain.gain.setValueAtTime(0.3, now);
        noteGain.connect(globalGain);
        
        // Placeholder: store dummy oscillator for now
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(keyboardFrequencyMap[key], now);
        osc.type = currentWaveform;
        osc.connect(noteGain);
        osc.start();
        
        activeOscillators[key] = {osc, gain: noteGain, sustainLevel: 0.3}
        updateNormalization();
    }

    // ============================================
    // NONE SYNTHESIS (Simple single oscillator)
    // ============================================
    function playNoteNone(key) {
        // ADSR parameters
        const attackTime = 0.2;
        const decayTime = 0.3;
        const sustainLevel = 0.3;
        const maxGain = 0.4;
        
        // create gain node for this note
        const noteGain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        
        // start at 0, then execute ADSR
        noteGain.gain.setValueAtTime(0, now);
        
        // Attack: 0 -> maxGain with exponential ramp
        noteGain.gain.setTargetAtTime(maxGain, now, attackTime);
        
        // Decay: maxGain -> sustainLevel (start after attack completes)
        noteGain.gain.setTargetAtTime(sustainLevel, now + attackTime, decayTime);
        
        // hold sustain level
        
        noteGain.connect(globalGain);
        //console.log(`[CONNECT] noteGain -> globalGain at ${now.toFixed(3)}s`);
        
        // Create and configure oscillator
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(keyboardFrequencyMap[key], now)
        osc.type = currentWaveform;
        osc.connect(noteGain);
        osc.start();
        
        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {osc, gain: noteGain, sustainLevel}
        //console.log(`[VOICE ON] key=${key} active=${Object.keys(activeOscillators).length}`);
        updateNormalization();
    }
})
