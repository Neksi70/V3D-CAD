#!/usr/bin/env python3
# VolmeStick - Einstieg fuer die gebaute EXE.
#
# Beim Doppelklick gibt es keine Kommandozeilenargumente, also werden sie hier
# gesetzt: Oberflaeche nur auf diesem Rechner, Browser gleich aufmachen.

import os
import sys

if getattr(sys, "frozen", False):
    os.chdir(os.path.dirname(sys.executable))

import server        # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv += ["--host", "127.0.0.1", "--port", "8775", "--browser"]
    sys.exit(server.main())
