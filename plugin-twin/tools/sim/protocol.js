// tools/sim/protocol.js — minimal RFC 6455 WebSocket framing + handshake, shared by the sim
// server (server.js, server side of the wire) and the live recorder (record.js, CLIENT side).
//
// One module on purpose: the framing constants are a cross-file agreement between the two ends
// (a masked client frame the server can't parse, or an Accept the client computes differently,
// is a silent interop break), so both ends read the SAME named constants. Server side speaks
// only what a data source needs — no fragmentation, no permessage-deflate. Client side adds the
// two things RFC 6455 requires of a client that a server never needs: the §4.1 opening
// handshake (random Sec-WebSocket-Key, §4.2.2 Accept validation) and §5.3 outbound masking
// (clients MUST mask; servers MUST NOT — §5.2).
//
// Dependency-free by design: the materialized tools/ ships no package.json, so this must run
// under a bare `node` (see server.js's header for the full rationale).
import crypto from "node:crypto";

// --- WebSocket handshake (RFC 6455 §1.3, §4.1, §4.2.2) ---
/** The magic GUID concatenated to the client's Sec-WebSocket-Key before SHA-1 + base64 to form
 * Sec-WebSocket-Accept. Fixed by RFC 6455 §1.3 — not a choice. Used by BOTH ends: the server to
 * answer, the client to validate the answer (§4.2.2 step 4). */
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Byte length of the random nonce a client base64-encodes into Sec-WebSocket-Key. Fixed by
 * RFC 6455 §4.1 ("randomly selected 16-byte value") — not a choice. */
const WS_KEY_NONCE_BYTES = 16;

/** The Sec-WebSocket-Version a client MUST send. 13 is the only version RFC 6455 defines
 * (§4.1 item 9). */
export const WS_PROTOCOL_VERSION = 13;

/** HTTP status of a successful upgrade response — the client MUST fail the connection on any
 * other status (RFC 6455 §4.2.2 / §4.1; 101 Switching Protocols per RFC 7231 §6.2.2). */
export const HTTP_SWITCHING_PROTOCOLS = 101;

/** Compute Sec-WebSocket-Accept for a Sec-WebSocket-Key: base64(SHA-1(key + WS_GUID)).
 * RFC 6455 §4.2.2 step 5.4 (server) and §4.1 step 4 (client-side validation).
 * @param {string} key @returns {string} */
