#!/bin/sh
python3 -m venv .venv
python3 -m pip install -r requirements.txt
python3 app.py
pip-compile requirements.in
