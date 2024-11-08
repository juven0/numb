import { BlockIteme } from "../blockchain/block.js";

class ShareSystem {
  constructor(blockchain) {
    this.blockchain = blockchain;
  }

  async shareFile(fileHash, ownerUserId, targetUserId) {
    try {
      // Récupérer le bloc existant
      let block = await this.blockchain.getBlock(fileHash);
      if (!block) {
        throw new Error("File not found");
      }

      // Parser si c'est une chaîne
      if (typeof block === "string") {
        block = JSON.parse(block);
      }

      // Vérifier la propriété
      if (block.userId !== ownerUserId) {
        throw new Error("Only the owner can share the file");
      }

      // Initialiser sharedWith si nécessaire
      if (!block.sharedWith) {
        block.sharedWith = [];
      }

      // Vérifier si déjà partagé
      if (block.sharedWith.includes(targetUserId)) {
        throw new Error("File is already shared with this user");
      }

      // Ajouter le nouvel utilisateur
      block.sharedWith.push(targetUserId);

      // Ajouter la transaction
      if (!block.transactions) {
        block.transactions = [];
      }

      block.transactions.push({
        type: "share",
        targetUserId,
        timestamp: Date.now(),
      });

      // Important: Ne pas recalculer le hash, conserver le hash existant
      const originalHash = block.hash;

      // Sauvegarder les modifications sans créer de nouvelle instance
      await this.blockchain.updateBlock(originalHash, block);

      return {
        success: true,
        fileName: block.fileMetadata.name,
        fileHash: block.fileMetadata.hash,
        blockHash: originalHash,
        sharedWith: block.sharedWith,
        transaction: block.transactions[block.transactions.length - 1],
      };
    } catch (error) {
      console.error("Error sharing file:", error);
      throw error;
    }
  }

  async getSharedFiles(userId) {
    try {
      const allBlocks = await this.blockchain.getAllBlocks();
      console.log(JSON.stringify(allBlocks));
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
