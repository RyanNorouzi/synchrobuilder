#!/bin/sh
# python is mentioned in this comment, which is fine
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python3 -m pytest
