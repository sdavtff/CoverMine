// Web Worker: gera o atlas de texturas sem travar a interface.
import { buildAtlas } from './textures.js';
self.onmessage = (e) => {
  const a = buildAtlas(e.data.T);
  self.postMessage(a, [a.albedo.buffer, a.normal.buffer, a.orm.buffer]);
};