export function secWebSocketAccept(key) {
  return crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

/** A fresh random Sec-WebSocket-Key for a client opening handshake (RFC 6455 §4.1).
 * @returns {string} */
export function makeSecWebSocketKey() {
  return crypto.randomBytes(WS_KEY_NONCE_BYTES).toString("base64");
}

// --- RFC 6455 framing constants ---
/** FIN(0x80) | opcode 0x1 (text): a complete, unfragmented text frame — every data frame the sim
 * sends. RFC 6455 §5.2 (framing), §5.6 (text). */
export const FIN_TEXT_FRAME = 0x81;

/** FIN(0x80) | opcode 0xA (pong): a complete pong control frame. RFC 6455 §5.5.3. */
export const FIN_PONG_FRAME = 0x8a;

/** FIN(0x80) | opcode 0x8 (close): a complete close control frame. RFC 6455 §5.5.1. */
export const FIN_CLOSE_FRAME = 0x88;

/** Low nibble of byte 0 = opcode. RFC 6455 §5.2. */
const OPCODE_MASK = 0x0f;

/** Opcode 0x1 = text — the recorder filters for these on the client side. RFC 6455 §5.6. */
export const OPCODE_TEXT = 0x1;

/** Opcode 0x8 = connection close. RFC 6455 §5.5.1. */
export const OPCODE_CLOSE = 0x8;

/** Opcode 0x9 = ping (answered with a pong). RFC 6455 §5.5.2. */
export const OPCODE_PING = 0x9;

/** High bit of byte 1 = MASK. Clients MUST mask; servers MUST NOT. RFC 6455 §5.2, §5.3. */
const MASK_BIT = 0x80;

/** Low 7 bits of byte 1 = payload length, or a 126/127 escape. RFC 6455 §5.2. */
const PAYLOAD_LEN_MASK = 0x7f;

/** Payload-length escape 126: the real length is the next 2 bytes (UInt16BE). RFC 6455 §5.2. */
const LEN_16BIT_MARKER = 126;

/** Payload-length escape 127: the real length is the next 8 bytes (UInt64BE). RFC 6455 §5.2. */
const LEN_64BIT_MARKER = 127;

/** Masking-key length in bytes when MASK is set. RFC 6455 §5.3. */
const MASK_KEY_BYTES = 4;

/** Bytes of a UInt32 field — the 64-bit extended length is written as two of these. */
const UINT32_BYTES = 4;

/** Header size (bytes) when the length fits the 7-bit field (< 126): byte0 + byte1. Also the
 * minimum bytes needed before a frame header can be parsed at all. */
const HEADER_SHORT_BYTES = 2;

/** Header size (bytes) with the 16-bit extended length: byte0 + byte1 + UInt16. */
const HEADER_16BIT_BYTES = 4;

/** Header size (bytes) with the 64-bit extended length: byte0 + byte1 + UInt64. */
const HEADER_64BIT_BYTES = 10;

/** Byte offset of the extended length within a frame (immediately after byte0+byte1). */
const EXT_LEN_OFFSET = HEADER_SHORT_BYTES;

/** Payloads of this size or larger need the 64-bit length field (the 16-bit field maxes at
 * 2^16 - 1). 2^16 = 65536. RFC 6455 §5.2. */
const MAX_16BIT_PAYLOAD = 1 << 16;

// --- encoding ---
/** Length-prefix header for a payload: byte1's low 7 bits carry the length or a 126/127 escape
 * (RFC 6455 §5.2). `maskBit` is OR'd into byte1 (MASK_BIT for client frames, 0 for server).
 * @param {number} finOpcode byte 0 (FIN | opcode), e.g. FIN_TEXT_FRAME
 * @param {number} len payload byte length @param {number} maskBit @returns {Buffer} */
function encodeHeader(finOpcode, len, maskBit) {
  if (len < LEN_16BIT_MARKER) {
    return Buffer.from([finOpcode, maskBit | len]);
  }
  if (len < MAX_16BIT_PAYLOAD) {
    const header = Buffer.alloc(HEADER_16BIT_BYTES);
    header[0] = finOpcode;
    header[1] = maskBit | LEN_16BIT_MARKER;
    header.writeUInt16BE(len, EXT_LEN_OFFSET);
    return header;
  }
  const header = Buffer.alloc(HEADER_64BIT_BYTES);
  header[0] = finOpcode;
  header[1] = maskBit | LEN_64BIT_MARKER;
  header.writeUInt32BE(0, EXT_LEN_OFFSET); // high 32 bits (payloads here never reach 2^32)
  header.writeUInt32BE(len, EXT_LEN_OFFSET + UINT32_BYTES); // low 32 bits
  return header;
}

/** Encode a complete UNMASKED frame — the server→client direction (servers MUST NOT mask,
 * RFC 6455 §5.2). @param {number} finOpcode byte 0 (FIN | opcode) @param {Buffer} payload
 * @returns {Buffer} */
export function encodeServerFrame(finOpcode, payload) {
  return Buffer.concat([encodeHeader(finOpcode, payload.length, 0), payload]);
}

/** Encode a string as a single unmasked WebSocket text frame (FIN + opcode 0x1) — the sim's
 * data-frame shape. @param {string} str @returns {Buffer} */
export function encodeTextFrame(str) {
  return encodeServerFrame(FIN_TEXT_FRAME, Buffer.from(str, "utf8"));
}

/** Encode a complete MASKED frame — the client→server direction (clients MUST mask every frame,
 * RFC 6455 §5.3: a fresh random 4-byte key, payload[j] ^= key[j mod 4]).
 * @param {number} finOpcode byte 0 (FIN | opcode) @param {Buffer} payload @returns {Buffer} */
export function encodeClientFrame(finOpcode, payload) {
  const key = crypto.randomBytes(MASK_KEY_BYTES);
  const masked = Buffer.alloc(payload.length);
  for (let j = 0; j < payload.length; j++) {
    masked[j] = (payload[j] ?? 0) ^ (key[j % MASK_KEY_BYTES] ?? 0);
  }
  return Buffer.concat([encodeHeader(finOpcode, payload.length, MASK_BIT), key, masked]);
}

// --- decoding ---
/** One decoded frame: its opcode and its payload, already unmasked if the wire had it masked. */
/** @typedef {{ opcode: number, payload: Buffer }} WsFrame */

/** Drain every complete frame out of `buf`. Incremental: returns the decoded frames plus the
 * unconsumed remainder (a partial trailing frame), which the caller prepends to the next chunk.
 * Direction-agnostic — masked (client→server) payloads are unmasked per RFC 6455 §5.3
 * (payload[j] ^ key[j mod 4]); unmasked (server→client) pass through.
 * @param {Buffer} buf @returns {{ frames: WsFrame[], rest: Buffer }} */
export function decodeFrames(buf) {
  /** @type {WsFrame[]} */
  const frames = [];
  let offset = 0;
  while (buf.length - offset >= HEADER_SHORT_BYTES) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    if (b0 === undefined || b1 === undefined) break;
    const opcode = b0 & OPCODE_MASK;
    const masked = (b1 & MASK_BIT) !== 0;
    let len = b1 & PAYLOAD_LEN_MASK;
    let headerLen = HEADER_SHORT_BYTES;
    if (len === LEN_16BIT_MARKER) {
      if (buf.length - offset < HEADER_16BIT_BYTES) break;
      len = buf.readUInt16BE(offset + EXT_LEN_OFFSET);
      headerLen = HEADER_16BIT_BYTES;
    } else if (len === LEN_64BIT_MARKER) {
      if (buf.length - offset < HEADER_64BIT_BYTES) break;
      len = Number(buf.readBigUInt64BE(offset + EXT_LEN_OFFSET));
      headerLen = HEADER_64BIT_BYTES;
    }
    const maskLen = masked ? MASK_KEY_BYTES : 0;
    if (buf.length - offset < headerLen + maskLen + len) break;
    const maskStart = offset + headerLen;
    const dataStart = maskStart + maskLen;
    const payload = Buffer.alloc(len);
    for (let j = 0; j < len; j++) {
      payload[j] = masked
        ? (buf[dataStart + j] ?? 0) ^ (buf[maskStart + (j % MASK_KEY_BYTES)] ?? 0)
        : (buf[dataStart + j] ?? 0);
    }
    frames.push({ opcode, payload });
    offset = dataStart + len;
  }
  return { frames, rest: buf.subarray(offset) };
}
