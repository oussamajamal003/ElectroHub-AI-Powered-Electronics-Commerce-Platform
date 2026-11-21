from __future__ import annotations

from app.healthcheck import is_ready


def test_model_and_both_index_backed_features_are_required_for_readiness() -> None:
    ready = {
        "data": {
            "modelReady": True,
            "features": {
                "imageSearch": {"available": True},
                "recommendations": {"available": True},
            },
        }
    }
    assert is_ready(ready)
    assert not is_ready({"data": {**ready["data"], "modelReady": False}})
    assert not is_ready({"data": {"modelReady": True, "features": {"imageSearch": {"available": True}}}})
    assert not is_ready({"data": {"modelReady": True, "features": {
        "imageSearch": {"available": True}, "recommendations": {"available": False}
    }}})
    assert not is_ready(None)
