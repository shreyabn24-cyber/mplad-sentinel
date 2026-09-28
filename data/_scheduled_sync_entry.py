import subprocess, sys
LOG = r'D:\Team Ojas SIH\data\raw\schedule\sync_scheduled.log'
CMD = [r'C:\Users\Shreya\AppData\Local\Programs\Python\Python313\python.EXE', r'D:\Team Ojas SIH\data\sync_live_data.py', '--layers', 'mospi,works,geocode']
with open(LOG, 'a', encoding='utf-8', errors='replace') as fh:
    fh.write('\n=== ' + __import__('datetime').datetime.now().isoformat() + ' ===\n')
    fh.flush()
    raise SystemExit(subprocess.call(CMD, stdout=fh, stderr=subprocess.STDOUT))
