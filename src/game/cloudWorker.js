// Runs the cloud simulation + meshing off the main thread.
// in:  { dt, car|null, emits: Float32Array (packed, 19 per parcel), bufs: {pos,nrm,col} }
// out: { vcount, sideArea, timing, bufs } (buffers transferred back for reuse)
import { CloudCore } from './CloudCore.js';

const core = new CloudCore();
const V = { x: 0, y: 0, z: 0 }, W = { x: 0, y: 0, z: 0 };

self.onmessage = (e) => {
  const { dt, car, emits, bufs, clear, prm } = e.data;
  if (clear) core.clear();
  for (let o = 0; o + 19 <= emits.length; o += 19) {
    V.x = emits[o]; V.y = emits[o + 1]; V.z = emits[o + 2];
    W.x = emits[o + 3]; W.y = emits[o + 4]; W.z = emits[o + 5];
    core.emit(V, W, {
      mass: emits[o + 6], r0: emits[o + 7], r1: emits[o + 8], life: emits[o + 9], hold: emits[o + 10],
      color: [emits[o + 11], emits[o + 12], emits[o + 13]], drag: emits[o + 14], rise: emits[o + 15],
      ring: emits[o + 16] ? { x: emits[o + 17], z: emits[o + 18] } : null,
    });
  }
  const out = { pos: new Float32Array(bufs.pos), nrm: new Float32Array(bufs.nrm), col: new Float32Array(bufs.col), maxV: bufs.maxV };
  const vcount = core.update(dt, car, out, prm);
  const vol = core.vol ? core.vol.slice() : null;
  self.postMessage({ vcount, sideArea: core.sideArea, denseArea: core.denseArea, sideW: core.sideW, sideTop: core.sideTop, timing: core.timing, bufs, vol, volInfo: core.volInfo }, vol ? [bufs.pos, bufs.nrm, bufs.col, vol.buffer] : [bufs.pos, bufs.nrm, bufs.col]);
};
