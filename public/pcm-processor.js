// AudioWorkletProcessor: 采集麦克风原始 PCM 数据
// 浏览器 AudioContext 默认 44100/48000Hz，需降采样到 16000Hz
// 每累积 100ms (1600 个 16kHz 样本) 才发一次 postMessage，避免主线程消息洪水
const TARGET_SAMPLE_RATE = 16000;
const FLUSH_SAMPLES = TARGET_SAMPLE_RATE * 0.1; // 100ms = 1600 samples

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._accumulated = new Int16Array(FLUSH_SAMPLES * 2); // 预分配
    this._accLen = 0;
    this._ratio = sampleRate / TARGET_SAMPLE_RATE;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const outputLen = Math.floor(channelData.length / this._ratio);

    for (let i = 0; i < outputLen; i++) {
      const srcIdx = Math.floor(i * this._ratio);
      let sample = channelData[srcIdx];
      sample = Math.max(-1, Math.min(1, sample));
      this._accumulated[this._accLen++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    // 攒够 100ms 再发
    if (this._accLen >= FLUSH_SAMPLES) {
      const out = new Int16Array(this._accLen);
      out.set(this._accumulated.subarray(0, this._accLen));
      this.port.postMessage(out.buffer, [out.buffer]);
      this._accLen = 0;
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
