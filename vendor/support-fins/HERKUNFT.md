# Support Fins – Rechenkern (übernommen)

Quelle: https://github.com/gittrahan/support-fins (printfins.com)
Stand: Commit 2a78e79f73c8e952f3f5ac4903460f6631c795c7 (20.10.2026)
Lizenz: MIT (siehe LICENSE), Copyright (c) 2026 gittrahan

Übernommen ist nur der reine Rechenkern aus `web/` (Netz-Mathematik, kein DOM,
kein three.js). Die Bedienung in V3D CAD ist eigener Code (_sfn* in volme3d.html).
Gebündelt wird er von tools/stuetzfinnen-worker.src.js → lib/stuetzfinnen-worker.js
(`node tools/bau_stuetzfinnen.mjs`). Dateien hier nicht ändern, sondern bei
Bedarf neu vom Original übernehmen.
