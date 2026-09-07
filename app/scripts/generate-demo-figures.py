"""Run the self-contained demonstration figure generator."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[2]/"examples"/"demo"/"tools"/"generate-figures.py"), run_name="__main__")
