"""Bounded read-only SQLite bridge for Node builds without node:sqlite.
No third-party modules. Raw metadata passes through the private pipe only, never a file.
"""
import base64
import json
import os
from pathlib import Path
import sqlite3
import sys

MAX_ROWS = 50000
MAX_BYTES = 128 * 1024 * 1024
MAX_BLOB = 16 * 1024 * 1024

def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)

def main():
    db = None
    try:
        file = Path(sys.argv[1]).resolve(strict=True)
        db = sqlite3.connect(file.as_uri() + "?mode=ro", uri=True, timeout=1)
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("BEGIN")
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "gen_metadata" not in tables:
            emit({"error":"unsupported-database-schema"}); return
        rows = 0
        size = 0
        for table, col, kind in [("gen_metadata", "data", "generation"), ("steps", "metadata", "step")]:
            if table not in tables:
                continue
            columns = {r[1] for r in db.execute('PRAGMA table_info("' + table + '")')}
            if "idx" not in columns or col not in columns:
                emit({"error":"unsupported-database-schema"}); return
            for idx, length, blob in db.execute(f'SELECT idx,length("{col}"),CASE WHEN length("{col}")<={MAX_BLOB} THEN "{col}" ELSE NULL END FROM "{table}" WHERE "{col}" IS NOT NULL ORDER BY idx'):
                rows += 1
                if rows > MAX_ROWS or not isinstance(blob,bytes) or length > MAX_BLOB:
                    emit({"error":"database-read-limit"}); return
                size += length
                if size > MAX_BYTES:
                    emit({"error":"database-read-limit"}); return
                emit({"kind":kind,"idx":idx,"data":base64.b64encode(blob).decode("ascii")})
        emit({"done":True})
    except sqlite3.OperationalError as e:
        emit({"error":"database-busy" if "locked" in str(e) or "busy" in str(e) else "database-open-or-schema-error"})
    except Exception:
        emit({"error":"database-read-error"})
    finally:
        if db is not None:
            db.close()

if __name__ == "__main__":
    main()
