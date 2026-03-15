import { useRef } from 'react'

function useCallAlerts() {
  const ringtoneIntervalRef = useRef(null)
  const ringtoneAudioContextRef = useRef(null)
  const ringtoneElementRef = useRef(null)
  const incomingAlertTokenRef = useRef(0)
  const outgoingRingIntervalRef = useRef(null)
  const outgoingRingAudioContextRef = useRef(null)

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
      const audioContext = new AudioCtx()
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
      const audio = new Audio(ringtonePath)
      audio.loop = true
      audio.preload = 'auto'
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
    stopIncomingAlert,
    playIncomingAlert,
    stopOutgoingAlert,
    playOutgoingAlert,
  }
}

export default useCallAlerts
