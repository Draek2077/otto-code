package expo.modules.twowayaudio

import android.content.Context
import android.os.Handler
import android.os.Looper

/** Consumes the existing AudioRecord tap. Idle PCM and levels never enter JS.
 * Only command audio following a detection can cross the dictation boundary.
 */
internal class WakeWordCapture(context: Context) {
    private val detector = AndroidWakeWordDetector(context.applicationContext)
    private val handoff = WakeWordHandoffBuffer(16000 * 2 * 2)
    private val handler = Handler(Looper.getMainLooper())
    private var detecting = false
    private var generation = 0
    private var timeout: Runnable? = null
    var onDetected: (() -> Unit)? = null
    var onExpired: (() -> Unit)? = null

    @Synchronized
    fun start(phrase: String, sensitivity: Double) {
        stop(true)
        detector.start(phrase, sensitivity)
        detecting = true
    }

    @Synchronized
    fun accept(data: ByteArray): Boolean {
        if (handoff.isPending) {
            handoff.append(data)
            return true
        }
        if (!detecting) return false
        if (detector.acceptPcm16(data)) {
            detecting = false
            handoff.begin()
            val authority = generation
            val expiration = Runnable {
                synchronized(this) {
                    if (generation != authority || !handoff.isPending) return@Runnable
                    stop(true)
                    onExpired?.invoke()
                }
            }
            timeout = expiration
            handler.postDelayed(expiration, 3000)
            handler.post {
                synchronized(this) {
                    if (generation == authority && handoff.isPending) onDetected?.invoke()
                }
            }
        }
        return true
    }

    @Synchronized
    fun claim(emit: (ByteArray) -> Unit) {
        detecting = false
        detector.stop()
        if (!handoff.isPending) return
        val authority = generation
        // Dictation installs its JS capture authority before this posted flush.
        // Keep accepting into the same bounded native buffer until then.
        handler.post {
            synchronized(this) {
                if (generation != authority) return@post
                timeout?.let { handler.removeCallbacks(it) }
                timeout = null
                handoff.drain().forEach(emit)
            }
        }
    }

    /** Returns whether this detector owned capture, never another dictation. */
    @Synchronized
    fun stop(discardHandoff: Boolean): Boolean {
        val owned = detecting || handoff.isPending
        detecting = false
        detector.stop()
        if (discardHandoff || !handoff.isPending) {
            generation += 1
            timeout?.let { handler.removeCallbacks(it) }
            timeout = null
            handoff.cancel()
        }
        return owned && !handoff.isPending
    }
}
