// Manifold → .bin (Float32 Dreiecks-Ecken)
function _ksuBin(m, f) { const me = m.getMesh(), v = me.vertProperties, t = me.triVerts, np = me.numProp, o = new Float32Array(t.length * 3);
  for (let i = 0; i < t.length; i++) for (let k = 0; k < 3; k++) o[i * 3 + k] = v[t[i] * np + k]; require_fs().writeFileSync(f, Buffer.from(o.buffer)); }
