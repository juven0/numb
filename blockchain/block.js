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
    encryptionMeta,
    sharedWith = []
  ) {
    this.index = index;
    this.previousHash = previousHash;
    this.fileMetadata = fileMetadata;
    this.timestamp = timestamp;
    this.transactions = transactions || [];
    this.cids = cids;
    this.userId = userId;
    this.encryptionMeta = encryptionMeta;
    this.sharedWith = sharedWith;
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
          JSON.stringify(this.cids) +
          this.userId
      )
      .digest("hex");
  }

  shareWith(targetUserId) {
    if (!this.sharedWith.includes(targetUserId)) {
      this.sharedWith.push(targetUserId);
      this.transactions.push({
        type: "share",
        targetUserId,
        timestamp: Date.now(),
      });
      this.hash = this.calculateHash();
    }
  }

  unshareWith(targetUserId) {
    const index = this.sharedWith.indexOf(targetUserId);
    if (index !== -1) {
      this.sharedWith.splice(index, 1);
      this.transactions.push({
        type: "unshare",
        targetUserId,
        timestamp: Date.now(),
      });
      this.hash = this.calculateHash();
    }
  }

  isSharedWith(userId) {
    return this.userId === userId || this.sharedWith.includes(userId);
  }
}

export { BlockIteme };
