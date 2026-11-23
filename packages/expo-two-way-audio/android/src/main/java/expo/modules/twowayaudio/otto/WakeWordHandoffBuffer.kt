package expo.modules.twowayaudio

import java.util.ArrayDeque

internal class WakeWordHandoffBuffer(private val maxBytes: Int) {
    private val chunks = ArrayDeque<ByteArray>()
    private var bytes = 0

    @get:Synchronized
    var isPending = false
        private set

    @Synchronized
    fun begin() {
        chunks.clear()
        bytes = 0
        isPending = true
    }

    @Synchronized
    fun append(data: ByteArray) {
        if (!isPending) return
        chunks.addLast(data)
        bytes += data.size
        while (bytes > maxBytes && chunks.isNotEmpty()) {
            bytes -= chunks.removeFirst().size
        }
    }

    @Synchronized
    fun drain(): List<ByteArray> {
        if (!isPending) return emptyList()
        val buffered = chunks.toList()
        cancelLocked()
        return buffered
    }

    @Synchronized
    fun cancel() {
        cancelLocked()
    }

    private fun cancelLocked() {
        isPending = false
        chunks.clear()
        bytes = 0
    }
}
