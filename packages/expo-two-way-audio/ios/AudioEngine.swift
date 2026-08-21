import AVFoundation
import Foundation

class AudioEngine {
    private var avAudioEngine = AVAudioEngine()
    private var speechPlayer = AVAudioPlayerNode()
    private var engineConfigChangeObserver: Any?
    private var sessionInterruptionObserver: Any?
    private var mediaServicesResetObserver: Any?

    public private(set) var voiceIOFormat: AVAudioFormat
    public private(set) var isRecording = false
    public private(set) var isSessionActive = false

    public var onMicDataCallback: ((Data) -> Void)?
    public var onInputVolumeCallback: ((Float) -> Void)?
    public var onOutputVolumeCallback: ((Float) -> Void)?
    public var onAudioInterruptionCallback: ((String) -> Void)?

    private var inputLevelTimer: Timer?
    private var outputLevelTimer: Timer?

    private var inputBuffer = [Float](repeating: 0, count: 2048)
    private var outputBuffer = [Float](repeating: 0, count: 2048)
    private var inputBufferIndex = 0
    private var outputBufferIndex = 0

    private var hasFirstInputBeenDiscarded = false
    private var discardRecording = false
    private var discardFirstInputMillis = 2000
    private var inputTapInstalled = false
    private var shouldResumeRecordingAfterInterruption = false

    /// Buffers scheduled on `speechPlayer` that have not finished rendering yet.
    ///
    /// `AVAudioPlayerNode.isPlaying` cannot answer "is audio still in flight": it stays true from
    /// `play()` until an explicit `stop()`/`pause()`, and draining every scheduled buffer does not
    /// clear it. Using it as the release guard meant the session was never handed back after the
    /// first spoken response. Decremented from the scheduling completion handler, which runs on an
    /// AVAudioEngine-internal thread, so all access goes through `playbackCountLock`.
    private var pendingPlaybackBuffers = 0
    private let playbackCountLock = NSLock()

    private var hasPendingPlayback: Bool {
        playbackCountLock.lock()
        defer { playbackCountLock.unlock() }
        return pendingPlaybackBuffers > 0
    }

    enum AudioEngineError: Error {
        case audioFormatError
    }

    init() throws {
        avAudioEngine.attach(speechPlayer)

        guard let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1) else {
            throw AudioEngineError.audioFormatError
        }
        voiceIOFormat = format
        print("Voice IO format: \(String(describing: voiceIOFormat))")

        engineConfigChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: avAudioEngine,
            queue: .main
        ) { [weak self] _ in
            self?.checkEngineIsRunning()
        }
        sessionInterruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            self?.handleAudioSessionInterruption(notification)
        }
        mediaServicesResetObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            self?.handleMediaServicesWereReset()
        }

        configurePlaybackSession()
        setup()
    }

    deinit {
        if let observer = engineConfigChangeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = sessionInterruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = mediaServicesResetObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Playback is the idle state. Do not enter a microphone-capable session
    /// until capture is explicitly requested: iOS treats an active
    /// play-and-record session as microphone use even if its input is muted.
    private func configurePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
        } catch {
            print("Could not set the audio category: \(error.localizedDescription)")
        }
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            isSessionActive = false
        } catch {
            print("Could not deactivate the playback audio session: \(error.localizedDescription)")
        }
    }

    private func activatePlaybackSessionIfNeeded() {
        guard !isSessionActive else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
            isSessionActive = true
        } catch {
            print("Could not activate the playback audio session: \(error.localizedDescription)")
        }
        checkEngineIsRunning()
    }

    private func activateCaptureSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP],
            )
            try session.setPreferredSampleRate(voiceIOFormat.sampleRate)
            try session.setActive(true)
            isSessionActive = true
        } catch {
            print("Could not activate the capture audio session: \(error.localizedDescription)")
        }
    }

    /// Hand the audio session back to the system.
    ///
    /// `.playAndRecord` + `.voiceChat` does not mix, so while it is active the user's
    /// background music stays dead - including across backgrounding, because iOS
    /// re-asserts whatever category the app last set when it returns to the foreground.
    /// Releasing when we are neither capturing nor playing is what lets their music come
    /// back; `.notifyOthersOnDeactivation` is what tells the other app to resume, and
    /// dropping to `.ambient` means any implicit reactivation mixes instead of interrupting.
    func releaseAudioSession() {
        // The native engine is a singleton shared by every JS-side engine wrapper, so it is the
        // only layer that knows whether anything is still using the session. Never release while
        // capture or playback is live - the JS callers each only see their own queue.
        guard isSessionActive, !isRecording, !hasPendingPlayback else { return }

        avAudioEngine.pause()

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            print("Could not deactivate the audio session: \(error.localizedDescription)")
        }
        do {
            try session.setCategory(.ambient, options: [.mixWithOthers])
        } catch {
            print("Could not reset the audio category: \(error.localizedDescription)")
        }

        isSessionActive = false
    }

    func setup() {
        let output = avAudioEngine.outputNode
        let mainMixer = avAudioEngine.mainMixerNode

        avAudioEngine.connect(speechPlayer, to: mainMixer, format: voiceIOFormat)
        avAudioEngine.connect(mainMixer, to: output, format: voiceIOFormat)

        mainMixer.installTap(onBus: 0, bufferSize: 2048, format: voiceIOFormat) { [weak self] buffer, _ in
            self?.processOutputBuffer(buffer)
            self?.updateOutputVolume()
        }

        avAudioEngine.prepare()
    }

    func processMicrophoneBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else {
            print("Error: Could not access channel data")
            return
        }

        let frameCount = Int(buffer.frameLength)
        var int16Samples = [Int16](repeating: 0, count: frameCount)

        for i in 0..<frameCount {
            let floatSample = max(-1.0, min(1.0, channelData[i]))
            int16Samples[i] = Int16(floatSample * Float(Int16.max))

            inputBuffer[inputBufferIndex] = floatSample
            inputBufferIndex = (inputBufferIndex + 1) % inputBuffer.count
        }

        let data = Data(bytes: int16Samples, count: frameCount * MemoryLayout<Int16>.size)
        onMicDataCallback?(data)
    }

    func processOutputBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else {
            print("Error: Could not access channel data")
            return
        }

        let frameCount = Int(buffer.frameLength)
        for i in 0..<frameCount {
            let floatSample = max(-1.0, min(1.0, channelData[i]))
            outputBuffer[outputBufferIndex] = floatSample
            outputBufferIndex = (outputBufferIndex + 1) % outputBuffer.count
        }
    }

    func start() {
        do {
            try avAudioEngine.start()
        } catch {
            print("Could not start audio engine: \(error)")
        }
    }

    private func startCapture() {
        activateCaptureSession()
        let input = avAudioEngine.inputNode
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            print("Could not enable voice processing \(error)")
        }
        input.isVoiceProcessingInputMuted = false
        if !inputTapInstalled {
            input.installTap(onBus: 0, bufferSize: 2048, format: voiceIOFormat) { [weak self] buffer, _ in
                if self?.isRecording == true && self?.discardRecording == false {
                    self?.processMicrophoneBuffer(buffer)
                    self?.updateInputVolume()
                }
            }
            inputTapInstalled = true
        }
        checkEngineIsRunning()
    }

    private func stopCapture() {
        let input = avAudioEngine.inputNode
        input.isVoiceProcessingInputMuted = true
        if inputTapInstalled {
            input.removeTap(onBus: 0)
            inputTapInstalled = false
        }
        if hasPendingPlayback {
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(.playback, mode: .default)
                try session.setActive(true)
                isSessionActive = true
            } catch {
                print("Could not transition to the playback audio session: \(error.localizedDescription)")
            }
            checkEngineIsRunning()
        } else {
            releaseAudioSession()
        }
    }

    func playPCMData(_ pcmData: Data) {
        if !isRecording {
            activatePlaybackSessionIfNeeded()
        }

        // Looks like we don't get a proper AEC for the very first chunks of audio that we play.
        // To work around this, we will discard microphone input for the first few milliseconds.
        // This will give the AEC time to adapt to the playback audio.
        // We achieve this by setting discardRecording to true for a short time (this doesn't
        // actually mute the input). It's just not processed in the tap.
        if !hasFirstInputBeenDiscarded {
            hasFirstInputBeenDiscarded = true
            discardRecording = true
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(discardFirstInputMillis)) {
                self.discardRecording = false
            }
        }

        guard let buffer = createBuffer(from: pcmData) else {
            print("Failed to create audio buffer")
            return
        }
        playbackCountLock.lock()
        pendingPlaybackBuffers += 1
        playbackCountLock.unlock()
        speechPlayer.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self = self else { return }
            self.playbackCountLock.lock()
            if self.pendingPlaybackBuffers > 0 {
                self.pendingPlaybackBuffers -= 1
            }
            let shouldReleaseSession = self.pendingPlaybackBuffers == 0
            self.playbackCountLock.unlock()
            if shouldReleaseSession {
                DispatchQueue.main.async { [weak self] in
                    self?.releaseAudioSession()
                }
            }
        }

        if !speechPlayer.isPlaying {
            speechPlayer.play()
        }
    }

    private func createBuffer(from data: Data) -> AVAudioPCMBuffer? {
        let frameCount = UInt32(data.count) / 2

        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        )!

        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
            return nil
        }

        buffer.frameLength = frameCount

        data.withUnsafeBytes { rawBufferPointer in
            if let sourcePtr = rawBufferPointer.baseAddress?.assumingMemoryBound(to: Int16.self),
               let destPtr = buffer.floatChannelData?[0] {
                for i in 0..<Int(frameCount) {
                    destPtr[i] = Float(sourcePtr[i]) / Float(Int16.max)
                }
            }
        }

        return buffer
    }

    func bypassVoiceProcessing(_ bypass: Bool) {
        let input = avAudioEngine.inputNode
        input.isVoiceProcessingBypassed = bypass
    }

    func toggleRecording(_ val: Bool) -> Bool {
        if val && !isRecording {
            startCapture()
        }
        isRecording = val
        if !isRecording {
            stopCapture()
            inputBuffer = [Float](repeating: 0, count: 2048)
            updateInputVolume()
        }
        print("Recording \(isRecording ? "started" : "stopped")")

        return isRecording
    }

    func stopRecordingAndPlayer() {
        toggleRecording(false)
        speechPlayer.stop()
        resetPendingPlayback()
        updateOutputVolume()
        releaseAudioSession()
    }

    /// `stop()` discards whatever is still scheduled, so the pending count has to be cleared with
    /// it. Leaving it non-zero would block every later release.
    private func resetPendingPlayback() {
        playbackCountLock.lock()
        pendingPlaybackBuffers = 0
        playbackCountLock.unlock()
    }

    func resumeRecordingAndPlayer() {
        isRecording = toggleRecording(true)
        if hasPendingPlayback {
            speechPlayer.play()
        }
    }

    func tearDown() {
        stopRecordingAndPlayer()
        avAudioEngine.stop()
    }

    var isPlaying: Bool {
        return speechPlayer.isPlaying
    }

    func stopPlayback() {
        speechPlayer.stop()
        resetPendingPlayback()
        outputBuffer = [Float](repeating: 0, count: 2048)
        updateOutputVolume()
        releaseAudioSession()
        print("Playback stopped")
    }

    func pausePlayback() {
        speechPlayer.pause()
        print("Playback paused")
    }

    func resumePlayback() {
        if !isRecording {
            activatePlaybackSessionIfNeeded()
        }
        if !speechPlayer.isPlaying {
            speechPlayer.play()
            print("Playback resumed")
        }
    }

    private func checkEngineIsRunning() {
        // Starting the engine implicitly reactivates the audio session. Never do that while the
        // session is released, or a stray configuration-change notification would silently grab
        // the user's audio back and undo the release.
        guard isSessionActive else { return }
        if !avAudioEngine.isRunning {
            start()
        }
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            shouldResumeRecordingAfterInterruption = isRecording
            stopRecordingAndPlayer()
            onAudioInterruptionCallback?("began")
        case .ended:
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    if shouldResumeRecordingAfterInterruption {
                        resumeRecordingAndPlayer()
                    }
                    shouldResumeRecordingAfterInterruption = false
                    onAudioInterruptionCallback?("ended")
                } else {
                    shouldResumeRecordingAfterInterruption = false
                    onAudioInterruptionCallback?("blocked")
                }
            }
        @unknown default:
            fatalError("Unknown type: \(type)")
        }
    }

    private func handleMediaServicesWereReset() {
        avAudioEngine.stop()
        setup()
        if isRecording {
            startCapture()
            return
        }
        guard isSessionActive else { return }
        start()
    }

    private func updateInputVolume() {
        let volume = calculateRMSLevel(from: inputBuffer)
        onInputVolumeCallback?(volume)
    }

    private func updateOutputVolume() {
        let volume = calculateRMSLevel(from: outputBuffer)
        onOutputVolumeCallback?(volume)
    }

    private func calculateRMSLevel(from buffer: [Float]) -> Float {
        let epsilon: Float = 1e-5
        let rmsValue = sqrt(buffer.reduce(0) { $0 + $1 * $1 } / Float(buffer.count))
        let dbValue = 20 * log10(max(rmsValue, epsilon))
        let minDb: Float = -80.0
        let normalizedValue = max(0.0, min(1.0, (dbValue - minDb) / abs(minDb)))
        let expFactor: Float = 2.0
        let adjustedValue = pow(normalizedValue, expFactor)
        return adjustedValue
    }
}
