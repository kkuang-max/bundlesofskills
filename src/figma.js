// Figma REST calls (https://www.figma.com/developers/api). Optional: needs a
// personal access token in Options. Without one, Figma still works through
// screenshots; you just can't post comments or get a crisp frame render.
//
// What the REST API can and can't do:
//   ✅ read a node (name, text layers) and render it to PNG
//   ✅ post a comment pinned to a node
//   ❌ edit text/layers: that needs a Figma plugin running inside the editor

const API = "https://api.figma.com/v1";

async function call(token, path, init = {}) {
  if (!token) {
    const e = new Error("Add a Figma personal access token in the extension options to use Figma comments.");
    e.code = "no-figma-token";
    throw e;
  }
  const res = await fetch(API + path, { ...init, headers: { "X-Figma-Token": token, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).err || "";
    } catch {
      /* not JSON */
    }
    const msg = { 403: "Figma rejected the token (or it can't see this file).", 404: "Figma couldn't find that file or frame." }[res.status] || `Figma error ${res.status}.`;
    throw new Error(detail ? `${msg} ${detail}` : msg);
  }
  return res.json();
}

/** All text in a node tree, top to bottom. */
export function collectText(node, out = []) {
  if (!node) return out;
  if (node.type === "TEXT" && node.characters) out.push(node.characters);
  for (const c of node.children || []) collectText(c, out);
  return out;
}

async function toDataUrl(url) {
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${res.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
}

/** Name, text layers and a PNG render of one node. */
export async function figmaFrame(token, fileKey, nodeId) {
  if (!token) return { skipped: true };
  const ids = encodeURIComponent(nodeId);
  const [nodes, images] = await Promise.all([
    call(token, `/files/${fileKey}/nodes?ids=${ids}&depth=50`),
    call(token, `/images/${fileKey}?ids=${ids}&format=png&scale=1`),
  ]);
  const doc = nodes.nodes?.[nodeId]?.document;
  const imgUrl = images.images?.[nodeId];
  return {
    name: doc?.name || nodeId,
    text: collectText(doc).join("\n").slice(0, 20000),
    image: imgUrl ? await toDataUrl(imgUrl) : null,
  };
}

/** Post a comment pinned to a node (or to the file if no node is selected). */
export async function figmaComment(token, fileKey, nodeId, message) {
  const body = { message };
  // Pin the comment inside the frame (a little in from its top-left corner), not on its edge.
  if (nodeId) body.client_meta = { node_id: nodeId, node_offset: { x: 24, y: 24 } };
  const r = await call(token, `/files/${fileKey}/comments`, { method: "POST", body: JSON.stringify(body) });
  return { id: r.id };
}
