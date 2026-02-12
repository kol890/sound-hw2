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

    // ============================================
    // SYNTHESIS PARAMETERS
    // ============================================
    const synthParams = {
        // Global ADSR
        attackTime: 0.2,
        decayTime: 0.3,
        sustainLevel: 0.3,
        maxGain: 0.4,
        
        // Additive: control partial count and spectral decay (normalized to avoid clipping)
        numPartials: 3,
        partialDecay: 2.50,
        
        // AM
        // amplitude modulation: modulator frequency specified as a ratio
        amDepth: 0.5,
        // Ratio applied to carrier to produce modulator frequency: modulator = carrier * amRatio
        // default 0.5 -> carrier:modulator == 2:1
        amRatio: 0.5,

        // FM
        // Ratio applied to carrier to produce modulator frequency: modulator = carrier * fmRatio
        // default 3 -> carrier:modulator == 1:3
        fmRatio: 3,
        fmIndex: 150,
        
        // LFO
        lfoFreq: 6,
        lfoDepth: 8  // for FM_LFO
    };

    // Simple oscillator for synthesis experiments EXPERIMENTAL
    //let simpleOscillator = null;
    //const cFrequency = 261.625565300598634; // C

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
            if (notes.oscPartials) {
                notes.oscPartials.forEach(o => o.stop(releaseStartTime + releaseTime + 0.01));
            } else if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            } else if (notes.oscCarr) {
                // AM/FM style: stop carrier, modulator, and optional LFO
                if (notes.oscMod) notes.oscMod.stop(releaseStartTime + releaseTime + 0.01);
                notes.oscCarr.stop(releaseStartTime + releaseTime + 0.01);
                if (notes.lfo) notes.lfo.stop(releaseStartTime + releaseTime + 0.01);
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
            if (notes.oscPartials) {
                notes.oscPartials.forEach(o => o.stop(releaseStartTime + releaseTime + 0.01));
            } else if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            } else if (notes.oscCarr) {
                if (notes.oscMod) notes.oscMod.stop(releaseStartTime + releaseTime + 0.01);
                notes.oscCarr.stop(releaseStartTime + releaseTime + 0.01);
                if (notes.lfo) notes.lfo.stop(releaseStartTime + releaseTime + 0.01);
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

            // If switching into an LFO-enabled mode, set sensible defaults
            if (currentMode === 'FM_LFO') {
                synthParams.lfoFreq = 6;
                synthParams.lfoDepth = 8;
            } else if (currentMode === 'AM_LFO') {
                synthParams.lfoFreq = 2;
                synthParams.lfoDepth = 3;
            }

            // Update any visible controls/labels to reflect these defaults
            const lfoFreqInput = document.querySelector('input[name="lfoFreq"]');
            const lfoDepthInput = document.querySelector('input[name="lfoDepth"]');
            const lfoFreqLabel = document.getElementById('lfoFreqLabel');
            const lfoDepthLabel = document.getElementById('lfoDepthLabel');
            if (lfoFreqInput) lfoFreqInput.value = synthParams.lfoFreq;
            if (lfoDepthInput) lfoDepthInput.value = synthParams.lfoDepth;
            if (lfoFreqLabel) lfoFreqLabel.textContent = (typeof synthParams.lfoFreq === 'number') ? synthParams.lfoFreq.toFixed(1) + ' Hz' : synthParams.lfoFreq;
            if (lfoDepthLabel) lfoDepthLabel.textContent = synthParams.lfoDepth;

            // Show/hide relevant parameter groups
            updateControlPanelVisibility();
        });
    }

    // ============================================
    // PARAMETER CONTROL PANEL SETUP
    // ============================================
    function updateControlPanelVisibility() {
        const additiveControls = document.getElementById('additiveControls');
        const amControls = document.getElementById('amControls');
        const fmControls = document.getElementById('fmControls');
        const lfoControls = document.getElementById('lfoControls');
        
        // Hide all initially
        additiveControls.style.display = 'none';
        amControls.style.display = 'none';
        fmControls.style.display = 'none';
        lfoControls.style.display = 'none';
        
        // Show based on current mode
        if (currentMode === 'Additive') {
            additiveControls.style.display = 'block';
        } else if (currentMode === 'AM') {
            amControls.style.display = 'block';
        } else if (currentMode === 'AM_LFO') {
            amControls.style.display = 'block';
            lfoControls.style.display = 'block';
        } else if (currentMode === 'FM') {
            fmControls.style.display = 'block';
        } else if (currentMode === 'FM_LFO') {
            fmControls.style.display = 'block';
            lfoControls.style.display = 'block';
        }
    }

    // Add event listeners for all parameter controls
    const paramControls = document.querySelectorAll('.paramControl input[type="range"]');
    // Helper to find label element for a parameter, with fallbacks for different id naming schemes
    function findLabelElement(paramName) {
        const primaryId = paramName + 'Label';
        let el = document.getElementById(primaryId);
        if (el) return el;
        const altMap = {
            'harmonic1': 'harm1Label',
            'harmonic2': 'harm2Label',
            'harmonic3': 'harm3Label',
            'sustainLevel': 'sustainLabel',
            'attackTime': 'attackLabel',
            'decayTime': 'decayLabel',
            'maxGain': 'maxGainLabel',
            'amDepth': 'amDepthLabel',
            'fmIndex': 'fmIndexLabel',
            'lfoFreq': 'lfoFreqLabel',
            'lfoDepth': 'lfoDepthLabel',
            'amRatio': 'amModFreqLabel',
            'fmRatio': 'fmModFreqLabel'
        };
        // Add new additive labels
        if (!el && paramName === 'numPartials') el = document.getElementById('numPartialsLabel');
        if (!el && paramName === 'partialDecay') el = document.getElementById('partialDecayLabel');
        if (altMap[paramName]) {
            el = document.getElementById(altMap[paramName]);
        }
        return el;
    }

    paramControls.forEach(control => {
        control.addEventListener('input', (e) => {
            const paramName = e.target.name;
            const value = parseFloat(e.target.value);
            const labelEl = findLabelElement(paramName);

            // Update parameter value
            synthParams[paramName] = value;

            // Update label display (with formatting for freq/time and ratios)
            if (labelEl) {
                if (paramName === 'attackTime' || paramName === 'decayTime') {
                    labelEl.textContent = value.toFixed(1);
                } else if (paramName === 'numPartials') {
                    labelEl.textContent = Math.round(value);
                } else if (paramName === 'amRatio' || paramName === 'fmRatio') {
                    const mult = value;
                    let ratioText;
                    if (mult < 1) {
                        const denom = Math.round(1 / mult);
                        ratioText = `${denom}:1 (x${mult.toFixed(2)})`;
                    } else {
                        ratioText = `1:${mult.toFixed(2)} (x${mult.toFixed(2)})`;
                    }
                    labelEl.textContent = ratioText;
                } else if (paramName === 'lfoFreq') {
                    labelEl.textContent = value.toFixed(1) + ' Hz';
                } else if (paramName === 'lfoDepth' || paramName === 'fmIndex' || paramName === 'amDepth') {
                    labelEl.textContent = value.toString();
                } else if (paramName === 'partialDecay') {
                    labelEl.textContent = value.toFixed(2);
                } else {
                    labelEl.textContent = value.toFixed(2);
                }
            }
        });
    });

    // Initialize ratio inputs/labels to match synthParams defaults
    (function initRatioLabels(){
        function formatRatio(mult) {
            if (mult < 1) {
                const denom = Math.round(1 / mult);
                return `${denom}:1 (x${mult.toFixed(2)})`;
            }
            return `1:${mult.toFixed(2)} (x${mult.toFixed(2)})`;
        }
        const amRatioInput = document.querySelector('input[name="amRatio"]');
        const fmRatioInput = document.querySelector('input[name="fmRatio"]');
        const amRatioLabel = document.getElementById('amModFreqLabel');
        const fmRatioLabel = document.getElementById('fmModFreqLabel');
        if (amRatioInput) amRatioInput.value = synthParams.amRatio;
        if (fmRatioInput) fmRatioInput.value = synthParams.fmRatio;
        if (amRatioLabel) amRatioLabel.textContent = formatRatio(synthParams.amRatio);
        if (fmRatioLabel) fmRatioLabel.textContent = formatRatio(synthParams.fmRatio);
    })();

    // Set initial read-only labels that aren't driven by inputs (e.g. maxGain)
    const maxGainLabelEl = document.getElementById('maxGainLabel');
    if (maxGainLabelEl) maxGainLabelEl.textContent = synthParams.maxGain.toFixed(2);

    // Initialize control panel visibility
    updateControlPanelVisibility();

    // Add listeners for play/stop buttons - EXPERIMENTAL
    /*const playButton = document.querySelector('#playButton');
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

                modulator.frequency.value = cFrequency * 3;
                modulator.type = currentWaveform;

                index = audioCtx.createGain();
                index.gain.value = 150;

                
                modulator.connect(index);
                index.connect(carrier.frequency);

                //ADSR envelope
                envelope = audioCtx.createGain();
                envelope.gain.setValueAtTime(0, now);
                
                carrier.connect(envelope);
                envelope.connect(globalGain);

                // Start the oscillators
                carrier.start();
                modulator.start();

                // add LFO
                var lfo = audioCtx.createOscillator();
                lfo.frequency.value = 2;
                lfoGain = audioCtx.createGain();
                lfoGain.gain.value = 100;
                lfo.connect(lfoGain).connect(modulator.frequency);
                lfo.start();

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
    } */

    // Next we add listeners to the keys. These will add and remove activeOscillators.
    window.addEventListener('keydown', keyDown, false);
    window.addEventListener('keyup', keyUp, false);

    activeOscillators = {} // will store {osc, gain} for each key

    // Update normalization gain based on number of active voices to avoid clipping.
    function updateNormalization() {
        const n = Object.keys(activeOscillators).length || 1;
        // Ensure overall maximum output does not exceed baseMasterGain even if
        // `synthParams.maxGain` is set high and multiple voices are active.
        // We compute a normalization scale so that: synthParams.maxGain * scale * n <= baseMasterGain
        const voices = Math.max(1, n);
        const desiredPerVoice = Math.max(0.0001, synthParams.maxGain);
        let scale = baseMasterGain / (desiredPerVoice * voices);
        // Clamp to a safe 0..1 range
        scale = Math.min(1, Math.max(0, scale));
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
            if (notes.oscPartials) {
                notes.oscPartials.forEach(o => o.stop(releaseStartTime + releaseTime + 0.01));
            } else if (notes.osc1) {
                notes.osc1.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc2.stop(releaseStartTime + releaseTime + 0.01);
                notes.osc3.stop(releaseStartTime + releaseTime + 0.01);
            }
            // Handle AM/FM style synths (carrier/modulator and optional LFO)
            else if (notes.oscCarr) {
                if (notes.oscMod) notes.oscMod.stop(releaseStartTime + releaseTime + 0.01);
                notes.oscCarr.stop(releaseStartTime + releaseTime + 0.01);
                if (notes.lfo) notes.lfo.stop(releaseStartTime + releaseTime + 0.01);
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
        } else if (currentMode === 'AM_LFO') {
            playNoteAMLFO(key);
        } else if (currentMode === 'FM') {
            playNoteFM(key);
        } else if (currentMode === 'FM_LFO') {
            playNoteFMLFO(key);
        } else if (currentMode === 'None') {
            playNoteNone(key);
        }
    }

    // ============================================
    // ADDITIVE SYNTHESIS
    // ============================================
    function playNoteAdditive(key) {
        const now = audioCtx.currentTime;
        // Create dynamic partials based on user-selected number; partial amplitudes are
        // computed with a spectral decay and normalized so the sum = 1. The global
        // ADSR (`synthParams.maxGain`) still controls the overall loudness to avoid clipping.
        const baseFreq = keyboardFrequencyMap[key];
        const nPartials = Math.max(1, Math.round(synthParams.numPartials));
        const decay = Math.max(0.0001, synthParams.partialDecay);

        // compute weights
        const weights = [];
        let weightSum = 0;
        for (let i = 1; i <= nPartials; i++) {
            const w = 1 / Math.pow(i, decay);
            weights.push(w);
            weightSum += w;
        }

        const envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
        envelope.connect(globalGain);

        const partialOscs = [];
        for (let i = 1; i <= nPartials; i++) {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.type = currentWaveform;
            osc.frequency.setValueAtTime(baseFreq * i, now);
            // normalized amplitude for this partial
            g.gain.setValueAtTime(weights[i-1] / weightSum, now);
            osc.connect(g);
            g.connect(envelope);
            osc.start();
            partialOscs.push(osc);
            // for compatibility with older stop logic, also assign first few named refs
            if (i === 1) oscillator1 = osc;
            if (i === 2) oscillator2 = osc;
            if (i === 3) oscillator3 = osc;
        }
        
        // Connect through globalGain and normalizeGain to properly handle multiple voices
        envelope.connect(globalGain);

        // ADSR envelope from parameters
        envelope.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        envelope.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);

        // Store oscillator array, envelope, and sustain level for ADSR control
        activeOscillators[key] = {oscPartials: partialOscs, gain: envelope, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }


    // ============================================
    // AM SYNTHESIS
    // ============================================
    function playNoteAM(key) {
        const now = audioCtx.currentTime;
                
        // Create carrier and modulator
        carrier = audioCtx.createOscillator();
        modulator = audioCtx.createOscillator();
                
        carrier.frequency.value = keyboardFrequencyMap[key];
        carrier.type = currentWaveform;
        modulator.frequency.value = keyboardFrequencyMap[key] * synthParams.amRatio; // modulator set via amRatio
        modulator.type = currentWaveform;

        depth = audioCtx.createGain();
        depth.gain.value = synthParams.amDepth;  // Use parameter
        modulated = audioCtx.createGain();
        modulated.gain.value = 1.0 - synthParams.amDepth;  // Use parameter

        modulator.connect(depth).connect(modulated.gain);
        carrier.connect(modulated);

        // ADSR envelope
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        modulated.connect(envelope);
        envelope.connect(globalGain);

        // ADSR from parameters
        envelope.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        envelope.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);

        // Start the oscillators
        carrier.start();
        modulator.start();

        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {oscCarr: carrier, oscMod: modulator, gain: envelope, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }

    function playNoteAMLFO(key) {
        const now = audioCtx.currentTime;
                
        // Create carrier and modulator
        carrier = audioCtx.createOscillator();
        modulator = audioCtx.createOscillator();
                
        carrier.frequency.value = keyboardFrequencyMap[key];
        carrier.type = currentWaveform;
        modulator.frequency.value = keyboardFrequencyMap[key] * synthParams.amRatio; // modulator set via amRatio
        modulator.type = currentWaveform;

        depth = audioCtx.createGain();
        depth.gain.value = synthParams.amDepth;  // Use parameter
        modulated = audioCtx.createGain();
        modulated.gain.value = 1.0 - synthParams.amDepth;  // Use parameter

        modulator.connect(depth).connect(modulated.gain);
        carrier.connect(modulated);

        // ADSR envelope
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        modulated.connect(envelope);
        envelope.connect(globalGain);

        // ADSR from parameters
        envelope.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        envelope.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);

        // Start the oscillators
        carrier.start();
        modulator.start();

        // add LFO
        const lfo = audioCtx.createOscillator();
        lfo.frequency.value = synthParams.lfoFreq;  // Use parameter
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = synthParams.lfoDepth;
        lfo.connect(lfoGain).connect(modulator.frequency);
        lfo.start();

        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {oscCarr: carrier, oscMod: modulator, gain: envelope, lfo: lfo, lfoGain: lfoGain, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }

    // ============================================
    // FM SYNTHESIS
    // ============================================
    function playNoteFM(key) {
        const now = audioCtx.currentTime;
                
        // Create carrier and modulator
        carrier = audioCtx.createOscillator();
        modulator = audioCtx.createOscillator();
                
        carrier.frequency.value = keyboardFrequencyMap[key];
        carrier.type = currentWaveform;

        modulator.frequency.value = keyboardFrequencyMap[key] * synthParams.fmRatio;
        modulator.type = currentWaveform;

        index = audioCtx.createGain();
        index.gain.value = synthParams.fmIndex;  // Use parameter

        modulator.connect(index);
        index.connect(carrier.frequency);

        // ADSR envelope
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        carrier.connect(envelope);
        envelope.connect(globalGain);

        // ADSR from parameters
        envelope.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        envelope.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);

        // Start the oscillators
        carrier.start();
        modulator.start();

        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {oscCarr: carrier, oscMod: modulator, gain: envelope, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }

    function playNoteFMLFO(key) {
        const now = audioCtx.currentTime;
                
        // Create carrier and modulator
        carrier = audioCtx.createOscillator();
        modulator = audioCtx.createOscillator();
                
        carrier.frequency.value = keyboardFrequencyMap[key];
        carrier.type = currentWaveform;

        modulator.frequency.value = keyboardFrequencyMap[key] * synthParams.fmRatio;
        modulator.type = currentWaveform;

        index = audioCtx.createGain();
        index.gain.value = synthParams.fmIndex;  // Use parameter

        modulator.connect(index);
        index.connect(carrier.frequency);

        // ADSR envelope
        envelope = audioCtx.createGain();
        envelope.gain.setValueAtTime(0, now);
                
        carrier.connect(envelope);
        envelope.connect(globalGain);

        // ADSR from parameters
        envelope.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        envelope.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);

        // Start the oscillators
        carrier.start();
        modulator.start();

        // add LFO
        const lfo = audioCtx.createOscillator();
        lfo.frequency.value = synthParams.lfoFreq;  // Use parameter
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = synthParams.lfoDepth;  // Use parameter directly
        lfo.connect(lfoGain).connect(carrier.frequency);
        lfo.start();

        // Store oscillator, gain, LFO and sustain level for ADSR control
        activeOscillators[key] = {oscCarr: carrier, oscMod: modulator, gain: envelope, lfo: lfo, lfoGain: lfoGain, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }

    // ============================================
    // NONE SYNTHESIS (Simple single oscillator)
    // ============================================
    function playNoteNone(key) {
        // create gain node for this note
        const noteGain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        
        // start at 0, then execute ADSR
        noteGain.gain.setValueAtTime(0, now);
        
        // Attack: 0 -> maxGain with exponential ramp
        noteGain.gain.setTargetAtTime(synthParams.maxGain, now, synthParams.attackTime);
        
        // Decay: maxGain -> sustainLevel (start after attack completes)
        noteGain.gain.setTargetAtTime(synthParams.sustainLevel, now + synthParams.attackTime, synthParams.decayTime);
        
        noteGain.connect(globalGain);
        
        // Create and configure oscillator
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(keyboardFrequencyMap[key], now)
        osc.type = currentWaveform;
        osc.connect(noteGain);
        osc.start();
        
        // Store oscillator, gain, and sustain level for ADSR control
        activeOscillators[key] = {osc, gain: noteGain, sustainLevel: synthParams.sustainLevel}
        updateNormalization();
    }
})
