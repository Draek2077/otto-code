package expo.modules.twowayaudio

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeWordHandoffBufferTest {
    @Test
    fun ignoresAudioUntilDetectionBeginsAHandoff() {
        val buffer = WakeWordHandoffBuffer(maxBytes = 8)
        buffer.append(byteArrayOf(1, 2))

        assertTrue(buffer.drain().isEmpty())
        assertFalse(buffer.isPending)
    }

    @Test
    fun drainsBufferedCommandAudioExactlyOnce() {
        val buffer = WakeWordHandoffBuffer(maxBytes = 8)
        buffer.begin()
        buffer.append(byteArrayOf(1, 2))
        buffer.append(byteArrayOf(3, 4))

        val drained = buffer.drain()
        assertArrayEquals(byteArrayOf(1, 2), drained[0])
        assertArrayEquals(byteArrayOf(3, 4), drained[1])
        assertTrue(buffer.drain().isEmpty())
        assertFalse(buffer.isPending)
    }

    @Test
    fun retainsOnlyTheNewestAudioWithinTheBound() {
        val buffer = WakeWordHandoffBuffer(maxBytes = 4)
        buffer.begin()
        buffer.append(byteArrayOf(1, 2))
        buffer.append(byteArrayOf(3, 4))
        buffer.append(byteArrayOf(5, 6))

        val drained = buffer.drain()
        assertArrayEquals(byteArrayOf(3, 4), drained[0])
        assertArrayEquals(byteArrayOf(5, 6), drained[1])
    }
}
