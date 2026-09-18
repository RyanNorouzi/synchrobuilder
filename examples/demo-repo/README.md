# demo-shop

A tiny order service (Node + Python) that only works on the laptop it was
written on. It exists so `npx synchrobuilder audit examples/demo-repo` has
something realistic to find. Every bug is deliberate; do not fix them here.

## Setup

```
brew install node@20 python@3.12 sqlite
brew services start postgresql@16
npm install
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
npm run build
```

## Planted portability bugs

| Rule id | Where | What is wrong |
| :-- | :-- | :-- |
| `import-casing` | `src/index.js` | Imports `./utils/Helper.js`; the file on disk is `src/utils/helper.js`. Works only on case-insensitive disks. |
| `case-duplicates` | planted by the test | Two paths that differ only by case cannot be checked out on a case-insensitive disk, so this repository cannot contain them. `tests/integration/audit-demo.test.mjs` creates `src/utils/Helper.js` next to `helper.js` in a temporary copy when the file system is case-sensitive. |
| `unix-scripts` | `package.json` | Scripts use `rm -rf`, `cp`, `mkdir -p`, `export VAR=`, `VAR=value cmd`, `sh`, and `&&` chains that assume a POSIX shell. |
| `hardcoded-paths` | `src/config.js`, `scripts/migrate.py` | `/Users/alice/...`, `C:\Users\alice\...`, `/tmp/...`, `/opt/homebrew/...`, `/home/deploy/...`. |
| `shell-scripts` | `build.sh` (required by `npm run build`) | A shell script with no Node, `.cmd` or `.ps1` equivalent. |
| `line-endings` | `scripts/test.sh` | Committed with CRLF line endings and there is no `.gitattributes`, so `sh` fails on the carriage returns. |
| `exec-bits-symlinks` | `build.sh`, `bin/demo` | `build.sh` has no executable bit although `package.json` runs `./build.sh`; `bin/demo` is a symlink, which some checkouts turn into a plain text file. |
| `illegal-filenames` | planted by the test | A reserved device name or a trailing space in a file name cannot be created on every OS, so the repository cannot contain one. The test creates `src/aux.js` and `NOTES .md` in a temporary copy where the file system allows it. |
| `python-assumptions` | `package.json`, `scripts/test.sh`, `scripts/migrate.py` | Calls `python` (not `python3` or `py`) and activates `venv/bin/activate`, which is `venv\Scripts\activate` elsewhere. |
| `native-deps` | `package.json` | Depends on `sqlite3`, a native addon that needs a compiler toolchain or a prebuilt binary for the exact platform. |
| `readme-one-os` | this file, "Setup" | Setup steps use `brew` only and `source venv/bin/activate`. |

Also planted for `/synchrobuilder:fix` (Phase 3): `src/index.js` builds a
path with string concatenation instead of `path.join`.

`vendor-copy/legacy.js` contains a hard-coded path on purpose and is excluded
by `audit.ignore` in `.synchrobuilder/config.json`; the audit must not report
it.
