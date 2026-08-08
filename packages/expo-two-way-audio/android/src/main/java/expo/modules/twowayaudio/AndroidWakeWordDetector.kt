package expo.modules.twowayaudio

import android.content.Context
import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

private const val SAMPLE_RATE = 16_000
private const val MODEL_DIR = "wake-word"
private const val MODEL_VERSION = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
private const val SAFE_PHRASE = "Hey Otto"
private const val TAG = "HeyOtto"

private val REQUIRED_ASSETS = listOf(
    "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
    "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "tokens.txt",
    "keywords.txt",
)

internal class AndroidWakeWordDetector(private val context: Context) {
    private var spotter: KeywordSpotter? = null
    private var stream: OnlineStream? = null
    private var detected = false

    @Synchronized
    fun start(phrase: String, sensitivity: Double) {
        require(phrase.trim().equals(SAFE_PHRASE, ignoreCase = true)) {
            "This Android model only supports the wake phrase \"$SAFE_PHRASE\"."
        }
        releaseLocked()

        require(sensitivity.isFinite()) { "Wake-word sensitivity must be a finite number." }
        val normalizedSensitivity = sensitivity.coerceIn(0.0, 1.0)
        val config = KeywordSpotterConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = "$MODEL_DIR/${REQUIRED_ASSETS[0]}",
                    decoder = "$MODEL_DIR/${REQUIRED_ASSETS[1]}",
                    joiner = "$MODEL_DIR/${REQUIRED_ASSETS[2]}",
                ),
                tokens = "$MODEL_DIR/tokens.txt",
                numThreads = 1,
                provider = "cpu",
                modelType = "zipformer2",
            ),
            maxActivePaths = 4,
            keywordsFile = "$MODEL_DIR/keywords.txt",
            keywordsScore = (1.5 + normalizedSensitivity * 1.5).toFloat(),
            keywordsThreshold = (0.24 - normalizedSensitivity * 0.14).toFloat(),
            numTrailingBlanks = 1,
        )

        try {
            val nextSpotter = KeywordSpotter(context.assets, config)
            val nextStream = nextSpotter.createStream()
            check(nextStream.ptr != 0L) { "Sherpa could not create a wake-word stream." }
            spotter = nextSpotter
            stream = nextStream
            detected = false
            Log.i(
                TAG,
                "Detector ready model=$MODEL_VERSION sensitivity=$normalizedSensitivity",
            )
        } catch (error: Throwable) {
            releaseLocked()
            throw IllegalStateException("Could not initialize the Android wake-word detector.", error)
        }
    }

    fun acceptPcm16(data: ByteArray): Boolean {
        synchronized(this) {
            if (detected) return false
            val activeSpotter = spotter ?: return false
            val activeStream = stream ?: return false
            val sampleCount = data.size / 2
            if (sampleCount == 0) return false
            val samples = FloatArray(sampleCount)
            for (index in 0 until sampleCount) {
                val low = data[index * 2].toInt() and 0xff
                val high = data[index * 2 + 1].toInt()
                samples[index] = ((high shl 8) or low).toShort() / 32768.0f
            }
            activeStream.acceptWaveform(samples, SAMPLE_RATE)
            while (activeSpotter.isReady(activeStream)) {
                activeSpotter.decode(activeStream)
                if (activeSpotter.getResult(activeStream).keyword.isNotBlank()) {
                    detected = true
                    Log.i(TAG, "Wake phrase detected")
                    return true
                }
            }
        }
        return false
    }

    @Synchronized
    fun stop() {
        releaseLocked()
    }

    private fun releaseLocked() {
        stream?.release()
        stream = null
        spotter?.release()
        spotter = null
        detected = false
    }

    companion object {
        const val modelVersion = MODEL_VERSION

        fun isAvailable(context: Context): Boolean {
            return try {
                Class.forName(
                    "com.k2fsa.sherpa.onnx.KeywordSpotter",
                    false,
                    context.classLoader,
                )
                REQUIRED_ASSETS.all { asset ->
                    context.assets.open("$MODEL_DIR/$asset").use { }
                    true
                }
            } catch (_: Throwable) {
                false
            }
        }
    }
}
