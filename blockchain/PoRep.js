import crypto from "crypto";

class PoRep {
  constructor() {
    this.IV_LENGTH = 16;
  }

  generateKeyAndIv(nodePublicKey) {
    const key = crypto.createHash("sha256").update(nodePublicKey).digest();
    const iv = crypto.randomBytes(16);
    return { key, iv };
  }

  encodeBlockForNode(block, nodePubKey) {
    const { key, iv } = this.generateKeyAndIv(nodePubKey);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encoded = cipher.update(block, "utf8", "hex");
    encoded += cipher.final("hex");
    return { encodedBlock: encoded, iv: iv.toString("hex") };
  }

  generateReplicationProof(encodedBlock) {
    return crypto.createHash("sha256").update(encodedBlock).digest("hex");
  }
}

export { PoRep };
