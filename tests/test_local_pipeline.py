from backend.app import validate_audio_file, summarize_transcript


def test_validate_audio_file_accepts_supported_extensions():
    assert validate_audio_file("sample.mp3", 2 * 1024 * 1024) is None
    assert validate_audio_file("notes.wav", 5 * 1024 * 1024) is None


def test_validate_audio_file_rejects_unsupported_extension():
    error = validate_audio_file("sample.txt", 1_024)
    assert error is not None
    assert "Unsupported" in error


def test_summarize_transcript_returns_key_points_from_text():
    summary = summarize_transcript("We decided to launch the redesign on Friday. Nina will send the final mockups by Tuesday. We also agreed to review the onboarding flow.")
    assert "redesign" in summary.lower()
    assert len(summary) > 0
