import crypto from "crypto";

class BlockIteme {
  constructor(
    index,
    previousHash,
    fileMetadata,
    timestamp,
    transactions,
    cids,
    userId
  ) {
    this.index = index;
    this.fileMetadata = fileMetadata;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.cids = cids;
    this.hash = this.calculateHash();
    this.userId = userId;
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
