#!/bin/sh
# Einmalig: Python-Umgebung + OCR-Modell für „Rechnung erfassen" (erfassen.py)
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q rapidocr-onnxruntime factur-x pillow
mkdir -p ocr-modell
for f in rec.onnx dict.txt config.json; do
  [ -s ocr-modell/$f ] || curl -sLf -o ocr-modell/$f "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/latin/$f"
done
echo "fertig: $(.venv/bin/python -c 'import rapidocr_onnxruntime, facturx; print("OCR + Factur-X ok")')"
