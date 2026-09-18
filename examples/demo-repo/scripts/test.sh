#!/bin/sh
# Planted: CRLF line endings in a shell script; sh rejects the carriage returns (line-endings). No .gitattributes normalizes it.
source venv/bin/activate
python -m pytest tests
