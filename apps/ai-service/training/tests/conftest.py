import sys
from pathlib import Path

# Training modules import each other flatly (as they do inside the Kaggle kernel bundle); the network definition is
# the one shipped with the serving app.
training = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(training / "src"), str(training.parent / "app" / "models")]
