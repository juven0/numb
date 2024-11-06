class FileSharing {
  constructor() {
    this.sharedWith = new Set(); // Set of userIds who have access
  }

  addSharedUser(userId) {
    this.sharedWith.add(userId);
  }

  getSharedUsers() {
    return Array.from(this.sharedWith);
  }

  toJSON() {
    return {
      sharedWith: Array.from(this.sharedWith),
    };
  }

  static fromJSON(json) {
    const sharing = new FileSharing();
    json.sharedWith.forEach((userId) => sharing.addSharedUser(userId));
    return sharing;
  }
}

export { FileSharing };
