"""스킬쟁이 릴스 음성: Qwen3-TTS Base 로 기준 음성(목소리 복제)을 따라 줄마다 wav 를 만든다.

hermes-skill-reels.py 가 torch 가 깔린 전용 venv 의 python 으로 이 파일을 실행한다(본 스크립트의 python 에는 torch 가 없다).
stdin: {"lines": [...], "ref_audio": 경로, "ref_text": 기준 음성의 대사, "out_dir": 경로}
출력: out_dir/line{i}.wav (모델 기본 샘플레이트, mono)와, 줄마다 stdout 에 {"line", "attempts", "similarity"} JSON 한 줄.

줄마다 따로 만들면 가끔 다른 목소리로 미끄러진다(2026-11-04: 사용자가 0:32~0:35 에서 "목소리가 달라짐"을 지적).
그래서 샘플링 온도를 낮추고, 만든 직후 모델의 화자 특징(speaker embedding)을 기준 음성과 비교해 다른 사람 같으면 다시 만든다.
목소리 높이(F0)로도 재 봤지만 문장 끝 억양 하강과 구분되지 않았다. 화자 유사도는 지적 구간만 0.966 으로 떨어지고
나머지는 0.978~0.987 이었다.
`python -I hermes-skill-reels-tts.py --self-check` 는 모델 없이 판정 로직만 확인한다.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
TEMPERATURE = 0.6  # 기본 0.9 는 줄마다 목소리가 흔들렸다
MIN_SIMILARITY = 0.975
MAX_ATTEMPTS = 4


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def pick_best(candidates: list[tuple[float, object]]) -> tuple[float, object]:
    """(유사도, 음성) 시도들 중 가장 기준 목소리에 가까운 것."""
    return max(candidates, key=lambda item: item[0])


def self_check() -> None:
    assert abs(cosine(np.array([1.0, 0.0]), np.array([2.0, 0.0])) - 1.0) < 1e-9
    assert abs(cosine(np.array([1.0, 0.0]), np.array([0.0, 1.0]))) < 1e-9
    assert pick_best([(0.96, "a"), (0.98, "b"), (0.97, "c")]) == (0.98, "b")
    print("self-check ok")


def main() -> None:
    import torch
    from qwen_tts import Qwen3TTSModel

    request = json.load(sys.stdin)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = Qwen3TTSModel.from_pretrained(MODEL, device_map=device,
                                          dtype=torch.bfloat16 if device == "mps" else torch.float32)

    def speaker(audio: object) -> np.ndarray:
        item = model.create_voice_clone_prompt(ref_audio=audio, x_vector_only_mode=True)[0]
        return item.ref_spk_embedding.float().flatten().cpu().numpy()

    prompt = model.create_voice_clone_prompt(ref_audio=request["ref_audio"], ref_text=request["ref_text"])
    reference = speaker(request["ref_audio"])
    out_dir = Path(request["out_dir"])
    for index, text in enumerate(request["lines"]):
        tries: list[tuple[float, tuple]] = []
        for attempt in range(MAX_ATTEMPTS):
            torch.manual_seed(1000 * index + attempt)
            wavs, sample_rate = model.generate_voice_clone(text=text, language="Korean", voice_clone_prompt=prompt,
                                                           temperature=TEMPERATURE, subtalker_temperature=TEMPERATURE)
            similarity = cosine(reference, speaker((np.asarray(wavs[0], dtype=np.float32), sample_rate)))
            tries.append((similarity, (wavs[0], sample_rate)))
            if similarity >= MIN_SIMILARITY:
                break
        similarity, (wav, sample_rate) = pick_best(tries)
        sf.write(out_dir / f"line{index}.wav", wav, sample_rate)
        print(json.dumps({"line": index, "attempts": len(tries), "similarity": round(similarity, 3)}), flush=True)


if __name__ == "__main__":
    if "--self-check" in sys.argv[1:]:
        self_check()
    else:
        main()
