// 一次性脚本：生成 Miku 配色渐变 hero.png（不依赖外部图源）
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const W = 1280, H = 720;
const accent = [0x24, 0xc9, 0xd7];     // 青绿
const secondary = [0xef, 0x8f, 0xd3];  // 粉
const surface = [0xf7, 0xfb, 0xff];    // 近白

const raw = Buffer.alloc((W * 3 + 1) * H);
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    // 对角渐变 accent -> secondary，右上偏亮
    const t = (x / W + y / H) / 2;
    const r = accent[0] + (secondary[0] - accent[0]) * t;
    const g = accent[1] + (secondary[1] - accent[1]) * t;
    const b = accent[2] + (secondary[2] - accent[2]) * t;
    // 右上角混入 surface 让背景图主体偏亮、不抢 UI
    const lift = (1 - t) * 0.35;
    raw[o++] = Math.round(r * (1 - lift) + surface[0] * lift);
    raw[o++] = Math.round(g * (1 - lift) + surface[1] * lift);
    raw[o++] = Math.round(b * (1 - lift) + surface[2] * lift);
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const idat = deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(process.argv[2], png);
console.log(`生成 ${process.argv[2]}: ${W}x${H}, ${png.length} bytes`);
