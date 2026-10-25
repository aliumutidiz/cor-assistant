#!/usr/bin/python3
"""Offline decoder readiness/silence check, run as the unprivileged app user.

This does not certify transcription accuracy on a real Turkish voice message.
"""
import json
import os
from pathlib import Path
import tempfile
import wave


def main():
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    root = Path('/opt/cor-speech')
    if not (root / 'ready').is_file():
        raise RuntimeError('Provisioning has not completed')
    from faster_whisper import WhisperModel
    model = WhisperModel(str(root / 'models/small'), device='cpu', compute_type='int8',
                         local_files_only=True, cpu_threads=4)
    with tempfile.TemporaryDirectory(prefix='cor-speech-check-') as temporary:
        path = Path(temporary) / 'silence.wav'
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b'\0' * 2 * 16000 * 2)
        segments, _ = model.transcribe(str(path), language='tr', vad_filter=True,
                                       condition_on_previous_text=False)
        text = ' '.join(segment.text.strip() for segment in segments).strip()
        if text:
            raise RuntimeError('Silence unexpectedly produced text')
    print(json.dumps({'offlineModelLoaded': True, 'silenceRejected': True,
                      'realTurkishVoiceVerified': False,
                      'model': json.loads((root / 'model.json').read_text())}))


if __name__ == '__main__':
    main()
