"""Database migration helper. Planted: a Linux-only home path and a Unix-only virtualenv activation (hardcoded-paths, python-assumptions)."""
import subprocess

APP_ROOT = "/home/deploy/demo-shop"


def migrate():
    subprocess.run("source venv/bin/activate && python manage.py migrate", shell=True, cwd=APP_ROOT, check=True)


if __name__ == "__main__":
    migrate()
