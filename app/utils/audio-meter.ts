/**
 * Microphone level metering.
 *
 * Drives the avatar's reaction to the player's voice. Deliberately built on a
 * plain `AnalyserNode` rather than an AudioWorklet: the value is only ever
 * consumed by a shader uniform, so a few milliseconds of latency is invisible,
 * and an worklet would need a separate module file that a third-party embed
 * would also have to host.
 */

export interface AudioMeter {
  /** Current level in [0, 1]. Read once per animation frame. */
  level(): number
  stop(): void
}

/**
 * Attach a meter to a media stream.
 *
 * The level is RMS, not peak: peak jumps to 1.0 on a single loud sample and
 * makes the avatar strobe, while RMS tracks perceived loudness and reads as
 * the thing actually breathing when someone speaks.
 */
export function createAudioMeter(stream: MediaStream): AudioMeter {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  // A small amount of built-in smoothing on top of the renderer's own, so a
  // consonant burst does not read as a spike.
  analyser.smoothingTimeConstant = 0.6
  source.connect(analyser)

  const buffer = new Float32Array(analyser.fftSize)

  return {
    level() {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
      const rms = Math.sqrt(sum / buffer.length)
      // Speech RMS sits around 0.05–0.2. Scaling by 6 puts normal talking
      // near the middle of the range rather than pinned at the bottom.
      return Math.min(1, rms * 6)
    },
    stop() {
      source.disconnect()
      void context.close()
    },
  }
}
