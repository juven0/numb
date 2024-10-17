import crypto from "crypto";

class BlockIteme {
  constructor(
    index,
    previousHash,
    fileMetadata,
    timestamp,
    transactions,
    cids
  ) {
    this.index = index;
    this.fileMetadata = fileMetadata;
    this.previousHash = previousHash;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.cids = cids;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto
      .createHash("sha256")
      .update(
        this.index +
          this.previousHash +
          this.timestamp +
          JSON.stringify(this.transactions) +
          JSON.stringify(this.cids)
      )
      .digest("hex");
  }
}

export { BlockIteme };
