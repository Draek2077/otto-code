package expo.modules.twowayaudio

import AudioEngine
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.interfaces.permissions.Permissions

class ExpoTwoWayAudioModule : Module() {
    companion object {
        private const val ON_MIC_DATA_EVENT = "onMicrophoneData"
        private const val ON_INPUT_VOLUME_LEVEL_EVENT = "onInputVolumeLevelData"
        private const val ON_OUTPUT_VOLUME_LEVEL_EVENT = "onOutputVolumeLevelData"
        private const val ON_RECORDING_CHANGE_EVENT = "onRecordingChange"
        private const val ON_AUDIO_INTERRUPTION_EVENT = "onAudioInterruption"
        var audioEngine: AudioEngine? = null
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoTwoWayAudio")
        OnDestroy { audioEngine?.stopWakeWordDetection(true) } // OTTO(wake-word): revoke idle capture on bridge teardown.
        AsyncFunction("initialize") { promise: Promise ->
            try {
                if (audioEngine != null) {
                    promise.resolve(true)
                    return@AsyncFunction
                }
                audioEngine = appContext.reactContext?.let { AudioEngine(it) }
                setupCallbacks()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

         Function("releaseAudioSession") {
             audioEngine?.releaseAudioSession()
             null
         }

         Function("isRecording") {
             audioEngine?.isRecording ?: false
         }

         Function("startDictation") {
             val isRecording = audioEngine?.startDictation() ?: false
             sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf("data" to isRecording))
             isRecording
         }

         Function("toggleRecording") { value: Boolean ->
             audioEngine?.let { engine ->
                 val isRecording = engine.toggleRecording(value)
                 sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf("data" to isRecording))
                 isRecording
             } ?: false
         }

         Function("tearDown") {
             audioEngine?.tearDown()
             audioEngine = null
             null
         }

         Function("restart") {
             audioEngine?.resumeRecordingAndPlayer()
             sendEvent(ON_RECORDING_CHANGE_EVENT, mapOf(
                 "data" to (audioEngine?.isRecording ?: false)
             ))
         }

         Function("playPCMData") { data: kotlin.ByteArray ->
             audioEngine?.playPCMData(data)
         }

         Function("bypassVoiceProcessing") { bypass: Boolean ->
             audioEngine?.bypassVoiceProcessing(bypass)
         }

         Function("isPlaying") {
             audioEngine?.isPlaying ?: false
         }

         Function("stopPlayback") {
             audioEngine?.stopPlayback()
         }

         Function("pausePlayback") {
             audioEngine?.pausePlayback()
         }

         Function("resumePlayback") {
             audioEngine?.resumePlayback()
         }

        Function("getMicrophoneModeIOS") {
            throw UnsupportedOperationException("getMicrophoneModeIOS is only supported on iOS")
        }

        // OTTO(wake-word): device-local capability and control, never daemon PCM.
        Function("getWakeWordCapabilities") {
            val available = appContext.reactContext?.let { AndroidWakeWordDetector.isAvailable(it) } ?: false
            mapOf("available" to available, "safePhraseSupported" to available,
                "modelVersion" to AndroidWakeWordDetector.modelVersion)
        }
        AsyncFunction("startWakeWordDetection") { phrase: String, sensitivity: Double ->
            check(appContext.currentActivity?.hasWindowFocus() == true) { "Hey Otto can listen only while Otto is in the foreground." }
            if (audioEngine == null) {
                audioEngine = appContext.reactContext?.let { AudioEngine(it) }
            }
            setupCallbacks() // Also rebind after a JS bridge reload reuses the native engine.
            checkNotNull(audioEngine) { "Audio context is unavailable." }.startWakeWordDetection(phrase, sensitivity)
        }
        Function("stopWakeWordDetection") { discardHandoff: Boolean ->
            audioEngine?.stopWakeWordDetection(discardHandoff)
        }

        Function ("setMicrophoneModeIOS") {
            throw UnsupportedOperationException("setMicrophoneModeIOS is only supported on iOS")
        }

         AsyncFunction("getMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.getPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

         AsyncFunction("requestMicrophonePermissionsAsync") { promise: Promise ->
             Permissions.askForPermissionsWithPermissionsManager(
                 appContext.permissions,
                 promise,
                 android.Manifest.permission.RECORD_AUDIO
             )
         }

        // Register events
        Events(
            ON_MIC_DATA_EVENT,
            ON_INPUT_VOLUME_LEVEL_EVENT,
            ON_OUTPUT_VOLUME_LEVEL_EVENT,
            ON_RECORDING_CHANGE_EVENT,
            ON_AUDIO_INTERRUPTION_EVENT,
            "onWakeWordDetected" // OTTO(wake-word)
        )
    }

    private fun setupCallbacks() {
        audioEngine?.apply {
            onWakeWordDetectedCallback = { sendEvent("onWakeWordDetected", bundleOf("data" to "Hey Otto")) } // OTTO(wake-word)
            onMicDataCallback = { data ->
                sendEvent(ON_MIC_DATA_EVENT, bundleOf("data" to data))
            }
            onInputVolumeCallback = { level ->
                sendEvent(ON_INPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onOutputVolumeCallback = { level ->
                sendEvent(ON_OUTPUT_VOLUME_LEVEL_EVENT, bundleOf("data" to level))
            }
            onAudioInterruptionCallback = { data ->
                sendEvent(ON_AUDIO_INTERRUPTION_EVENT, bundleOf("data" to data))
                sendEvent(ON_RECORDING_CHANGE_EVENT, bundleOf(
                    "data" to (audioEngine?.isRecording ?: false)
                ))
            }
        }
    }
}
