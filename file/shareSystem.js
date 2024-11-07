import { BlockIteme } from "../blockchain/block.js";

class ShareSystem {
  constructor(storage) {
    this.storage = storage;
  }

  async shareFile(fileHash, ownerUserId, targetUserId) {
    try {
      const fileBlock = await this.storage.getBlock(fileHash);
      console.log(fileBlock);
      if (!fileBlock) {
        throw new Error("File not found");
      }

      let blockData = fileBlock;
      if (typeof fileBlock === "string") {
        blockData = JSON.parse(fileBlock);
      }

      // Vérifier que l'utilisateur est le propriétaire
      if (blockData.userId !== ownerUserId) {
        throw new Error("Only the owner can share the file");
      }

      // Créer une nouvelle instance de BlockIteme
      const block = new BlockIteme(
        blockData.index,
        blockData.previousHash,
        blockData.fileMetadata,
        blockData.timestamp,
        blockData.transactions || [],
        blockData.cids,
        blockData.userId,
        blockData.encryptionMeta,
        blockData.sharedWith || []
      );

      if (!block.sharedWith) {
        block.sharedWith = [];
      }

      // Vérifier si le fichier est déjà partagé
      if (block.sharedWith.includes(targetUserId)) {
        throw new Error("File is already shared with this user");
      }

      // Partager le fichier
      block.sharedWith.push(targetUserId);

      // Ajouter la transaction de partage
      const shareTransaction = {
        type: "share",
        targetUserId,
        timestamp: Date.now(),
      };
      block.transactions.push(shareTransaction);

      // Sauvegarder le bloc mis à jour

      await this.storage.storage.saveBlock(block);

      return {
        success: true,
        fileName: block.fileMetadata.name,
        fileHash: block.fileMetadata.hash,
        blockHash: block.hash,
        sharedWith: block.sharedWith,
        transaction: shareTransaction,
      };
    } catch (error) {
      console.error("Error sharing file:", error);
      throw error;
    }
  }

  async getSharedFiles(userId) {
    try {
      const allBlocks = await this.storage.getAllBlocks();
      return allBlocks
        .map((block) => {
          let blockData = block;
          if (typeof block === "string") {
            blockData = JSON.parse(block);
          }

          // Ne pas inclure les fichiers dont l'utilisateur est propriétaire
          if (blockData.userId === userId) return null;

          // Vérifier si le fichier est partagé avec l'utilisateur
          if (blockData.sharedWith && blockData.sharedWith.includes(userId)) {
            const shareTransaction = blockData.transactions.find(
              (t) => t.type === "share" && t.targetUserId === userId
            );

            return {
              fileName: blockData.fileMetadata.name,
              fileHash: blockData.fileMetadata.hash,
              uploadTimestamp: blockData.timestamp,
              blockHash: blockData.hash,
              owner: blockData.userId,
              sharedOn: shareTransaction?.timestamp,
              transactions: blockData.transactions.filter(
                (t) => t.type === "share" && t.targetUserId === userId
              ),
            };
          }
          return null;
        })
        .filter(Boolean); // Retirer les éléments null
    } catch (error) {
      console.error("Error getting shared files:", error);
      throw error;
    }
  }

  async getSharedUsers(fileHash) {
    try {
      const block = await this.storage.getBlock(fileHash);
      if (!block) {
        throw new Error("File not found");
      }

      let blockData = block;
      if (typeof block === "string") {
        blockData = JSON.parse(block);
      }

      return {
        fileName: blockData.fileMetadata.name,
        fileHash: blockData.fileMetadata.hash,
        blockHash: blockData.hash,
        uploadTimestamp: blockData.timestamp,
        sharedWith: blockData.sharedWith || [],
        transactions: blockData.transactions.filter(
          (t) => t.type === "share" || t.type === "unshare"
        ),
      };
    } catch (error) {
      console.error("Error getting shared users:", error);
      throw error;
    }
  }

  async unshareFile(fileHash, ownerUserId, targetUserId) {
    try {
      const fileBlock = await this.storage.getBlock(fileHash);
      if (!fileBlock) {
        throw new Error("File not found");
      }

      let blockData = fileBlock;
      if (typeof fileBlock === "string") {
        blockData = JSON.parse(fileBlock);
      }

      if (blockData.userId !== ownerUserId) {
        throw new Error("Only the owner can unshare the file");
      }

      const block = new BlockIteme(
        blockData.index,
        blockData.previousHash,
        blockData.fileMetadata,
        blockData.timestamp,
        blockData.transactions || [],
        blockData.cids,
        blockData.userId,
        blockData.encryptionMeta,
        blockData.sharedWith || []
      );

      // Retirer l'utilisateur de la liste des partages
      const index = block.sharedWith.indexOf(targetUserId);
      if (index === -1) {
        throw new Error("File is not shared with this user");
      }

      block.sharedWith.splice(index, 1);

      // Ajouter la transaction d'annulation de partage
      const unshareTransaction = {
        type: "unshare",
        targetUserId,
        timestamp: Date.now(),
      };
      block.transactions.push(unshareTransaction);

      await this.storage.saveBlock(block);

      return {
        success: true,
        fileName: block.fileMetadata.name,
        fileHash: block.fileMetadata.hash,
        blockHash: block.hash,
        sharedWith: block.sharedWith,
        transaction: unshareTransaction,
      };
    } catch (error) {
      console.error("Error unsharing file:", error);
      throw error;
    }
  }
}

export { ShareSystem };
