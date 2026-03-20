import { useRef } from 'react'

function useCallAlerts() {
  const ringtoneIntervalRef = useRef(null)
  const ringtoneAudioContextRef = useRef(null)
  const ringtoneElementRef = useRef(null)
  const incomingAlertTokenRef = useRef(0)
  const outgoingRingIntervalRef = useRef(null)
  const outgoingRingAudioContextRef = useRef(null)
  const primedIncomingElementRef = useRef(null)
  const primedAudioContextRef = useRef(null)

  const stopIncomingAlert = () => {
    incomingAlertTokenRef.current += 1
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current)
      ringtoneIntervalRef.current = null
    }
    if (navigator.vibrate) navigator.vibrate(0)
    if (ringtoneElementRef.current) {
      ringtoneElementRef.current.pause()
      ringtoneElementRef.current.currentTime = 0
      ringtoneElementRef.current = null
    }
    if (ringtoneAudioContextRef.current) {
      ringtoneAudioContextRef.current.close().catch(() => null)
      ringtoneAudioContextRef.current = null
    }
  }

  const playIncomingAlert = () => {
    stopIncomingAlert()
    const alertToken = incomingAlertTokenRef.current
    const startBeepFallback = () => {
      if (alertToken !== incomingAlertTokenRef.current) return
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const audioContext =
        primedAudioContextRef.current && primedAudioContextRef.current.state !== 'closed'
          ? primedAudioContextRef.current
          : new AudioCtx()
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => null)
      }
      ringtoneAudioContextRef.current = audioContext
      const playPulse = () => {
        const now = audioContext.currentTime
        const osc = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, now)
        gainNode.gain.setValueAtTime(0.0001, now)
        gainNode.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
        osc.connect(gainNode)
        gainNode.connect(audioContext.destination)
        osc.start(now)
        osc.stop(now + 0.32)
      }

      playPulse()
      ringtoneIntervalRef.current = setInterval(playPulse, 1300)
      if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
    }

    const ringtonePath = '/sounds/incoming-call.mp3'
    try {
      const audio = primedIncomingElementRef.current || new Audio(ringtonePath)
      audio.src = ringtonePath
      audio.loop = true
      audio.preload = 'auto'
      audio.muted = false
      const playPromise = audio.play()
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (alertToken !== incomingAlertTokenRef.current) {
              audio.pause()
              audio.currentTime = 0
              return
            }
            ringtoneElementRef.current = audio
            if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
          })
          .catch(() => {
            ringtoneElementRef.current = null
            startBeepFallback()
          })
      } else {
        ringtoneElementRef.current = audio
        if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120])
      }
      return
    } catch {
      // fallback below
    }

    try {
      startBeepFallback()
    } catch {
      // ignore if autoplay policy blocks audio context
    }
  }

  const primeAlertAudio = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (AudioCtx) {
        const audioContext =
          primedAudioContextRef.current && primedAudioContextRef.current.state !== 'closed'
            ? primedAudioContextRef.current
            : new AudioCtx()
        primedAudioContextRef.current = audioContext
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => null)
        }
      }
    } catch {
      // Ignore audio context priming issues.
    }

    try {
      if (!primedIncomingElementRef.current) {
        const audio = new Audio('/sounds/incoming-call.mp3')
        audio.preload = 'auto'
        audio.loop = true
        audio.muted = true
        primedIncomingElementRef.current = audio
      }

      const audio = primedIncomingElementRef.current
      const playPromise = audio.play()
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            audio.pause()
            audio.currentTime = 0
            audio.muted = false
          })
          .catch(() => {
            audio.muted = false
          })
      } else {
        audio.pause()
        audio.currentTime = 0
        audio.muted = false
      }
    } catch {
      // Ignore media priming issues.
    }
  }

  const stopOutgoingAlert = () => {
    if (outgoingRingIntervalRef.current) {
      clearInterval(outgoingRingIntervalRef.current)
      outgoingRingIntervalRef.current = null
    }
    if (outgoingRingAudioContextRef.current) {
      outgoingRingAudioContextRef.current.close().catch(() => null)
      outgoingRingAudioContextRef.current = null
    }
  }

  const playOutgoingAlert = () => {
    stopOutgoingAlert()
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const audioContext = new AudioCtx()
      outgoingRingAudioContextRef.current = audioContext

      const playPulse = () => {
        const now = audioContext.currentTime
        const osc = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(510, now)
        gainNode.gain.setValueAtTime(0.0001, now)
        gainNode.gain.exponentialRampToValueAtTime(0.12, now + 0.03)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
        osc.connect(gainNode)
        gainNode.connect(audioContext.destination)
        osc.start(now)
        osc.stop(now + 0.3)
      }

      playPulse()
      outgoingRingIntervalRef.current = setInterval(playPulse, 1200)
    } catch {
      // ignore autoplay blocked case
    }
  }

  return {
    primeAlertAudio,
    stopIncomingAlert,
    playIncomingAlert,
    stopOutgoingAlert,
    playOutgoingAlert,
  }
}

export default useCallAlerts
