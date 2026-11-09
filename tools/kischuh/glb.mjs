// GLB (Hunyuan3D) in Node einlesen → {pos: Float32Array, idx: Uint32Array}
import fs from 'fs';
export function leseGLB(file) {
  const b = fs.readFileSync(file), jl = b.readUInt32LE(12), J = JSON.parse(b.slice(20, 20 + jl).toString());
  const bin = b.slice(20 + jl + 8);
  const acc = i => { const a = J.accessors[i], v = J.bufferViews[a.bufferView], o = (v.byteOffset || 0) + (a.byteOffset || 0);
    const n = a.count * ({ SCALAR: 1, VEC3: 3 }[a.type]), T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    return new T(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + n * T.BYTES_PER_ELEMENT)); };
  const P = [], I = []; let off = 0;
  for (const m of J.meshes) for (const pr of m.primitives) {
    const p = acc(pr.attributes.POSITION), ix = pr.indices != null ? acc(pr.indices) : Array.from({ length: p.length / 3 }, (_, i) => i);
    P.push(p); I.push(Array.from(ix, v => v + off)); off += p.length / 3;
  }
  const pos = new Float32Array(off * 3); let o = 0; for (const p of P) { pos.set(p, o); o += p.length; }
  return { pos, idx: new Uint32Array(I.flat()), nodes: J.nodes };
}
