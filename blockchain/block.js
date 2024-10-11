import crypto from "crypto";

class Block {
  constructor(index, previousHash, timestamp, transactions, cids) {
    this.index = index;
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

export { Block };
