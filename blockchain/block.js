import crypto from "crypto";

class BlockIteme {
  constructor(
    index,
    previousHash,
    fileMetadata,
    timestamp,
    transactions,
    cids,
    userId,
    encryptionMeta
  ) {
    this.index = index;
    this.previousHash = previousHash;
    this.fileMetadata = fileMetadata;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.cids = cids;
    this.userId = userId;
    this.encryptionMeta = encryptionMeta;
    this.sharing = new FileSharing();
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto
      .createHash("sha256")
      .update(
        this.index +
          this.previousHash +
          this.timestamp +
          JSON.stringify(this.fileMetadata) +
          JSON.stringify(this.transactions) +
          JSON.stringify(this.cids) +
          this.userId
      )
      .digest("hex");
  }
}

export { BlockIteme };
