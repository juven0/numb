class ReplicationTransaction {
  constructor(fromAddress, toAddress, fileCID, replicationProof, iv) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.fileCID = fileCID;
    this.replicationProof = replicationProof;
    this.iv = iv;
    this.timestamp = Date.now();
  }
}

export { ReplicationTransaction };
