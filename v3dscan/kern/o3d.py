# Open3D einbinden.
#
# open3d.visualization zieht beim Import plotly und dash nach (nur fuer
# draw_plotly). Die EXE liefert beides nicht mit - dafuer stehen hier leere
# Platzhalter-Module, deren Attribute beim Zugriff einfach None sind.

import sys
import types


def _platzhalter(name):
    m = types.ModuleType(name)
    m.__getattr__ = lambda attr: None
    return m


for _paket, _unter in (("plotly", ("plotly.graph_objects",)), ("dash", ())):
    try:
        __import__(_paket)
    except ImportError:
        sys.modules[_paket] = _platzhalter(_paket)
        for _u in _unter:
            sys.modules[_u] = _platzhalter(_u)

import open3d  # noqa: E402

o3d = open3d
reg = open3d.pipelines.registration

try:
    open3d.utility.set_verbosity_level(open3d.utility.VerbosityLevel.Error)
except Exception:
    pass
