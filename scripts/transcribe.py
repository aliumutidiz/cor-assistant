"""Offline-only Turkish speech decoding. No API, no credentials, no downloads."""
import json
import os
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

MAX_AUDIO_SECONDS = 120


class AudioLimitError(ValueError):
    pass


def bounded_audio(source):
    import av
    import numpy as np
    chunks = []
    samples = 0
    with av.open(source) as container:
        stream = container.streams.audio[0]
        if stream.duration is not None and stream.time_base is not None:
            if float(stream.duration * stream.time_base) > MAX_AUDIO_SECONDS + 0.1:
                raise AudioLimitError()
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        def append(frame):
            nonlocal samples
            samples += frame.samples
            if samples > 16000 * MAX_AUDIO_SECONDS:
                raise AudioLimitError()
            chunks.append(frame.to_ndarray().reshape(-1))
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                append(converted)
        for converted in resampler.resample(None):
            append(converted)
    if not chunks:
        raise ValueError("No audio samples")
    return np.concatenate(chunks).astype(np.float32) / 32768.0

def main():
    source, model_path = sys.argv[1:3]
    if not os.path.isdir(model_path):
        raise ValueError("A pre-downloaded local model directory is required")
    import av
    try:
        audio = bounded_audio(source)
    except AudioLimitError:
        print(json.dumps({"error": "audio_too_long"}))
        return
    except (av.error.FFmpegError, ValueError, IndexError):
        print(json.dumps({"error": "invalid_audio"}))
        return
    from faster_whisper import WhisperModel
    model = WhisperModel(model_path, device="cpu", compute_type="int8", local_files_only=True, cpu_threads=4)
    segments, _ = model.transcribe(audio, language="tr", beam_size=5, vad_filter=True,
                                    condition_on_previous_text=False)
    segments = list(segments)
    text = " ".join(s.text.strip() for s in segments).strip()
    reliable = bool(text) and all(s.avg_logprob >= -1.0 and s.no_speech_prob < 0.65 for s in segments)
    print(json.dumps({"text": text, "reliable": reliable}, ensure_ascii=False))

if __name__ == "__main__":
    main()
