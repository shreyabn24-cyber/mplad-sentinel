"""
Windows Task Scheduler installer
================================
Registers a scheduled task that refreshes the real data layers.

The task runs ``python data/sync_live_data.py`` on a daily schedule and writes
a per-run log under ``data/raw/schedule/``. It is created with
``schtasks.exe /Create`` so no extra dependency is required.

Usage
-----
    python data/install_scheduled_sync.py                     # daily 03:15
    python data/install_scheduled_sync.py --time 04:30
    python data/install_scheduled_sync.py --frequency weekly --weekday MON
    python data/install_scheduled_sync.py --remove
    python data/install_scheduled_sync.py --show

Notes
-----
* The task runs as the current user. If that user is not logged in at the
  trigger time the run is skipped, so prefer a time when the machine is on.
* ``--no-ingest`` omits the PostgreSQL step, which is useful until a live
  database is provisioned.
* The sync writes a provenance manifest; verify it with
  ``python scripts/audit_provenance.py``.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
TASK_NAME = "OjasMPLADSSentinelSync"
LOG_DIR = ROOT / "data" / "raw" / "schedule"

FREQ_DAILY = {"schedule": "DAILY", "weekday": None}
FREQ_WEEKLY = {"schedule": "WEEKLY", "weekday": "MON"}

# schtasks weekday tokens differ from Python weekday numbers.
WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def find_python() -> str:
    exe = shutil.which("python") or shutil.which("python3")
    if not exe:
        raise SystemExit("python not found on PATH")
    return exe


def write_runner(python: str, no_ingest: bool) -> Path:
    """Write the batch wrapper that the task actually invokes.

    Passing a quoted command with redirection inline to ``schtasks /TR`` is
    fragile: schtasks re-parses the string through cmd, and the quoting rules
    differ enough between the nested layers that the task fails with
    "The filename, directory name, or volume label syntax is incorrect" or
    simply never starts python. A batch file sidesteps the whole problem
    because cmd only has to open one path.
    """
    sync = ROOT / "data" / "sync_live_data.py"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    # Append from python rather than with a cmd ">>" redirect. Several cmd
    # instances can hold the same log open at once, and the shell redirect then
    # fails with "The process cannot access the file because it is being used
    # by another process", silently producing an empty log. Opening the file
    # from python with a shared append handle is reliable.
    launcher = ROOT / "data" / "_scheduled_sync_entry.py"
    launcher.write_text(
        "import subprocess, sys\n"
        f"LOG = r'{LOG_DIR / 'sync_scheduled.log'}'\n"
        f"CMD = [r'{python}', r'{sync}'"
        + (", '--layers', 'mospi,works,geocode'" if no_ingest else "")
        + "]\n"
        "with open(LOG, 'a', encoding='utf-8', errors='replace') as fh:\n"
        "    fh.write('\\n=== ' + __import__('datetime').datetime.now().isoformat() + ' ===\\n')\n"
        "    fh.flush()\n"
        "    raise SystemExit(subprocess.call(CMD, stdout=fh, stderr=subprocess.STDOUT))\n",
        encoding="utf-8",
    )
    runner = LOG_DIR / "run_sync.bat"
    runner.write_text(
        "@echo off\r\n"
        f'"{python}" "{launcher}"\r\n'
        f"exit /b %ERRORLEVEL%\r\n",
        encoding="ascii",
    )
    return runner


def show() -> int:
    result = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"],
        capture_output=True,
        text=True,
    )
    print(result.stdout or result.stderr)
    return result.returncode


def remove() -> int:
    result = subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
                            capture_output=True, text=True)
    print(result.stdout.strip() or result.stderr.strip())
    if result.returncode == 0:
        print(f"Removed scheduled task {TASK_NAME}")
    return result.returncode


def install(time_str: str, freq: dict, no_ingest: bool) -> int:
    python = find_python()
    runner = write_runner(python, no_ingest)

    args = [
        "schtasks", "/Create",
        "/TN", TASK_NAME,
        "/TR", f'"{runner}"',
        "/SC", freq["schedule"],
        "/ST", time_str,
        "/F",
    ]
    if freq.get("weekday"):
        args += ["/D", freq["weekday"]]

    print("Registering scheduled task:")
    print(f"  name      : {TASK_NAME}")
    print(f"  schedule  : {freq['schedule'].lower()} at {time_str}" + (f" ({freq['weekday']})" if freq.get("weekday") else ""))
    print(f"  runner    : {runner}")
    print(f"  log       : {LOG_DIR / 'sync_scheduled.log'}")
    print(f"  layers    : {'mospi,works,geocode' if no_ingest else 'mospi,works,geocode,ingest'}")

    result = subprocess.run(args, capture_output=True, text=True)
    output = (result.stdout or result.stderr).strip()
    print(f"\n{output}")

    if result.returncode == 0:
        print("\nTask registered. Verify with:")
        print(f"  schtasks /Query /TN {TASK_NAME} /V /FO LIST")
        print(f"  python {ROOT / 'data' / 'install_scheduled_sync.py'} --show")
        print("\nNote: the task runs as the current user, so it only fires while this")
        print("account is logged in. Trigger it once now to confirm end to end:")
        print(f"  schtasks /Run /TN {TASK_NAME}")
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Install the daily real-data sync task.")
    parser.add_argument("--time", default="03:15", help="HH:MM local time (default 03:15)")
    parser.add_argument("--frequency", choices=["daily", "weekly"], default="daily")
    parser.add_argument("--weekday", choices=[d.lower() for d in WEEKDAYS], default="mon")
    parser.add_argument("--no-ingest", action="store_true",
                        help="Skip the PostgreSQL layer (no live DB yet).")
    parser.add_argument("--remove", action="store_true", help="Delete the task and exit.")
    parser.add_argument("--show", action="store_true", help="Print the current task and exit.")
    args = parser.parse_args()

    if args.show:
        return show()
    if args.remove:
        return remove()

    parts = args.time.split(":")
    if len(parts) != 2 or not all(p.isdigit() for p in parts):
        raise SystemExit(f"invalid --time {args.time!r}, expected HH:MM")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise SystemExit(f"--time out of range: {args.time!r}")

    if args.frequency == "weekly":
        freq = {"schedule": "WEEKLY", "weekday": args.weekday.upper()}
    else:
        freq = FREQ_DAILY

    return install(args.time, freq, args.no_ingest)


if __name__ == "__main__":
    raise SystemExit(main())
