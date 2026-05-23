# opencascade.js v1.1.1 — API-Erkenntnisse

## Funktioniert
- BRepPrimAPI_MakeBox_2(pt, w, h, d) — Box erstellen
- BRepFilletAPI_MakeChamfer(shape) + Add_2(dist, edge) + Build()
- BRepFilletAPI_MakeFillet(shape, ChFi3d_Rational) + Add_2(radius, edge) + Build()

## Wichtig
- Chamfer nur auf geraden Kanten (GeomAbs_Line), nicht auf Fillet-Bögen
- Chamfer VOR Fillet ausführen
- Kanten filtern: BRepAdaptor_Curve_2(edge).GetType() === GeomAbs_CurveType.GeomAbs_Line
- Build() ohne Suffix (nicht Build_1 oder Build_2)
- WASM: 63MB von unpkg (jsdelivr blockiert .wasm)
