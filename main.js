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
    const memFadeSec = 1; // seconds for color memory fade
    const memMap = {}; // map key code -> color overlay element

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
            const {osc, gain, sustainLevel} = activeOscillators[k.code];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel pending automations to avoid clicks
            gain.gain.cancelScheduledValues(releaseStartTime);
            const currentGain = gain.gain.value;
            gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
           // Release: linear ramp to 0
            gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            osc.stop(releaseStartTime + releaseTime + 0.01);
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
            const {osc, gain, sustainLevel} = activeOscillators[k.code];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel pending automations to avoid clicks
            gain.gain.cancelScheduledValues(releaseStartTime);
            const currentGain = gain.gain.value;
            gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
            gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            osc.stop(releaseStartTime + releaseTime + 0.01);
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
            //console.log('[AMPLITUDE] New record peak =', maxAllTime.toFixed(3));
        }
        if (peak > 0.95) {
            //console.warn('[AMPLITUDE] WARNING current peak approaching 1.0 ->', peak.toFixed(3));
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
            const {osc, gain, sustainLevel} = activeOscillators[key];
            const releaseTime = 0.12;
            const releaseStartTime = audioCtx.currentTime;
            
            // Cancel any pending automations (attack/decay) to avoid clicks
            gain.gain.cancelScheduledValues(releaseStartTime);
            
            // Capture current gain value and release from there
            const currentGain = gain.gain.value;
            gain.gain.setValueAtTime(currentGain, releaseStartTime);
            
            // Release: linear ramp from current to 0
            gain.gain.linearRampToValueAtTime(0, releaseStartTime + releaseTime);
            
            // Stop oscillator just after release completes
            osc.stop(releaseStartTime + releaseTime + 0.01);
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

    // we need a way to playNote(key), which will actually start the sound. For this, we start an oscillator,
    // set the desired properties, and connect the new oscillator to the the audioCtx.destination
    function playNote(key) {
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
