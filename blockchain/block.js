import crypto from "crypto";
import FileSharing from "../file/ShareFile";
// import { FileSharing } from "../file/ShareFile";

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

  shareWith(targetUserId) {
    this.sharing.addSharedUser(targetUserId);
    this.transactions.push({
      type: "share",
      targetUserId,
      timestamp: Date.now(),
    });
    this.hash = this.calculateHash();
  }

  isSharedWith(userId) {
    return this.userId === userId || this.sharing.sharedWith.has(userId);
  }
}

export { BlockIteme };
